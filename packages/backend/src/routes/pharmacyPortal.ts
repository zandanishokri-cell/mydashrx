import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection.js';
import { stops, routes, plans, depots, drivers, proofOfDeliveries, organizations, roleTemplates, adminAuditLogs } from '../db/schema.js';
import { eq, and, isNull, desc, count, gt, sql } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole.js';
import { requireDeliveryWrite } from '../middleware/requireOrgRole.js';
import { getOrgPermissions, upsertTemplate, invalidateOrg } from '../lib/rbacCache.js';
import { todayInTz } from '../utils/date.js';
import { encryptPhi, decryptPhi, encryptPhiArray, decryptPhiArray } from '../lib/phiCrypto.js';

export const pharmacyPortalRoutes: FastifyPluginAsync = async (app) => {
  // GET /pharmacy/my-depot — get this pharmacy's depot info
  app.get('/my-depot', {
    preHandler: requireRole('pharmacist', 'pharmacy_admin'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; depotIds: string[] };
    const depotId = user.depotIds?.[0];
    if (!depotId) return reply.code(404).send({ error: 'No depot assigned to this account' });
    const [depot] = await db.select().from(depots).where(eq(depots.id, depotId)).limit(1);
    if (!depot) return reply.code(404).send({ error: 'Depot not found' });
    return depot;
  });

  // GET /pharmacy/orders — pharmacy sees their submitted stops
  app.get('/orders', {
    preHandler: requireRole('pharmacist', 'pharmacy_admin'),
  }, async (req) => {
    const user = req.user as { sub: string; orgId: string; depotIds: string[] };
    const { status, limit = '50', page = '1' } = req.query as { status?: string; limit?: string; page?: string };

    const limitNum = Math.min(100, parseInt(limit));
    const offset = (Math.max(1, parseInt(page)) - 1) * limitNum;

    // Get stops from plans belonging to this pharmacy's depot
    const depotId = user.depotIds?.[0];
    if (!depotId) return { stops: [], total: 0 };

    const rows = await db
      .select({
        id: stops.id,
        recipientName: stops.recipientName,
        recipientPhone: stops.recipientPhone,
        address: stops.address,
        status: stops.status,
        rxNumbers: stops.rxNumbers,
        packageCount: stops.packageCount,
        requiresRefrigeration: stops.requiresRefrigeration,
        controlledSubstance: stops.controlledSubstance,
        createdAt: stops.createdAt,
        arrivedAt: stops.arrivedAt,
        completedAt: stops.completedAt,
        failureReason: stops.failureReason,
        planDate: plans.date,
        planStatus: plans.status,
      })
      .from(stops)
      .leftJoin(routes, eq(stops.routeId, routes.id))
      .leftJoin(plans, eq(routes.planId, plans.id))
      .where(and(
        eq(stops.orgId, user.orgId),
        isNull(stops.deletedAt),
        eq(plans.depotId, depotId),
        ...(status ? [eq(stops.status, status as any)] : []),
      ))
      .orderBy(desc(stops.createdAt))
      .limit(limitNum)
      .offset(offset);

    return { stops: rows, total: rows.length };
  });

  // POST /pharmacy/orders — pharmacy submits a new delivery stop
  // This creates/finds a draft plan for today and adds the stop
  app.post('/orders', {
    preHandler: requireDeliveryWrite(),
  }, async (req, reply) => {
    const user = req.user as { sub: string; orgId: string; depotIds: string[] };
    const depotId = user.depotIds?.[0];
    if (!depotId) return reply.code(400).send({ error: 'No depot assigned to this account' });

    const body = req.body as {
      recipientName: string;
      recipientPhone: string;
      address: string;
      lat: number;
      lng: number;
      rxNumbers?: string[];
      packageCount?: number;
      requiresRefrigeration?: boolean;
      controlledSubstance?: boolean;
      requiresSignature?: boolean;
      codAmount?: number;
      deliveryNotes?: string;
      deliveryDate?: string; // YYYY-MM-DD, defaults to today
    };

    if (!body.recipientName || !body.address) {
      return reply.code(400).send({ error: 'recipientName and address required' });
    }

    const date = body.deliveryDate ?? todayInTz();

    // Validate depot exists (P-BUG-DEPOT-FK: depotId from JWT may be a placeholder)
    const [depotRow] = await db.select({ id: depots.id }).from(depots).where(eq(depots.id, depotId)).limit(1);
    if (!depotRow) return reply.code(400).send({ error: 'Assigned depot not found. Please contact your administrator.' });

    // Find or create a draft plan for this depot+date
    let [plan] = await db.select().from(plans)
      .where(and(eq(plans.orgId, user.orgId), eq(plans.depotId, depotId), eq(plans.date, date), isNull(plans.deletedAt)))
      .limit(1);

    if (!plan) {
      [plan] = await db.insert(plans).values({ orgId: user.orgId, depotId, date }).returning();
    }

    // Find or create a default "unassigned" route for the plan
    let [defaultRoute] = await db.select().from(routes)
      .where(and(eq(routes.planId, plan.id), isNull(routes.driverId), isNull(routes.deletedAt)))
      .limit(1);

    if (!defaultRoute) {
      [defaultRoute] = await db.insert(routes).values({ planId: plan.id, driverId: null as any }).returning();
    }

    const [stop] = await db.insert(stops).values({
      routeId: defaultRoute.id,
      orgId: user.orgId,
      recipientName: encryptPhi(body.recipientName),         // P-SEC40: AES-256-GCM at rest
      recipientPhone: encryptPhi(body.recipientPhone ?? ''), // P-SEC40: AES-256-GCM at rest
      address: body.address,
      lat: body.lat ?? 0,
      lng: body.lng ?? 0,
      rxNumbers: encryptPhiArray(body.rxNumbers ?? []) as unknown as string[], // P-SEC40
      packageCount: body.packageCount ?? 1,
      requiresRefrigeration: body.requiresRefrigeration ?? false,
      controlledSubstance: body.controlledSubstance ?? false,
      requiresSignature: body.requiresSignature ?? true,
      codAmount: body.codAmount,
      deliveryNotes: body.deliveryNotes,
    }).returning();

    // P-SEC40: decrypt PHI before returning
    return reply.code(201).send({
      ...stop,
      recipientName: decryptPhi(stop.recipientName ?? ''),
      recipientPhone: decryptPhi(stop.recipientPhone ?? ''),
      rxNumbers: decryptPhiArray(stop.rxNumbers as unknown as string),
      planId: plan.id,
      planDate: plan.date,
    });
  });

  // GET /pharmacy/orders/:stopId — order detail with driver + POD
  app.get('/orders/:stopId', {
    preHandler: requireRole('pharmacist', 'pharmacy_admin'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; orgId: string };
    const { stopId } = req.params as { stopId: string };

    const [row] = await db
      .select({
        id: stops.id,
        recipientName: stops.recipientName,
        recipientPhone: stops.recipientPhone,
        address: stops.address,
        unit: stops.unit,
        status: stops.status,
        rxNumbers: stops.rxNumbers,
        packageCount: stops.packageCount,
        requiresRefrigeration: stops.requiresRefrigeration,
        controlledSubstance: stops.controlledSubstance,
        requiresSignature: stops.requiresSignature,
        deliveryNotes: stops.deliveryNotes,
        failureReason: stops.failureReason,
        failureNote: stops.failureNote,
        arrivedAt: stops.arrivedAt,
        completedAt: stops.completedAt,
        createdAt: stops.createdAt,
        trackingToken: stops.trackingToken,
        planDate: plans.date,
        planStatus: plans.status,
        driverId: routes.driverId,
        driverName: drivers.name,
        driverPhone: drivers.phone,
        driverStatus: drivers.status,
      })
      .from(stops)
      .leftJoin(routes, eq(stops.routeId, routes.id))
      .leftJoin(plans, eq(routes.planId, plans.id))
      .leftJoin(drivers, eq(routes.driverId, drivers.id))
      .where(and(eq(stops.id, stopId), eq(stops.orgId, user.orgId), isNull(stops.deletedAt)))
      .limit(1);

    if (!row) return reply.code(404).send({ error: 'Not found' });

    // Fetch POD if completed
    const [pod] = await db.select().from(proofOfDeliveries).where(eq(proofOfDeliveries.stopId, stopId)).limit(1);

    // P-SEC40: decrypt PHI fields on read
    return {
      ...row,
      recipientName: decryptPhi(row.recipientName ?? ''),
      recipientPhone: decryptPhi(row.recipientPhone ?? ''),
      rxNumbers: decryptPhiArray(row.rxNumbers as unknown as string),
      pod: pod ?? null,
    };
  });

  // DELETE /pharmacy/orders/:stopId — cancel a pending stop
  app.delete('/orders/:stopId', {
    preHandler: requireDeliveryWrite(),
  }, async (req, reply) => {
    const user = req.user as { sub: string; orgId: string };
    const { stopId } = req.params as { stopId: string };
    const [stop] = await db.select().from(stops)
      .where(and(eq(stops.id, stopId), eq(stops.orgId, user.orgId), isNull(stops.deletedAt)))
      .limit(1);
    if (!stop) return reply.code(404).send({ error: 'Not found' });
    if (stop.status !== 'pending') return reply.code(400).send({ error: 'Can only cancel pending stops' });
    await db.update(stops).set({ deletedAt: new Date() }).where(and(eq(stops.id, stopId), eq(stops.orgId, user.orgId)));
    return reply.code(204).send();
  });

  // GET /pharmacy/onboarding-status — checklist for setup banner
  // P-ONB40/P-ONB42: also returns approvedAt, routesCreated, dismissedAt for nudge bar + cross-device dismiss
  app.get('/onboarding-status', {
    preHandler: requireRole('pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const user = req.user as { orgId: string };
    const orgId = user.orgId;

    const [depotCount, driverCount, planCount, completedStopCount, orgRow] = await Promise.all([
      db.select({ n: count() }).from(depots).where(and(eq(depots.orgId, orgId), isNull(depots.deletedAt))),
      db.select({ n: count() }).from(drivers).where(and(eq(drivers.orgId, orgId), isNull(drivers.deletedAt))),
      db.select({ n: count() }).from(plans).where(and(eq(plans.orgId, orgId), isNull(plans.deletedAt))),
      db.select({ n: count() }).from(stops).where(and(eq(stops.orgId, orgId), eq(stops.status, 'completed'), isNull(stops.deletedAt))),
      db.select({
        approvedAt: organizations.approvedAt,
        onboardingBannerDismissedAt: organizations.onboardingBannerDismissedAt,
        firstDispatchAt: organizations.firstDispatchAt,
        lastDispatchedAt: organizations.lastDispatchedAt,
        reactivationBannerDismissedAt: organizations.reactivationBannerDismissedAt,
      }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    ]);

    const org = orgRow[0];
    return reply.send({
      hasDepot: (depotCount[0]?.n ?? 0) > 0,
      hasDriver: (driverCount[0]?.n ?? 0) > 0,
      hasPlan: (planCount[0]?.n ?? 0) > 0,
      hasCompletedStop: (completedStopCount[0]?.n ?? 0) > 0,
      // P-ONB40: routesCreated = whether firstDispatchAt is set (first route ever dispatched)
      routesCreated: org?.firstDispatchAt ? 1 : 0,
      approvedAt: org?.approvedAt ?? null,
      dismissedAt: org?.onboardingBannerDismissedAt ?? null,
      // P-CNV29: re-activation banner fields
      lastDispatchedAt: org?.lastDispatchedAt ?? null,
      reactivationBannerDismissedAt: org?.reactivationBannerDismissedAt ?? null,
    });
  });

  // P-RBAC36: Pharmacy admin self-serve permission management
  // GET /pharmacy/role-templates — view org's current permission set per role
  app.get('/role-templates', {
    preHandler: requireRole('pharmacy_admin'),
  }, async (req, reply) => {
    const user = req.user as { orgId: string };
    const rows = await db.select().from(roleTemplates)
      .where(sql`org_id = ${user.orgId}::uuid OR org_id IS NULL`)
      .orderBy(roleTemplates.role);
    return reply.send({ templates: rows });
  });

  // PATCH /pharmacy/role-templates — update a role's permissions (envelope guard)
  // Envelope guard: requested permissions must be a subset of platform defaults
  // (prevents privilege escalation — pharmacy_admin can only grant perms they're entitled to)
  app.patch('/role-templates', {
    preHandler: requireRole('pharmacy_admin'),
  }, async (req, reply) => {
    const user = req.user as { sub: string; email: string; orgId: string };
    const { role, permissions } = req.body as { role: string; permissions: string[] };

    if (!role || !Array.isArray(permissions)) {
      return reply.code(400).send({ error: 'role and permissions array required' });
    }

    // Envelope: get caller's own effective permissions for the platform
    // (pharmacy_admin can only grant permissions that platform allows for the target role)
    const platformPerms = await getOrgPermissions(null, role);
    const platformSet = new Set(platformPerms);
    const forbidden = permissions.filter(p => !platformSet.has(p));
    if (forbidden.length > 0) {
      return reply.code(403).send({
        error: 'Cannot grant permissions outside platform envelope',
        forbidden,
      });
    }

    await upsertTemplate(user.orgId, role, permissions);

    db.insert(adminAuditLogs).values({
      actorId: user.sub,
      actorEmail: user.email,
      action: 'org_role_permissions_updated',
      targetId: user.orgId,
      targetName: `role:${role}`,
      metadata: { orgId: user.orgId, role, permissions, source: 'pharmacy_admin_self_serve' },
    }).catch(() => {});

    return reply.send({ ok: true, role, permissions });
  });

  // P-CNV29: Dismiss re-activation banner — sets reactivationBannerDismissedAt = NOW()
  app.patch('/reactivation-banner/dismiss', {
    preHandler: requireRole('pharmacy_admin'),
  }, async (req, reply) => {
    const user = req.user as { orgId: string };
    await db.update(organizations)
      .set({ reactivationBannerDismissedAt: new Date() })
      .where(eq(organizations.id, user.orgId));
    return reply.send({ ok: true });
  });
};
