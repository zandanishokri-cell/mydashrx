# SMS Patient Notification Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix SMS patient notifications — currently only `route_dispatched` fires; arrival, delivery, and failure SMS are silently dropped due to a key mismatch between stop status values and SMS template keys.

**Architecture:** Two-layer fix: (1) Add event mapping in `sendStopNotification` so status values resolve to template keys; (2) Enrich SMS with real driver name and org phone fetched at notification time. Both changes are isolated to `notifications.ts` — call sites don't change.

**Tech Stack:** TypeScript, Twilio SDK (already installed), Drizzle ORM, existing `SMS_TEMPLATES`

---

## Root Cause

`sendStopNotification(stop, event)` is called with stop **status values** (`arrived`, `completed`, `failed`) but `SMS_TEMPLATES` uses **event names** (`stop_arrived`, `stop_completed`, `stop_failed`).

```
status value      → template lookup       → result
─────────────────────────────────────────────────
'arrived'         → SMS_TEMPLATES['arrived']       → undefined → early return ❌
'completed'       → SMS_TEMPLATES['completed']     → undefined → early return ❌
'failed'          → SMS_TEMPLATES['failed']        → undefined → early return ❌
'route_dispatched'→ SMS_TEMPLATES['route_dispatched'] → ✅ (only working SMS)
```

**Impact:** Patients receive the "out for delivery" SMS but never: arrival at door, delivery confirmation, or failure notification.

**Secondary issue:** SMS body uses `driverName: 'Your driver'` and `pharmacyPhone: 'your pharmacy'` — placeholder text because no context is passed.

---

## File Structure

- **Modify:** `packages/backend/src/services/notifications.ts`
  - Add `STATUS_TO_SMS_EVENT` map
  - Add driver name + org phone enrichment in `sendStopNotification`
  - Add `rescheduled` template

No other files require changes — call sites already pass status correctly.

---

## Task 1: Fix event key mapping + add rescheduled template

**Files:**
- Modify: `packages/backend/src/services/notifications.ts`

- [ ] **Step 1: Add STATUS_TO_SMS_EVENT map**

After the `SMS_TEMPLATES` const, add:

```typescript
// Maps stop status values → SMS event template keys
const STATUS_TO_SMS_EVENT: Record<string, string> = {
  arrived: 'stop_arrived',
  completed: 'stop_completed',
  failed: 'stop_failed',
  rescheduled: 'stop_rescheduled',
};
```

- [ ] **Step 2: Add rescheduled template to SMS_TEMPLATES**

In `SMS_TEMPLATES`, add:

```typescript
stop_rescheduled: (d) =>
  `We were unable to deliver today. Your prescription will be rescheduled. Call ${d.pharmacyPhone} with questions.`,
```

- [ ] **Step 3: Apply mapping in sendStopNotification**

In `sendStopNotification`, replace:
```typescript
const template = SMS_TEMPLATES[event];
if (!template || !stop.recipientPhone) return;
```

With:
```typescript
const resolvedEvent = STATUS_TO_SMS_EVENT[event] ?? event;
const template = SMS_TEMPLATES[resolvedEvent];
if (!template || !stop.recipientPhone) return;
```

- [ ] **Step 4: TypeScript check**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/notifications.ts
git commit -m "fix(sms): stop status values never matched template keys — arrival/delivery/failure SMS dropped"
```

---

## Task 2: Enrich SMS with real driver name and org phone

**Files:**
- Modify: `packages/backend/src/services/notifications.ts`

Context: Currently SMS body shows `"Your driver has arrived"` and `"call your pharmacy"`. Both fields exist in DB but aren't fetched.

- [ ] **Step 1: Add organizations import to notifications.ts imports**

Current imports include `organizations` already (for driver arrival email). Verify:

```typescript
import { notificationLogs, organizations, users, drivers, routes } from '../db/schema.js';
```

If `drivers` and `routes` are missing, add them.

- [ ] **Step 2: Enrich sendStopNotification with context lookup**

Replace the current simple org lookup with full context:

```typescript
export async function sendStopNotification(
  stop: {
    id: string;
    orgId: string;
    recipientPhone: string;
    trackingToken: unknown;
    routeId?: string | null;
    status?: string;
  },
  event: string,
  extra: Record<string, string> = {},
): Promise<void> {
  const resolvedEvent = STATUS_TO_SMS_EVENT[event] ?? event;
  const template = SMS_TEMPLATES[resolvedEvent];
  if (!template || !stop.recipientPhone) return;

  // Fetch org + driver context in parallel
  const [orgRow, driverRow] = await Promise.all([
    db.select({ name: organizations.name, phone: organizations.phone })
      .from(organizations).where(eq(organizations.id, stop.orgId)).limit(1)
      .then(r => r[0]),
    stop.routeId
      ? db.select({ name: drivers.name })
          .from(drivers)
          .innerJoin(routes, eq(routes.driverId, drivers.id))
          .where(eq(routes.id, stop.routeId))
          .limit(1)
          .then(r => r[0])
      : Promise.resolve(undefined),
  ]);

  const trackingUrl = `${process.env.DASHBOARD_URL ?? 'https://app.mydashrx.com'}/track/${String(stop.trackingToken)}`;

  const body = template({
    pharmacyName: orgRow?.name ?? 'Your Pharmacy',
    pharmacyPhone: orgRow?.phone ?? 'your pharmacy',
    driverName: driverRow?.name ?? 'Your driver',
    trackingUrl,
    stopsAway: '2',
    etaMin: '20',
    ...extra,
  });

  try {
    const msg = await getClient().messages.create({
      body,
      from: process.env.TWILIO_FROM_NUMBER!,
      to: stop.recipientPhone,
    });
    await db.insert(notificationLogs).values({
      stopId: stop.id,
      event: resolvedEvent,
      channel: 'sms',
      recipient: stop.recipientPhone,
      status: 'sent',
      externalId: msg.sid,
    });
  } catch (err) {
    await db.insert(notificationLogs).values({
      stopId: stop.id,
      event: resolvedEvent,
      channel: 'sms',
      recipient: stop.recipientPhone,
      status: 'failed',
    });
    console.error('SMS notification failed:', err);
  }
}
```

Note: `drivers` and `routes` tables need to be imported. `innerJoin` and `eq` already imported.

- [ ] **Step 3: TypeScript check**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/notifications.ts
git commit -m "fix(sms): enrich patient notifications with real driver name and pharmacy phone"
```

---

## Self-Review

**Spec coverage:**
- Root cause (key mismatch) fixed via STATUS_TO_SMS_EVENT map ✅
- `arrived` → `stop_arrived` template ✅
- `completed` → `stop_completed` template ✅
- `failed` → `stop_failed` template ✅
- `rescheduled` → `stop_rescheduled` template (new) ✅
- Driver name from DB via routes join ✅
- Org phone from DB ✅
- `route_dispatched` still works (no mapping entry → falls through to direct key lookup) ✅
- `notificationLogs` now records resolved event name (better audit trail) ✅

**No call site changes needed** — `sendStopNotification(updated, status)` callers in stops.ts and driverApp.ts are correct as-is.

**Risk:**
- DB queries added to notification path — both are single-row lookups with PK/FK, fast ✅
- `Promise.all` parallel fetch minimizes latency ✅
- Entire function is fire-and-forget at call site — latency doesn't block stop status response ✅
