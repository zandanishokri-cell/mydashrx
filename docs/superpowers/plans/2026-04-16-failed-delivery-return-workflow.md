# Failed Delivery Return Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the controlled-substance compliance gap where failed deliveries have no return confirmation, re-delivery scheduling, or pharmacist notification beyond the route completion email. Michigan MCL 333.7334 requires CS items to be returned to pharmacy inventory — this feature creates the audit trail.

**Architecture:** Add `returnedAt` + `redeliveryScheduledAt` timestamps to stops. Add `POST /driver/me/stops/:stopId/return-confirm` endpoint. Add driver return confirmation UI after failed stop. Add pharmacist queue section for "Awaiting Return" stops. No new tables needed — extends existing stops model.

**Tech Stack:** Drizzle ORM + Fastify (backend), React (frontend), existing notification pattern (sendStopNotification)

---

## Background: Current Gap

When a stop is marked `failed`:
- `stops.status = 'failed'` ✅
- `failureReason` / `failureNote` stored ✅
- Route completion email mentions failed address ✅
- Automation `stop_failed` trigger fires ✅

**Missing:**
- No confirmation that driver actually returned the medication to pharmacy ❌
- No re-delivery scheduling UI ❌
- Pharmacist has no way to see which stops are "failed but not yet returned" ❌
- Controlled substance stops have no return audit trail ❌

---

## File Structure

- **Migrate:** `packages/backend/src/db/migrations/0009_failed_delivery_return.sql`
- **Modify:** `packages/backend/src/db/schema.ts` — add `returnedAt`, `redeliveryScheduledAt` to stops
- **Modify:** `packages/backend/src/routes/driverApp.ts` — add `POST /me/stops/:stopId/return-confirm`
- **Modify:** `packages/dashboard/src/app/driver/stops/[stopId]/page.tsx` — add return confirm CTA after failed stop
- **Modify:** `packages/backend/src/routes/stops.ts` — expose `returnedAt` filter for dispatcher view
- **Modify:** `packages/dashboard/src/app/pharmacist/queue/page.tsx` — add "Awaiting Return" section

---

## Task 1: Schema + migration

**Files:**
- Migrate: `packages/backend/src/db/migrations/0009_failed_delivery_return.sql`
- Modify: `packages/backend/src/db/schema.ts`

- [ ] **Step 1: Write migration**

```sql
-- 0009_failed_delivery_return.sql
ALTER TABLE stops ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP;
ALTER TABLE stops ADD COLUMN IF NOT EXISTS redelivery_scheduled_at TIMESTAMP;
```

- [ ] **Step 2: Add columns to schema**

In `packages/backend/src/db/schema.ts`, in the `stops` table object, after `completedAt`:
```typescript
returnedAt: timestamp('returned_at'),
redeliveryScheduledAt: timestamp('redelivery_scheduled_at'),
```

- [ ] **Step 3: Verify TypeScript still compiles**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: 0 errors
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/db/migrations/0009_failed_delivery_return.sql packages/backend/src/db/schema.ts
git commit -m "feat(return-delivery): add returnedAt + redeliveryScheduledAt columns to stops"
```

---

## Task 2: Backend — return confirm endpoint

**Files:**
- Modify: `packages/backend/src/routes/driverApp.ts`

- [ ] **Step 1: Add return-confirm route**

After the existing POD routes (around the `pod` route block), add:

```typescript
// POST /me/stops/:stopId/return-confirm — driver confirms CS/failed package returned to pharmacy
app.post('/me/stops/:stopId/return-confirm', {
  preHandler: requireRole('driver'),
}, async (req, reply) => {
  const jwtUser = req.user as { sub: string; driverId?: string; orgId: string };
  const driverId = jwtUser.driverId ?? jwtUser.sub;
  const { stopId } = req.params as { stopId: string };

  // Verify driver owns this stop via active/recent route
  const [stop] = await db
    .select({ id: stops.id, status: stops.status, returnedAt: stops.returnedAt, routeId: stops.routeId, orgId: stops.orgId, controlledSubstance: stops.controlledSubstance })
    .from(stops)
    .where(and(eq(stops.id, stopId), eq(stops.orgId, jwtUser.orgId), isNull(stops.deletedAt)))
    .limit(1);

  if (!stop) return reply.code(404).send({ error: 'Stop not found' });
  if (stop.status !== 'failed') return reply.code(409).send({ error: 'Can only confirm return for failed stops' });
  if (stop.returnedAt) return reply.code(409).send({ error: 'Return already confirmed' });

  // Verify driver owns the route
  if (stop.routeId) {
    const [route] = await db
      .select({ driverId: routes.driverId })
      .from(routes)
      .where(eq(routes.id, stop.routeId))
      .limit(1);
    if (route?.driverId && route.driverId !== driverId) {
      return reply.code(403).send({ error: 'Not your route' });
    }
  }

  const [updated] = await db.update(stops)
    .set({ returnedAt: new Date() })
    .where(and(eq(stops.id, stopId), isNull(stops.returnedAt)))
    .returning();

  if (!updated) return reply.code(409).send({ error: 'Return already confirmed' });

  // Fire automation trigger: stop_returned
  fireTrigger({
    orgId: jwtUser.orgId,
    trigger: 'stop_returned',
    resourceId: stopId,
    data: {
      patientName: '', // stops don't return full data here — fire-and-forget
      address: '',
      stopStatus: 'failed',
      controlledSubstance: String(stop.controlledSubstance ?? false),
    },
  }).catch(console.error);

  return { ok: true, returnedAt: updated.returnedAt };
});
```

- [ ] **Step 2: Verify needed imports are present**

Check that `fireTrigger`, `routes`, `isNull` are imported at the top of `driverApp.ts`. Add any missing:
```typescript
import { fireTrigger } from '../services/automation.js'; // if not present
```

- [ ] **Step 3: TypeScript check + commit**

```bash
cd packages/backend && npx tsc --noEmit
git add packages/backend/src/routes/driverApp.ts
git commit -m "feat(return-delivery): POST /me/stops/:stopId/return-confirm endpoint for drivers"
```

---

## Task 3: Driver app UI — return confirm CTA

**Files:**
- Modify: `packages/dashboard/src/app/driver/stops/[stopId]/page.tsx`

The existing driver stop detail page already shows failed stops. We need to add a "Confirm Return to Pharmacy" button that appears when status='failed' and returnedAt is null.

- [ ] **Step 1: Add `returnedAt` to Stop interface**

Find the `Stop` interface in the file and add:
```typescript
returnedAt: string | null;
```

- [ ] **Step 2: Add state variables after existing state**

After the last `useState` declaration:
```typescript
const [confirming, setConfirming] = useState(false);
const [confirmError, setConfirmError] = useState('');
```

- [ ] **Step 3: Add confirm handler function**

After existing handler functions (before `return` statement):
```typescript
const confirmReturn = async () => {
  if (!stop) return;
  setConfirming(true);
  setConfirmError('');
  try {
    await api.post(`/driver/me/stops/${stop.id}/return-confirm`, {});
    setStop(s => s ? { ...s, returnedAt: new Date().toISOString() } : s);
  } catch {
    setConfirmError('Failed to confirm return. Please try again.');
  } finally {
    setConfirming(false);
  }
};
```

- [ ] **Step 4: Add return confirm section in JSX**

Find where the failed status is displayed (likely a red status card or failed banner). Add below it, conditionally:

```tsx
{stop.status === 'failed' && (
  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
    <p className="text-sm font-medium text-amber-800">
      {stop.returnedAt
        ? `✓ Returned to pharmacy ${new Date(stop.returnedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : stop.controlledSubstance
          ? '⚠ Controlled substance — confirm return to pharmacy'
          : 'Delivery failed — confirm package returned to pharmacy'
      }
    </p>
    {!stop.returnedAt && (
      <>
        {confirmError && <p className="text-xs text-red-600">{confirmError}</p>}
        <button
          onClick={confirmReturn}
          disabled={confirming}
          className="w-full py-2.5 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {confirming ? <Loader2 size={14} className="animate-spin" /> : null}
          Confirm Returned to Pharmacy
        </button>
      </>
    )}
  </div>
)}
```

- [ ] **Step 5: Ensure `Loader2` is imported from lucide-react**

```typescript
import { ..., Loader2 } from 'lucide-react'; // add if missing
```

- [ ] **Step 6: TypeScript check + commit**

```bash
cd packages/dashboard && npx tsc --noEmit
git add packages/dashboard/src/app/driver/stops/[stopId]/page.tsx
git commit -m "feat(return-delivery): driver return confirm CTA on failed stop detail"
```

---

## Task 4: Pharmacist queue — Awaiting Return section

**Files:**
- Modify: `packages/dashboard/src/app/pharmacist/queue/page.tsx`

The pharmacist queue currently shows: Driver Arrived, Pending Dispensing, Awaiting Pickup. We need to add an "Awaiting Return" section that shows failed stops where `returnedAt` is null.

- [ ] **Step 1: Add `returnedAt` and `controlledSubstance` to Stop interface**

Find the Stop interface and add:
```typescript
returnedAt: string | null;
controlledSubstance: boolean;
```

- [ ] **Step 2: Add `awaitingReturn` to queue response parsing**

The queue endpoint returns different sections. Check what `/pharmacist/queue` returns. Add:
```typescript
const awaitingReturn: Stop[] = (data.awaitingReturn ?? []) as Stop[];
```

- [ ] **Step 3: Backend — expose awaitingReturn in queue endpoint**

In `packages/backend/src/routes/pharmacist.ts`, in the `/queue` GET handler, add:
```typescript
const awaitingReturn = await db
  .select()
  .from(stops)
  .where(and(
    eq(stops.orgId, orgId),
    eq(stops.status, 'failed'),
    isNull(stops.returnedAt),
    isNull(stops.deletedAt),
  ))
  .orderBy(desc(stops.completedAt));
```

Add to the response object:
```typescript
awaitingReturn,
```

- [ ] **Step 4: Add Awaiting Return section to frontend**

After the existing "Awaiting Pickup" section, add:
```tsx
{awaitingReturn.length > 0 && (
  <section>
    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
      <span className="w-2 h-2 bg-amber-400 rounded-full" />
      Awaiting Return ({awaitingReturn.length})
    </h2>
    <div className="space-y-2">
      {awaitingReturn.map(stop => (
        <div key={stop.id} className={`bg-white border rounded-xl px-4 py-3 ${stop.controlledSubstance ? 'border-amber-300' : 'border-gray-100'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-800">{stop.recipientName}</p>
              <p className="text-xs text-gray-400 mt-0.5">{stop.address}</p>
            </div>
            <div className="flex items-center gap-2">
              {stop.controlledSubstance && (
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">CS</span>
              )}
              <span className="text-xs text-gray-400">Pending return</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  </section>
)}
```

- [ ] **Step 5: TypeScript check + commit**

```bash
cd packages/dashboard && npx tsc --noEmit
cd packages/backend && npx tsc --noEmit
git add packages/backend/src/routes/pharmacist.ts packages/dashboard/src/app/pharmacist/queue/page.tsx
git commit -m "feat(return-delivery): pharmacist queue Awaiting Return section"
```

---

## Self-Review

**Spec coverage:**
- Schema gap (no return tracking): Task 1 ✅
- Driver can confirm return: Tasks 2 + 3 ✅
- Pharmacist can see pending returns: Task 4 ✅
- Controlled substance highlighted: Tasks 3 + 4 ✅
- Idempotency (can't double-confirm): Task 2 (isNull guard + 409) ✅
- Driver ownership verified: Task 2 (route.driverId check) ✅

**No migrations needed beyond 0009** — returnedAt + redeliveryScheduledAt are the only new fields.

**Re-delivery scheduling deferred** — `redeliveryScheduledAt` column is added now but UI deferred. Dispatcher can create a new stop manually for re-delivery.

**Risks:**
- `pharmacist.ts` queue endpoint structure may differ from expected — check actual response shape before Task 4 Step 3
- `driver/stops/[stopId]/page.tsx` may not currently fetch `returnedAt` — backend `/me/routes/:routeId/stops/:stopId` must include the field in SELECT
- `stop_returned` automation trigger must be added to `Trigger` type in `automation/page.tsx` frontend + backend schema enum — defer to a follow-up if complex
