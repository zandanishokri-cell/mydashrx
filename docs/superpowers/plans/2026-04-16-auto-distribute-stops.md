# Auto-Distribute Stops Across Routes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "Auto-Distribute" button on the plan detail page that distributes unassigned stops across the plan's routes using angular geographic clustering — reducing the manual stop-assignment workflow from N actions to 1.

**Architecture:** Backend endpoint `POST /orgs/:orgId/plans/:planId/auto-distribute` performs the clustering algorithm and calls the existing bulk-assign path. Frontend adds an Auto-Distribute button on the plan detail page next to Optimize.

**Tech Stack:** Fastify backend, Drizzle ORM, TypeScript, Next.js 14 frontend.

---

## Background

### The dispatcher pain point

Current workflow for a 50-stop import with 3 drivers:
1. Create plan
2. Add 3 routes (one per driver)
3. Manually assign each stop to a route: 50 × open stop → select route → save = ~150 clicks

Auto-distribute collapses step 3 to one click.

### Stop-to-plan association

Stops don't have a direct `planId` column — the link is `stop.routeId → routes.planId`. Unassigned stops have `routeId=null`. To find stops "for" a plan date, we use:

1. `stops.windowStart` date = `plan.date` (most reliable — recurring stops always have this)
2. `stops.createdAt` date = `plan.date` as fallback (covers imports done same day)
3. Caller can also pass explicit `stopIds[]` to override the auto-filter

### Distribution algorithm: Angular clustering

Sorts stops by polar angle from the depot centroid, then distributes round-robin across routes. This creates geographically contiguous "pie slice" zones where each driver gets a sector of the delivery area — better for real-world efficiency than distance-sort round-robin.

```
Depot at (lat0, lng0). Stop angle: atan2(stop.lat - lat0, stop.lng - lng0)
Sort by angle ascending. Assign: stop[i] → route[i % numRoutes]
```

Example: 3 routes, 9 stops sorted by angle → route A gets stops 0,3,6 (NW sector), B gets 1,4,7 (N sector), C gets 2,5,8 (NE sector).

**Only unassigned stops are touched.** Already-assigned stops are left in place.

---

## File Structure

- **Modify:** `packages/backend/src/routes/plans.ts` — add `POST /:planId/auto-distribute`
- **Modify:** `packages/dashboard/src/app/dashboard/plans/[planId]/page.tsx` — add Auto-Distribute button + feedback

---

## Task 1: Backend auto-distribute endpoint

**Files:**
- Modify: `packages/backend/src/routes/plans.ts`

- [ ] **Step 1: Write the failing test (manual validation)**

The endpoint must:
- Return 404 if planId doesn't exist or doesn't belong to org
- Return 400 if plan has no routes
- Return 400 if no unassigned stops found for the plan date
- Return `{ assigned: N, byRoute: [{routeId, stopCount}] }` on success
- NOT touch already-assigned stops (routeId != null)
- Distribute approximately equally across routes (within ±1 stop)

- [ ] **Step 2: Add imports to plans.ts**

At the top of `plans.ts`, add `sql` to the drizzle-orm import (needed for `or`):

```typescript
import { eq, and, isNull, inArray, notInArray, or, sql } from 'drizzle-orm';
```

Also add `stops` to the schema import:
```typescript
import { plans, routes, stops, depots } from '../db/schema.js';
```

Check if `stops` is already imported. If so, skip that line.

- [ ] **Step 3: Add the angular clustering helper (top of planRoutes handler, before the routes)**

Add before `app.get('/', ...)`:

```typescript
// Angular clustering: sort stops by polar angle from depot, distribute round-robin
// Creates geographically contiguous zones (pie slices) rather than arbitrary round-robin
function angularDistribute(
  depotLat: number,
  depotLng: number,
  stopList: Array<{ id: string; lat: number; lng: number }>,
  routeIds: string[],
): Map<string, string[]> {
  const sorted = [...stopList].sort((a, b) => {
    const angleA = Math.atan2(a.lat - depotLat, a.lng - depotLng);
    const angleB = Math.atan2(b.lat - depotLat, b.lng - depotLng);
    return angleA - angleB;
  });

  const assignment = new Map<string, string[]>(routeIds.map((id) => [id, []]));
  sorted.forEach((stop, i) => {
    const routeId = routeIds[i % routeIds.length];
    assignment.get(routeId)!.push(stop.id);
  });
  return assignment;
}
```

- [ ] **Step 4: Add the endpoint after `app.delete('/:planId', ...)` and before the closing `}`**

```typescript
  app.post('/:planId/auto-distribute', {
    preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin'),
  }, async (req, reply) => {
    const { orgId, planId } = req.params as { orgId: string; planId: string };
    const { stopIds: explicitStopIds } = req.body as { stopIds?: string[] };

    // Verify plan ownership
    const [plan] = await db.select({ id: plans.id, date: plans.date, depotId: plans.depotId })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.orgId, orgId), isNull(plans.deletedAt)))
      .limit(1);
    if (!plan) return reply.code(404).send({ error: 'Plan not found' });

    // Get plan routes (only non-deleted)
    const planRouteRows = await db.select({ id: routes.id })
      .from(routes)
      .where(and(eq(routes.planId, planId), isNull(routes.deletedAt)));
    if (planRouteRows.length === 0) return reply.code(400).send({ error: 'Plan has no routes — add drivers first' });

    // Get depot for clustering anchor
    const [depot] = await db.select({ lat: depots.lat, lng: depots.lng })
      .from(depots)
      .where(and(eq(depots.id, plan.depotId), eq(depots.orgId, orgId)))
      .limit(1);
    const depotLat = depot?.lat ?? 42.3314; // Detroit fallback
    const depotLng = depot?.lng ?? -83.0458;

    // Find unassigned stops: either explicit list or auto-discover by plan date + org
    let unassigned: Array<{ id: string; lat: number; lng: number }>;

    if (explicitStopIds && explicitStopIds.length > 0) {
      // Caller provided specific stops — verify they belong to org and are unassigned
      unassigned = await db
        .select({ id: stops.id, lat: stops.lat, lng: stops.lng })
        .from(stops)
        .where(and(
          inArray(stops.id, explicitStopIds),
          eq(stops.orgId, orgId),
          isNull(stops.routeId),
          isNull(stops.deletedAt),
        ));
    } else {
      // Auto-discover: unassigned stops for this org whose window date OR createdAt date matches plan date
      // windowStart::date matches plan.date covers recurring-generated stops
      // createdAt::date matches plan.date covers same-day imports
      unassigned = await db
        .select({ id: stops.id, lat: stops.lat, lng: stops.lng })
        .from(stops)
        .where(and(
          eq(stops.orgId, orgId),
          isNull(stops.routeId),
          isNull(stops.deletedAt),
          or(
            sql`DATE(${stops.windowStart} AT TIME ZONE 'America/Detroit') = ${plan.date}`,
            sql`DATE(${stops.createdAt} AT TIME ZONE 'America/Detroit') = ${plan.date}`,
          ),
        ));
    }

    if (unassigned.length === 0) return reply.code(400).send({ error: 'No unassigned stops found for this plan date' });

    // Filter out stops with no valid geocoding (0,0 = not geocoded)
    const geocoded = unassigned.filter((s) => s.lat !== 0 || s.lng !== 0);
    const noCoords = unassigned.filter((s) => s.lat === 0 && s.lng === 0);

    const routeIds = planRouteRows.map((r) => r.id);
    const assignment = angularDistribute(depotLat, depotLng, geocoded, routeIds);

    // Distribute non-geocoded stops round-robin (after geocoded)
    noCoords.forEach((stop, i) => {
      const routeId = routeIds[i % routeIds.length];
      assignment.get(routeId)!.push(stop.id);
    });

    // Bulk-assign: set routeId + sequenceNumber for each route's stops
    let totalAssigned = 0;
    const byRoute: { routeId: string; stopCount: number }[] = [];

    await Promise.all(
      routeIds.map(async (routeId) => {
        const stopIdsForRoute = assignment.get(routeId) ?? [];
        if (stopIdsForRoute.length === 0) return;

        // Get current max sequenceNumber for this route to append without collision
        const [maxSeq] = await db
          .select({ max: sql<number>`COALESCE(MAX(${stops.sequenceNumber}), -1)` })
          .from(stops)
          .where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)));
        let seq = (maxSeq?.max ?? -1) + 1;

        await Promise.all(
          stopIdsForRoute.map((stopId) =>
            db.update(stops)
              .set({ routeId, sequenceNumber: seq++ })
              .where(and(eq(stops.id, stopId), eq(stops.orgId, orgId), isNull(stops.deletedAt)))
          )
        );

        // Update route stopOrder array
        const existingStops = await db.select({ id: stops.id })
          .from(stops)
          .where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt)))
          .orderBy(stops.sequenceNumber);

        await db.update(routes)
          .set({ stopOrder: existingStops.map((s) => s.id) })
          .where(eq(routes.id, routeId));

        totalAssigned += stopIdsForRoute.length;
        byRoute.push({ routeId, stopCount: stopIdsForRoute.length });
      })
    );

    return { assigned: totalAssigned, byRoute };
  });
```

- [ ] **Step 5: TypeScript check**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/routes/plans.ts
git commit -m "feat(plans): auto-distribute endpoint — angular clustering for unassigned stops"
```

---

## Task 2: Frontend Auto-Distribute button

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/plans/[planId]/page.tsx`

- [ ] **Step 1: Add distributing state and handler**

After the existing `const [distributing, setDistributing] = useState(false);` line, add:

```typescript
const [autoDistributing, setAutoDistributing] = useState(false);
const [autoDistributeResult, setAutoDistributeResult] = useState<{ assigned: number } | null>(null);
```

After the `distribute` async function, add:

```typescript
  const autoDistribute = async () => {
    if (autoDistributing) return;
    setAutoDistributing(true);
    setError('');
    setAutoDistributeResult(null);
    try {
      const result = await api.post<{ assigned: number; byRoute: { routeId: string; stopCount: number }[] }>(
        `/orgs/${user!.orgId}/plans/${planId}/auto-distribute`,
        {},
      );
      setAutoDistributeResult({ assigned: result.assigned });
      await loadPlan();
    } catch {
      setError('Auto-distribute failed. Make sure you have routes and unassigned stops for this date.');
    } finally {
      setAutoDistributing(false);
    }
  };
```

- [ ] **Step 2: Add the button to the header actions**

In the header actions div (where Optimize and Distribute buttons live), add the Auto-Distribute button. It shows when: plan is not distributed/completed AND there are routes but the total stops count is low relative to routes (i.e., may have unassigned stops). Show it always when plan is draft/optimized and has routes.

Find the `<Button variant="secondary" size="sm" onClick={() => setShowAddRoute(true)}>` line and after the closing `</Button>` of "Add Driver", add:

```typescript
          {plan.status !== 'distributed' && plan.status !== 'completed' && routes.length > 0 && (
            <Button variant="secondary" size="sm" onClick={autoDistribute} loading={autoDistributing}>
              <MoveRight size={14} /> Auto-Distribute
            </Button>
          )}
```

- [ ] **Step 3: Add success feedback banner**

After the `{error && <p ...>}` error display (find it near line 180 in the component), add:

```typescript
      {autoDistributeResult && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
          <CheckCircle2 size={15} className="text-green-600 shrink-0" />
          {autoDistributeResult.assigned} stop{autoDistributeResult.assigned !== 1 ? 's' : ''} distributed across {routes.length} route{routes.length !== 1 ? 's' : ''}.
          <button onClick={() => setAutoDistributeResult(null)} className="ml-auto text-green-600 hover:underline text-xs">Dismiss</button>
        </div>
      )}
```

Add `CheckCircle2` to the lucide-react import at the top of the file.

- [ ] **Step 4: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/app/dashboard/plans/[planId]/page.tsx
git commit -m "feat(plans): Auto-Distribute button — one-click angular clustering from plan detail"
```

---

## Self-Review

**Spec coverage:**
- 404 on missing plan ✅
- 400 on no routes ✅
- 400 on no unassigned stops ✅
- Explicit stopIds[] override ✅
- Auto-discovery by windowStart OR createdAt date ✅
- Non-geocoded stops handled (round-robin fallback after geocoded) ✅
- sequenceNumber assigned correctly (appends after existing stops) ✅
- stopOrder array updated ✅
- Already-assigned stops untouched (isNull(stops.routeId) filter) ✅
- Frontend: button in correct location ✅
- Frontend: success feedback ✅
- Frontend: loadPlan() refresh after distribute ✅

**Edge cases:**
- 0 routes → 400 ✅
- 1 route → all stops go to that route ✅ (angularDistribute with 1 routeId works correctly)
- All stops have coords → geocoded path ✅
- All stops at 0,0 → noCoords path, round-robin ✅
- Plan has no depot lat/lng → fallback to Detroit 42.3314, -83.0458 ✅
- `seq++` race in parallel map: each route's stops computed independently — no race ✅
- `maxSeq` query on empty route → COALESCE to -1 → seq starts at 0 ✅

**Security:**
- Plan org-scoped via `eq(plans.orgId, orgId)` ✅
- Explicit stopIds verified via `eq(stops.orgId, orgId)` ✅
- Auto-discovered stops scoped to `eq(stops.orgId, orgId)` ✅
- Route IDs come from the plan's own routes (not user input) ✅
