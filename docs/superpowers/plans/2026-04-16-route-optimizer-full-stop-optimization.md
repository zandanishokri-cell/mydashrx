# Route Optimizer — Full-Stop Optimization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the destination-locking bug in `routeOptimizer.ts` — currently only N-1 stops are optimized (last stop in DB select order is permanently locked as the route endpoint). After this fix, ALL N stops participate in optimization.

**Architecture:** Change the Google Directions API call to use ALL stops as intermediate waypoints (with `optimize:true`) and the depot as the destination. Extract the delivery legs only (exclude the return-to-depot leg from the reported distance/duration). The nearest-neighbor fallback is already correct — no change needed there.

**Tech Stack:** Google Directions API, TypeScript, Fastify backend.

---

## Background

### Current bug (routeOptimizer.ts lines 96–116)

```typescript
const intermediate = stops.slice(0, -1);   // N-1 stops
const destination = stops[stops.length - 1]; // last stop — LOCKED
params.waypoints = `optimize:true|${intermediate.map(s => `${s.lat},${s.lng}`).join('|')}`;
// Google optimizes intermediate (N-1 stops) but destination is always the last input stop
```

Since `stops` comes from `db.select().from(stops).where(...)` with NO ORDER BY, the "last stop" is non-deterministic (depends on Postgres internal row ordering). For 10 stops: 9 are optimized, 1 is locked as the endpoint. If that locked stop happens to be near the depot, the driver makes an unnecessary backtrack at the end.

### Correct approach

Use depot as both origin AND destination (return-to-depot circuit). Google's Directions API with `optimize:true` then freely reorders ALL N stops as intermediate waypoints. We report only the delivery legs (legs 0..N-1), discarding the final return-to-depot leg from the result.

**Why return-to-depot?** It's the canonical way to get Google to optimize ALL N stops. Drivers in practice don't need to physically return; we just use the circuit for optimization math and throw away the final leg from the UI distance/duration.

---

## File Structure

- **Modify:** `packages/backend/src/services/routeOptimizer.ts` — change Google multi-stop path only

---

## Task 1: Fix the destination-locking bug

**Files:**
- Modify: `packages/backend/src/services/routeOptimizer.ts`

- [ ] **Step 1: Read the current multi-stop Google path (lines 96–127)**

Current code for multi-stop (2+ stops):
```typescript
const intermediate = stops.slice(0, -1);
const destination = stops[stops.length - 1];
const params: Record<string, string> = {
  origin: `${originLat},${originLng}`,
  destination: `${destination.lat},${destination.lng}`,
  key: process.env.GOOGLE_MAPS_API_KEY,
  departure_time: 'now',
};
if (intermediate.length > 0) {
  params.waypoints = `optimize:true|${intermediate.map((s) => `${s.lat},${s.lng}`).join('|')}`;
}

// ... fetch ...

const waypointOrder: number[] = route.waypoint_order ?? [];
const orderedIntermediate = waypointOrder.map((i: number) => intermediate[i]);
const orderedStops = [...orderedIntermediate, destination];
const legs = route.legs.map((leg: any) => ({
  distanceKm: leg.distance.value / 1000,
  durationMin: Math.ceil((leg.duration_in_traffic?.value ?? leg.duration.value) / 60),
}));

return {
  stopIds: orderedStops.map((s) => s.id),
  totalDistance: legs.reduce((sum: number, l: any) => sum + l.distanceKm, 0),
  totalDuration: legs.reduce((sum: number, l: any) => sum + l.durationMin, 0),
  legs,
};
```

- [ ] **Step 2: Replace the multi-stop Google path**

Replace the entire block from `const intermediate = stops.slice(0, -1);` through the closing `return {...};` (NOT the single-stop path above it, NOT the catch block below):

```typescript
    // All N stops as waypoints — depot as both origin and destination (return-to-depot circuit)
    // This lets Google freely optimize the order of ALL stops.
    const params: Record<string, string> = {
      origin: `${originLat},${originLng}`,
      destination: `${originLat},${originLng}`,
      waypoints: `optimize:true|${stops.map((s) => `${s.lat},${s.lng}`).join('|')}`,
      key: process.env.GOOGLE_MAPS_API_KEY!,
      departure_time: 'now',
    };

    const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?` + new URLSearchParams(params));
    const data = (await res.json()) as any;
    if (data.status !== 'OK') throw new Error(`Maps error: ${data.status}`);
    if (!data.routes?.[0]) throw new Error('No route returned');

    const route = data.routes[0];
    const waypointOrder: number[] = route.waypoint_order ?? [];
    // Reorder ALL stops based on Google's optimized order
    const orderedStops = waypointOrder.map((i: number) => stops[i]);

    // route.legs has N+1 entries: depot→s1→...→sN→depot
    // We only report the N delivery legs (exclude the final return-to-depot leg).
    const deliveryLegs = (route.legs as any[]).slice(0, stops.length).map((leg: any) => ({
      distanceKm: leg.distance.value / 1000,
      durationMin: Math.ceil((leg.duration_in_traffic?.value ?? leg.duration.value) / 60),
    }));

    return {
      stopIds: orderedStops.map((s) => s.id),
      totalDistance: deliveryLegs.reduce((sum, l) => sum + l.distanceKm, 0),
      totalDuration: deliveryLegs.reduce((sum, l) => sum + l.durationMin, 0),
      legs: deliveryLegs,
    };
```

- [ ] **Step 3: Verify the 1-stop path is unchanged**

The single-stop path (lines 77–93) uses `stops[0]` as both waypoint and destination — correct, no change needed.

- [ ] **Step 4: TypeScript check**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/routeOptimizer.ts
git commit -m "fix(optimizer): optimize all N stops — was locking last stop as fixed destination"
```

---

## Self-Review

**Spec coverage:**
- All N stops freely optimizable ✅
- Nearest-neighbor fallback unchanged ✅
- Single-stop path unchanged ✅
- `waypointOrder` correctly maps to full `stops` array (not just `intermediate`) ✅
- N delivery legs extracted from N+1 circuit legs (slice off return-to-depot) ✅
- `totalDistance` / `totalDuration` exclude return leg ✅

**Edge cases:**
- `stops.length === 0` — handled by the early return at the top of `optimizeRoute`
- `stops.length === 1` — handled by the single-stop path above (unchanged)
- `waypoint_order` missing — defaults to `[]`, `waypointOrder.map(i => stops[i])` returns empty array. Then `orderedStops = []`. Bug: if `waypoint_order` is absent, we lose all stops. Guard: `const waypointOrder = route.waypoint_order ?? stops.map((_,i) => i);` (identity order if Google omits it)
- `route.legs.length < stops.length` — defensive: `slice(0, stops.length)` already handles this safely

**Fix the edge case from self-review:** In Step 2, change:
```typescript
const waypointOrder: number[] = route.waypoint_order ?? [];
```
to:
```typescript
// Fall back to identity order if Google omits waypoint_order (shouldn't happen but be safe)
const waypointOrder: number[] = route.waypoint_order ?? stops.map((_, i) => i);
```
