# Driver Route-Ready Notification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a dispatcher clicks "Distribute" on a plan, send an SMS to each assigned driver so they know their route is ready — eliminating the manual phone-call workflow gap.

**Architecture:** Add a `sendRouteReadyNotifications(planId, orgId)` function to `notifications.ts`. Call it fire-and-forget from the distribute handler in `plans.ts`. Skip silently when TWILIO env vars not set.

**Tech Stack:** Twilio SMS, Drizzle ORM, Fastify. No migrations needed.

---

## Background

Current `PATCH /:planId/distribute` sets `plans.status = 'distributed'` and returns — no notifications. Dispatchers call drivers manually or hope drivers check the app. This is the #1 dispatch workflow gap.

The Twilio infrastructure already exists in `notifications.ts`. The `sendStopNotification()` function shows the pattern. We just need a parallel function for drivers.

---

## File Structure

- **Modify:** `packages/backend/src/services/notifications.ts` — add `sendRouteReadyNotifications()`
- **Modify:** `packages/backend/src/routes/plans.ts` — call it from distribute handler

---

## Task 1: Add sendRouteReadyNotifications to notifications.ts

**Files:**
- Modify: `packages/backend/src/services/notifications.ts`

- [ ] **Step 1: Add the function after the existing exports**

Read `notifications.ts` to find the end of the file, then add:

```typescript
export async function sendRouteReadyNotifications(planId: string, orgId: string): Promise<void> {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) return;

  // Get plan date + all routes with assigned drivers
  const [planRow] = await db
    .select({ date: plans.date, depotId: plans.depotId })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.orgId, orgId)))
    .limit(1);
  if (!planRow) return;

  const [orgRow] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const pharmacyName = orgRow?.name ?? 'Your pharmacy';

  const assignedRoutes = await db
    .select({ driverId: routes.driverId, stopOrder: routes.stopOrder })
    .from(routes)
    .where(and(eq(routes.planId, planId), isNull(routes.deletedAt), isNotNull(routes.driverId)));

  if (assignedRoutes.length === 0) return;

  const driverIds = assignedRoutes.map(r => r.driverId).filter((id): id is string => !!id);

  const driverRows = await db
    .select({ id: drivers.id, name: drivers.name, phone: drivers.phone })
    .from(drivers)
    .where(and(inArray(drivers.id, driverIds), isNull(drivers.deletedAt)));

  const stopCountByDriver = new Map<string, number>(
    assignedRoutes.map(r => [r.driverId!, (r.stopOrder as string[]).length])
  );

  await Promise.all(
    driverRows
      .filter(d => d.phone && d.phone.trim())
      .map(async (driver) => {
        const stopCount = stopCountByDriver.get(driver.id) ?? 0;
        const body = `Hi ${driver.name.split(' ')[0]}, your ${pharmacyName} delivery route for ${planRow.date} is ready — ${stopCount} stop${stopCount !== 1 ? 's' : ''}. Open the app to start your route.`;
        try {
          await getClient().messages.create({
            from: process.env.TWILIO_FROM_NUMBER!,
            to: driver.phone!,
            body,
          });
        } catch (err) {
          console.error(`[route-ready-sms] driver ${driver.id} failed:`, err);
        }
      })
  );
}
```

Note: `isNotNull` needs to be imported from drizzle-orm if not already present. Check the current imports at the top of `notifications.ts`.

- [ ] **Step 2: Add missing imports if needed**

Check the top of `notifications.ts`. Add `isNotNull` and `plans` if not already imported:
```typescript
import { eq, and, isNull, inArray, isNotNull } from 'drizzle-orm';
import { notificationLogs, organizations, users, drivers, routes, plans } from '../db/schema.js';
```

- [ ] **Step 3: TypeScript check**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/notifications.ts
git commit -m "feat(notifications): add sendRouteReadyNotifications — SMS drivers when route distributed"
```

---

## Task 2: Wire into distribute handler

**Files:**
- Modify: `packages/backend/src/routes/plans.ts`

- [ ] **Step 1: Add import**

```typescript
import { sendRouteReadyNotifications } from '../services/notifications.js';
```

- [ ] **Step 2: Add fire-and-forget call after status update**

In the distribute handler, after the DB update and before `return updated`:

```typescript
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    // Notify assigned drivers — fire-and-forget, non-blocking
    sendRouteReadyNotifications(planId, orgId).catch(console.error);
    return updated;
```

- [ ] **Step 3: TypeScript check + commit**

```bash
cd packages/backend && npx tsc --noEmit
git add packages/backend/src/routes/plans.ts
git commit -m "feat(plans): send SMS to assigned drivers on plan distribute"
```

---

## Self-Review

**Spec coverage:**
- Fire-and-forget (non-blocking) ✅
- Skip when TWILIO env vars absent ✅
- Multi-driver plan: each driver gets their own SMS with their specific stop count ✅
- Driver with no phone: filtered out silently ✅
- Individual driver SMS failure doesn't fail others (per-driver try/catch) ✅
- Uses driver's first name for personalization ✅

**Edge cases:**
- Plan with no assigned routes → returns early (assignedRoutes.length === 0) ✅
- Stop count from `stopOrder.length` — this is the sequence array, not a DB query ✅ (fast)
- Driver phone not E.164 format → Twilio will return error, caught per-driver ✅

**Non-issues:**
- Idempotency: distributing twice sends two SMS. Acceptable — dispatcher would only distribute once in normal flow. If needed, could guard with `plans.distributedAt` column, but YAGNI for now.
