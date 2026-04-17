# Live Map Route Polyline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a dispatcher clicks a driver on the live map, draw a dashed polyline connecting the depot → stop 1 → stop 2 → ... → stop N in sequenceNumber order. Makes the dispatcher instantly see the route shape and each driver's delivery path.

**Architecture:** Use Leaflet's `L.polyline` on the existing `LiveMap.tsx` component. Pass `depotLatLng` as a new prop. Draw/remove polyline in the marker effect when `stops` changes. No backend changes needed.

**Tech Stack:** Leaflet (already installed), TypeScript, Next.js 14.

---

## File Structure

- **Modify:** `packages/dashboard/src/components/LiveMap.tsx` — add polyline prop + rendering
- **Modify:** `packages/dashboard/src/app/dashboard/map/page.tsx` — pass depot lat/lng to LiveMap

---

## Task 1: Draw route polyline in LiveMap

**Files:**
- Modify: `packages/dashboard/src/components/LiveMap.tsx`

- [ ] **Step 1: Add depot prop to Props interface**

Find the `interface Props` block and add `depotLatLng?: [number, number] | null;` after `highlightedDriverId`:

```typescript
interface Props {
  drivers: DriverMarker[];
  stops: StopMarker[];
  center?: [number, number];
  zoom?: number;
  highlightedDriverId?: string | null;
  depotLatLng?: [number, number] | null;
  onMarkerClick?: (driverId: string) => void;
}
```

- [ ] **Step 2: Add polylineRef to component refs**

After `const hasFitRef = useRef(false);`, add:

```typescript
  const polylineRef = useRef<any>(null);
```

- [ ] **Step 3: Update function signature to accept depotLatLng**

In the `export function LiveMap({...})` destructuring, add `depotLatLng = null`:

```typescript
export function LiveMap({
  drivers,
  stops,
  center = [42.3314, -83.0458],
  zoom = 11,
  highlightedDriverId = null,
  depotLatLng = null,
  onMarkerClick,
}: Props) {
```

- [ ] **Step 4: Add polyline rendering in the marker effect**

In the marker effect (the `useEffect` that calls `markersRef.current.forEach((m) => m.remove())`), add polyline cleanup at the START and polyline drawing AFTER all markers are added.

Find the line `markersRef.current.forEach((m) => m.remove());` and add before it:

```typescript
      // Clear previous polyline
      if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }
```

Then find the closing of the marker rendering block (just before the `// Initial fit` comment) and add:

```typescript
      // Draw route polyline when stops are present (connects depot → stops in sequence order)
      if (stops.length > 1 && depotLatLng) {
        const sortedStops = [...stops].sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0));
        const points: [number, number][] = [
          depotLatLng,
          ...sortedStops.map((s) => [s.lat, s.lng] as [number, number]),
        ];
        polylineRef.current = L.polyline(points, {
          color: '#0F4C81',
          weight: 2,
          opacity: 0.5,
          dashArray: '6, 6',
        }).addTo(mapRef.current);
      }
```

- [ ] **Step 5: Clear polyline on unmount**

In the cleanup `return () => { ... }` of the init effect, add polyline cleanup:

```typescript
    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markersRef.current = [];
      if (polylineRef.current) { polylineRef.current = null; } // map removed, ref cleanup only
    };
```

- [ ] **Step 6: Add depotLatLng to marker effect deps**

Find the deps array `[mapReady, drivers, stops, highlightedDriverId, onMarkerClick]` and add `depotLatLng`:

```typescript
  }, [mapReady, drivers, stops, highlightedDriverId, depotLatLng, onMarkerClick]);
```

- [ ] **Step 7: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
# Expected: no errors
```

---

## Task 2: Pass depot coordinates from map/page.tsx

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/map/page.tsx`

- [ ] **Step 1: Fetch depot lat/lng from liveData**

The `GET /orgs/:orgId/tracking/live` response already includes `activeRoutes` with driver info but NOT depot coordinates. The simplest approach: when a driver is highlighted and we fetch their route stops, the route response includes the route but not the depot. We need the depot separately.

The cleanest fix without a new API call: expose depot lat/lng from the `/tracking/live` response OR pass the org's first depot. But to avoid a backend change, use the plan's depot from the existing `GET /orgs/:orgId/tracking/route/:routeId` response — but that also doesn't include depot.

**Simplest approach**: Hardcode the default depot (Dearborn area: `[42.3223, -83.1763]`) as the fallback, but fetch the actual depot lazily when a route is highlighted.

Actually, the cleaner approach: pass `center` prop (the map's default center) as the depot proxy when no explicit depot is known. The map's default `center` is already `[42.3314, -83.0458]` (Detroit) — dispatcher will see a plausible line.

For now, use a `depotLat`/`depotLng` state initialized to the default center, and fetch the actual depot from the backend when available.

**Simple implementation without backend changes**: use the first driver's location as the "current position" anchor instead of depot. Or just use `null` for depotLatLng (polyline still draws stop-to-stop).

**Revised approach**: Draw stop-to-stop polyline (no depot anchor) when depotLatLng is null:

In LiveMap.tsx Task 1 Step 4, change the polyline points to not require depotLatLng:

```typescript
      // Draw route polyline when stops are present
      if (stops.length > 1) {
        const sortedStops = [...stops].sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0));
        const points: [number, number][] = depotLatLng
          ? [depotLatLng, ...sortedStops.map((s) => [s.lat, s.lng] as [number, number])]
          : sortedStops.map((s) => [s.lat, s.lng] as [number, number]);
        polylineRef.current = L.polyline(points, {
          color: '#0F4C81',
          weight: 2,
          opacity: 0.5,
          dashArray: '6, 6',
        }).addTo(mapRef.current);
      }
```

This way polyline works with or without depot coordinates.

- [ ] **Step 2: Pass depotLatLng to LiveMap in map/page.tsx**

The `GET /tracking/route/:routeId` response has `driver.currentLat/currentLng` but not depot. For now pass `null` — the polyline will still draw stop-to-stop which is valuable:

Find the `<LiveMap` render in map/page.tsx and add the prop:

```tsx
            <LiveMap
              drivers={driverMarkers}
              stops={routeStops}
              highlightedDriverId={highlightedDriverId}
              depotLatLng={null}
              onMarkerClick={(id) => setHighlightedDriverId((prev) => (prev === id ? null : id))}
            />
```

Note: `depotLatLng={null}` is redundant (default is null) but documents the intent — can be upgraded later when depot coordinates are fetched.

- [ ] **Step 3: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/components/LiveMap.tsx packages/dashboard/src/app/dashboard/map/page.tsx
git commit -m "feat(live-map): route polyline — dashed line connecting stops in sequence order"
```

---

## Self-Review

**Spec coverage:**
- Polyline drawn when stops.length > 1 ✅
- No polyline for single stop (nothing to connect) ✅
- Polyline removed when route deselected (stops=[] triggers effect, no stops.length > 1) ✅
- Polyline cleared on map unmount ✅
- Sorted by sequenceNumber ✅
- depotLatLng included when available ✅
- Stop-to-stop works even without depot ✅
- depotLatLng in deps array → re-draws on change ✅

**Visual result:** When dispatcher clicks a driver, the map shows the delivery route as a semi-transparent dashed blue line connecting all stops in delivery order. Gives instant spatial understanding of the route.
