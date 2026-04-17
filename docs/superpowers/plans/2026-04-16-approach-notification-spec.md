# Auto-Approach SMS Notification — Implementation Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-fire `stop_approaching` SMS to patients when driver is ≤3 stops away — replacing the current hardcoded/never-fired stub.

**Architecture:** Event-driven on stop status transitions. When a stop is marked `completed`/`arrived`, compute the real `stopsAhead` for all pending siblings on the same route and fire SMS to any within threshold. One new DB column (`approach_notified_at`) prevents duplicate sends.

**Tech Stack:** Drizzle ORM, Twilio SMS (via existing `sendStopNotification`), PostgreSQL migration

---

## Context

The `stop_approaching` SMS template exists in `notifications.ts`:
```
`Your delivery is ${d.stopsAway} stops away (~${d.etaMin} min). Track: ${d.trackingUrl}`
```

But it is **never automatically triggered**. If called manually, both `stopsAway` and `etaMin` default to hardcoded `'2'` and `'20'` — wrong for every patient.

The fix: hook into the existing `PATCH /:stopId/status` flow (already fires `stop_arrived`, `stop_completed`, etc.) and after each status update, check all sibling stops for threshold crossing.

`ETA_PER_STOP_MS = 8 * 60 * 1000` already defined in `tracking.ts`. Use same constant.

---

## File Structure

- **Modify:** `packages/backend/src/db/schema.ts` — add `approachNotifiedAt` to stops table
- **Create:** `packages/backend/src/db/migrations/0008_approach_notified_at.sql`
- **Modify:** `packages/backend/src/routes/stops.ts` — add `fireApproachNotifications`, wire into status PATCH
- **Modify:** `packages/backend/src/routes/tracking.ts` — export `ETA_PER_STOP_MS` constant for reuse

---

## Task 1: Migration + Schema

**Files:**
- Create: `packages/backend/src/db/migrations/0008_approach_notified_at.sql`
- Modify: `packages/backend/src/db/schema.ts`

- [ ] **Step 1: Create migration file**

```sql
-- 0008_approach_notified_at.sql
ALTER TABLE stops ADD COLUMN IF NOT EXISTS approach_notified_at TIMESTAMP;
```

- [ ] **Step 2: Add column to schema**

In `packages/backend/src/db/schema.ts`, find the `stops` table definition. After `completedAt`:

```typescript
approachNotifiedAt: timestamp('approach_notified_at'),
```

- [ ] **Step 3: Verify schema compiles**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/db/migrations/0008_approach_notified_at.sql packages/backend/src/db/schema.ts
git commit -m "feat(schema): add approach_notified_at to stops for SMS dedup"
```

---

## Task 2: `fireApproachNotifications` function

**Files:**
- Modify: `packages/backend/src/routes/stops.ts`

- [ ] **Step 1: Export ETA constant from tracking.ts**

In `packages/backend/src/routes/tracking.ts` line 14, change:
```typescript
const ETA_PER_STOP_MS = 8 * 60 * 1000;
```
to:
```typescript
export const ETA_PER_STOP_MS = 8 * 60 * 1000;
```

- [ ] **Step 2: Import in stops.ts**

At top of `packages/backend/src/routes/stops.ts`, add:
```typescript
import { ETA_PER_STOP_MS } from './tracking.js';
```

Also add `isNull` to the existing drizzle-orm imports if not already present (it is already — check line 4).

- [ ] **Step 3: Write the function**

Add after line 53 (after `checkAndNotifyRouteComplete`), before `export const stopRoutes`:

```typescript
const APPROACH_THRESHOLD = 3; // fire SMS when ≤ this many stops ahead
const TERMINAL: string[] = ['completed', 'failed', 'rescheduled'];

async function fireApproachNotifications(orgId: string, routeId: string): Promise<void> {
  const [route] = await db
    .select({ stopOrder: routes.stopOrder })
    .from(routes)
    .where(eq(routes.id, routeId))
    .limit(1);
  if (!route?.stopOrder) return;

  const stopOrder = route.stopOrder as string[];

  const pending = await db
    .select({
      id: stops.id,
      orgId: stops.orgId,
      recipientPhone: stops.recipientPhone,
      trackingToken: stops.trackingToken,
      routeId: stops.routeId,
      status: stops.status,
      approachNotifiedAt: stops.approachNotifiedAt,
    })
    .from(stops)
    .where(and(
      eq(stops.routeId, routeId),
      eq(stops.orgId, orgId),
      isNull(stops.deletedAt),
      isNull(stops.approachNotifiedAt),
    ));

  for (const stop of pending) {
    if (TERMINAL.includes(stop.status ?? '')) continue;
    const stopsAhead = stopOrder.indexOf(stop.id);
    if (stopsAhead <= 0 || stopsAhead > APPROACH_THRESHOLD) continue;

    const etaMin = Math.round(stopsAhead * ETA_PER_STOP_MS / 60000);

    // Mark notified first (prevents double-fire if Twilio is slow)
    await db.update(stops)
      .set({ approachNotifiedAt: new Date() })
      .where(and(eq(stops.id, stop.id), isNull(stops.approachNotifiedAt)));

    sendStopNotification(stop, 'stop_approaching', {
      stopsAway: String(stopsAhead),
      etaMin: String(etaMin),
    }).catch(console.error);
  }
}
```

- [ ] **Step 4: Wire into status PATCH**

In `stops.ts` around line 167 where other notifications are fired, add after the `sendDriverArrivalEmail` call:

```typescript
// Fire approach notifications for upcoming stops (e.g. 1-3 stops away)
if ((status === 'completed' || status === 'arrived') && updated.routeId) {
  fireApproachNotifications(updated.orgId, updated.routeId).catch(console.error);
}
```

Note: `checkAndNotifyRouteComplete` already has a similar guard for `completed/failed/rescheduled` — approach notifications fire on `completed` and `arrived` (arrived = driver is at previous stop, about to move).

- [ ] **Step 5: TypeScript check**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/routes/stops.ts packages/backend/src/routes/tracking.ts
git commit -m "feat(sms): auto-fire stop_approaching on route progress

Driver marking any stop arrived/completed now triggers approach notifications
for all sibling stops within APPROACH_THRESHOLD (3 stops) that haven't been
notified yet. Uses route.stopOrder to compute real stopsAhead.
approach_notified_at column prevents duplicate SMS sends."
```

---

## Task 3: Test the notification chain

**Files:**
- Test: via curl / manual trigger

- [ ] **Step 1: Verify `stop_approaching` template fires with real data**

After deploy or local run, trigger manually:
```bash
# PATCH stop status to 'arrived' for a stop that has 2 pending siblings ahead in stopOrder
curl -X PATCH http://localhost:3001/api/v1/routes/:routeId/stops/:stopId/status \
  -H "Authorization: Bearer <driver_token>" \
  -H "Content-Type: application/json" \
  -d '{"status":"arrived"}'
```

Expected: Twilio SMS fired for stops 1 and 2 positions ahead with real stopsAway + etaMin values

- [ ] **Step 2: Verify deduplication**

Run the same PATCH again (status won't change — guard blocks terminal re-update). Confirm no duplicate SMS sent.

- [ ] **Step 3: Verify terminal stops excluded**

Mark stop as `completed`. Confirm approach notifications for stops 0 ahead (current next stop) are NOT fired (stopsAhead <= 0 check).

---

## Self-Review Checklist

- [x] `sendStopNotification` already accepts `extra: Record<string, string>` — no signature change needed
- [x] Fire-and-forget pattern matches existing notification calls (`.catch(console.error)`)
- [x] Mark `approachNotifiedAt` BEFORE sending SMS — prevents race if Twilio is slow
- [x] `stopsAhead <= 0` guard — stop that is current (next up) returns index 0 → skip (they get `stop_arrived` instead)
- [x] `stopsAhead > APPROACH_THRESHOLD` guard — stops far away not spammed
- [x] `isNull(stops.approachNotifiedAt)` in query AND in update WHERE — double-dedup
- [x] `ETA_PER_STOP_MS` shared from tracking.ts — single source of truth for 8min/stop
- [x] No schema lock — migration uses `IF NOT EXISTS`, safe to run twice

---

## Priority: HIGH

Patient receives proactive notification when driver is ~16-24 min away. This directly improves prescription delivery trust — core to the pharmacy-patient relationship. Small implementation (2 files, 1 migration) with high patient-facing impact.
