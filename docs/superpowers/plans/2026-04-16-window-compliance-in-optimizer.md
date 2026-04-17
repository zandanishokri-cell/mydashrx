# Delivery Window Compliance in Route Optimizer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After route optimization, detect stops whose estimated arrival time will exceed their `windowEnd` deadline. Return violations in the optimize API response and surface an amber warning on the plan detail page so dispatchers can resequence before distributing.

**Architecture:** Plans.ts optimize endpoint already has legs from `optimizeRoute()`. Add `windowEnd` to the stops query, compute cumulative ETA per stop from legs, flag violations. Frontend adds an amber card if violations exist.

**Tech Stack:** Fastify backend, Drizzle ORM, TypeScript, Next.js 14 frontend.

---

## Background

### The clinical compliance gap

Controlled substances, refrigerated medications, and time-sensitive prescriptions have strict delivery windows. After optimization for distance, stop #8 might be estimated at 3:00 PM but have a `windowEnd` of 1:00 PM — a 2-hour miss. No system currently detects this.

**Impact**: Missed windows = patient medication adherence issues + pharmacist complaint calls + compliance risk for CS deliveries (Michigan DEA-936 requires timely delivery). A dispatcher seeing "Route A: 2 window violations" before distributing can resequence those stops manually.

### Departure time assumption

Routes don't have a scheduled departure time. Best estimate:
- If plan date = today AND current time is before noon → use current time
- If plan date = today AND current time is afternoon → use current time (driver likely hasn't left yet)
- If plan date = future date → use `08:00 AM` local time on plan.date as assumed departure

This is documented in the response so dispatchers know the assumption.

### What we already have

After `optimizeRoute()` returns:
- `optimized.stopIds` — ordered array of stop IDs
- `optimized.legs` — `{distanceKm, durationMin}[]` for each leg (N legs for N stops in circuit)
- `optimized.totalDuration` — total minutes

We need: `stops[i].windowEnd` (timestamp) to compute compliance.

---

## File Structure

- **Modify:** `packages/backend/src/routes/plans.ts` — add windowEnd to query, add ETA computation, extend response
- **Modify:** `packages/dashboard/src/app/dashboard/plans/[planId]/page.tsx` — render violation warning

---

## Task 1: Add window compliance to optimize endpoint

**Files:**
- Modify: `packages/backend/src/routes/plans.ts`

- [ ] **Step 1: Add windowEnd to the stops select in the optimize endpoint**

Find the stops query inside `planRoutes.map(async (route) => {`:

```typescript
const routeStops = await db
  .select()
  .from(stops)
  .where(and(
    eq(stops.routeId, route.id),
    isNull(stops.deletedAt),
    notInArray(stops.status, ['completed', 'failed', 'rescheduled']),
  ));
```

Change to select only needed fields (including windowEnd):

```typescript
const routeStops = await db
  .select({
    id: stops.id,
    lat: stops.lat,
    lng: stops.lng,
    status: stops.status,
    address: stops.address,
    recipientName: stops.recipientName,
    windowEnd: stops.windowEnd,
  })
  .from(stops)
  .where(and(
    eq(stops.routeId, route.id),
    isNull(stops.deletedAt),
    notInArray(stops.status, ['completed', 'failed', 'rescheduled']),
  ));
```

- [ ] **Step 2: Build a windowEnd lookup map after geocodedStops filter**

After `const geocodedStops = routeStops.filter(s => s.lat !== 0 || s.lng !== 0);`, add:

```typescript
        // Window lookup: id → windowEnd (for violation detection after optimize)
        const windowByStopId = new Map(
          routeStops.map((s) => [s.id, s.windowEnd]),
        );
```

- [ ] **Step 3: Compute per-stop ETA and detect window violations**

After the `await db.update(stops).set({ sequenceNumber: ... })` block (the Promise.all that sets sequence numbers), add the violation detection before the `return { routeId, ... }`:

```typescript
        // Departure time assumption: today = now; future date = 8am local on plan.date
        const planDateObj = new Date(`${plan.date}T08:00:00`);
        const isToday = plan.date === new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit' }).format(new Date());
        const departureMs = isToday ? Date.now() : planDateObj.getTime();

        // Compute cumulative arrival time at each stop using optimized legs
        const windowViolations: { stopId: string; address: string; windowEnd: string; estimatedArrival: string }[] = [];
        let elapsedMs = 0;
        for (let i = 0; i < optimized.stopIds.length; i++) {
          const leg = optimized.legs[i];
          if (leg) elapsedMs += leg.durationMin * 60_000;
          const stopId = optimized.stopIds[i];
          const windowEnd = windowByStopId.get(stopId);
          if (windowEnd) {
            const estimatedArrivalMs = departureMs + elapsedMs;
            if (estimatedArrivalMs > windowEnd.getTime()) {
              const stop = geocodedStops.find((s) => s.id === stopId);
              windowViolations.push({
                stopId,
                address: stop?.address ?? '',
                windowEnd: windowEnd.toISOString(),
                estimatedArrival: new Date(estimatedArrivalMs).toISOString(),
              });
            }
          }
        }

        return { routeId: route.id, originalOrder, newOrder: optimized.stopIds, estimatedDuration, windowViolations };
```

- [ ] **Step 4: Update the return type and aggregate violations**

Find the `optimizedResults` filter line:

```typescript
const optimizedResults = results.filter(Boolean) as { routeId: string; originalOrder: string[]; newOrder: string[]; estimatedDuration: number }[];
```

Change to:

```typescript
const optimizedResults = results.filter(Boolean) as {
  routeId: string;
  originalOrder: string[];
  newOrder: string[];
  estimatedDuration: number;
  windowViolations: { stopId: string; address: string; windowEnd: string; estimatedArrival: string }[];
}[];
```

Find the final return:

```typescript
return { optimized: optimizedResults.length, routes: optimizedResults };
```

Change to include aggregated violations:

```typescript
const allViolations = optimizedResults.flatMap((r) => r.windowViolations);
return {
  optimized: optimizedResults.length,
  routes: optimizedResults,
  windowViolations: allViolations,
  departureAssumption: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit' }).format(new Date()) === plan.date
    ? 'Departure assumed at current time'
    : `Departure assumed at 08:00 AM on ${plan.date}`,
};
```

Note: `plan` is already in scope from the plan lookup earlier in the endpoint.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/routes/plans.ts
git commit -m "feat(optimizer): window violation detection — flags stops where ETA exceeds windowEnd"
```

---

## Task 2: Surface window violations on plan detail page

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/plans/[planId]/page.tsx`

- [ ] **Step 1: Extend the optimize response interface**

Find the `optimize` function. The `api.post` call returns void implicitly. Change to capture the response:

```typescript
  const optimize = async () => {
    setOptimizing(true);
    setError('');
    setWindowViolations([]);
    try {
      const result = await api.post<{
        optimized: number;
        windowViolations: { stopId: string; address: string; windowEnd: string; estimatedArrival: string }[];
        departureAssumption: string;
      }>(`/orgs/${user!.orgId}/plans/${planId}/optimize`, {});
      if (result.windowViolations?.length > 0) {
        setWindowViolations(result.windowViolations);
      }
      await loadPlan();
    } catch {
      setError('Optimization failed. Please try again.');
    } finally {
      setOptimizing(false);
    }
  };
```

- [ ] **Step 2: Add windowViolations state**

After `const [error, setError] = useState('');`, add:

```typescript
  const [windowViolations, setWindowViolations] = useState<{ stopId: string; address: string; windowEnd: string; estimatedArrival: string }[]>([]);
```

- [ ] **Step 3: Render the violation warning banner**

After the error banner (find `{error && <p ...>}` block), add:

```typescript
      {windowViolations.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  {windowViolations.length} delivery window{windowViolations.length !== 1 ? 's' : ''} may be missed
                </p>
                <p className="text-xs text-amber-700 mt-0.5">These stops are estimated to arrive after their delivery deadline. Resequence manually before distributing.</p>
                <div className="mt-2 space-y-1">
                  {windowViolations.slice(0, 3).map((v) => (
                    <p key={v.stopId} className="text-xs text-amber-800">
                      <strong>{v.address.split(',')[0]}</strong>
                      {' '}— window closes {new Date(v.windowEnd).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })},
                      {' '}arriving ~{new Date(v.estimatedArrival).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  ))}
                  {windowViolations.length > 3 && (
                    <p className="text-xs text-amber-600">+{windowViolations.length - 3} more</p>
                  )}
                </div>
              </div>
            </div>
            <button onClick={() => setWindowViolations([])} className="text-amber-400 hover:text-amber-600 shrink-0">✕</button>
          </div>
        </div>
      )}
```

Add `AlertTriangle` to the lucide-react import.

- [ ] **Step 4: Clear violations when plan reloads**

In `loadPlan`, after `setError('')`, add `setWindowViolations([]);` — this ensures stale violations don't persist if the plan is re-optimized.

Actually: keep violations visible after loadPlan() so the dispatcher can read them. Only clear on X dismiss or re-optimize. So do NOT clear in loadPlan. The `setWindowViolations([])` at the top of the `optimize` function handles this correctly.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/app/dashboard/plans/[planId]/page.tsx
git commit -m "feat(plans): surface delivery window violations after optimization"
```

---

## Self-Review

**Spec coverage:**
- windowEnd added to stops SELECT ✅
- windowByStopId lookup map ✅
- ETA computed from cumulative legs (correct — each leg is depot→s1, s1→s2, etc.) ✅
- Departure time: today=now, future=8am local ✅
- Violations only for stops WITH windowEnd set (stops without windowEnd skipped) ✅
- Return shape includes windowViolations + departureAssumption ✅
- Frontend: amber banner with readable violation list ✅
- Dismiss button ✅
- Banner clears on re-optimize ✅

**Edge cases:**
- Stop with windowEnd in the past before optimization runs: will be flagged (correct — dispatcher should know)
- All stops without windowEnd: allViolations = [], banner hidden ✅
- optimizedResults = [] (no geocoded stops): flatMap([]) = [], no banner ✅
- Single stop route: legs[0] gives travel time, checked against windowEnd ✅

**Clinical value**: Dispatchers operating under pharmacy delivery requirements can see window violations before distributing. Particularly important for:
- Controlled substances with mandatory delivery windows
- Refrigerated medications (insulin, etc.) with time limits
- Patient appointments requiring specific delivery times
