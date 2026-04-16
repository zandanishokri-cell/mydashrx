# Usage Limit Enforcement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce `stopLimit` and `driverLimit` from billing plans at creation time — Starter orgs (limit: 100 stops/mo, 2 drivers) currently create unlimited stops and drivers silently.

**Architecture:** Shared helper `usageLimits.ts` checks org plan + current usage, returns `{allowed, current, limit}`. Called at the top of POST /stops, POST /import/stops, and POST /drivers. Returns HTTP 402 on limit exceeded. Frontend shows upgrade CTA on 402.

**Tech Stack:** Drizzle ORM, Fastify, Next.js 14, TypeScript. No migrations needed — all existing columns.

---

## Background

The `PLANS` object in `billing.ts` defines limits:
```typescript
starter:    { stopLimit: 100,  driverLimit: 2  }
growth:     { stopLimit: 500,  driverLimit: 10 }
pro:        { stopLimit: 2000, driverLimit: 50 }
enterprise: { stopLimit: null, driverLimit: null }  // null = unlimited
```

These are returned to the frontend in GET /billing/plan with usage stats. But they are **never checked before creation**. A Starter org importing 500 stops gets them all created — undermining the billing model entirely.

---

## File Structure

- **Create:** `packages/backend/src/utils/usageLimits.ts` — `checkStopLimit(orgId)` + `checkDriverLimit(orgId)`
- **Modify:** `packages/backend/src/routes/search.ts` — add stop limit check to POST /stops
- **Modify:** `packages/backend/src/routes/import.ts` — add stop limit check to POST /stops/import (bulk-aware)
- **Modify:** `packages/backend/src/routes/drivers.ts` — add driver limit check to POST /
- **Modify:** `packages/dashboard/src/components/NewStopModal.tsx` — handle 402 with upgrade CTA
- **Modify:** `packages/dashboard/src/components/CsvImportModal.tsx` — handle 402 with upgrade CTA
- **Modify:** `packages/dashboard/src/app/driver/stops/drivers/page.tsx` — handle 402 on driver create

---

## Task 1: Usage limit helper

**Files:**
- Create: `packages/backend/src/utils/usageLimits.ts`

- [ ] **Step 1: Create the helper**

```typescript
// packages/backend/src/utils/usageLimits.ts
import { db } from '../db/connection.js';
import { organizations, stops, drivers } from '../db/schema.js';
import { eq, and, isNull, gte, count } from 'drizzle-orm';

const PLAN_LIMITS: Record<string, { stopLimit: number | null; driverLimit: number | null }> = {
  starter:    { stopLimit: 100,  driverLimit: 2 },
  growth:     { stopLimit: 500,  driverLimit: 10 },
  pro:        { stopLimit: 2000, driverLimit: 50 },
  enterprise: { stopLimit: null, driverLimit: null },
};

interface LimitResult {
  allowed: boolean;
  current: number;
  limit: number | null;
  wouldExceedBy?: number; // for bulk imports
}

export async function checkStopLimit(orgId: string, addingCount = 1): Promise<LimitResult> {
  const [org] = await db
    .select({ billingPlan: organizations.billingPlan })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return { allowed: false, current: 0, limit: 0 };

  const plan = PLAN_LIMITS[org.billingPlan] ?? PLAN_LIMITS.starter;
  if (plan.stopLimit === null) return { allowed: true, current: 0, limit: null };

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [row] = await db
    .select({ n: count() })
    .from(stops)
    .where(and(eq(stops.orgId, orgId), isNull(stops.deletedAt), gte(stops.createdAt, monthStart)));

  const current = row?.n ?? 0;
  const wouldExceedBy = Math.max(0, current + addingCount - plan.stopLimit);
  return {
    allowed: current + addingCount <= plan.stopLimit,
    current,
    limit: plan.stopLimit,
    wouldExceedBy: wouldExceedBy > 0 ? wouldExceedBy : undefined,
  };
}

export async function checkDriverLimit(orgId: string): Promise<LimitResult> {
  const [org] = await db
    .select({ billingPlan: organizations.billingPlan })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!org) return { allowed: false, current: 0, limit: 0 };

  const plan = PLAN_LIMITS[org.billingPlan] ?? PLAN_LIMITS.starter;
  if (plan.driverLimit === null) return { allowed: true, current: 0, limit: null };

  const [row] = await db
    .select({ n: count() })
    .from(drivers)
    .where(and(eq(drivers.orgId, orgId), isNull(drivers.deletedAt)));

  const current = row?.n ?? 0;
  return { allowed: current < plan.driverLimit, current, limit: plan.driverLimit };
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/utils/usageLimits.ts
git commit -m "feat(utils): add checkStopLimit and checkDriverLimit usage enforcement helpers"
```

---

## Task 2: Enforce stop limit on single stop creation

**Files:**
- Modify: `packages/backend/src/routes/search.ts` — POST /orgs/:orgId/stops (line ~413)

- [ ] **Step 1: Add import at top of search.ts**

```typescript
import { checkStopLimit } from '../utils/usageLimits.js';
```

- [ ] **Step 2: Add limit check after body validation**

In POST /orgs/:orgId/stops, after the `if (!body.address?.trim())` guard and before the `db.insert`:

```typescript
// BEFORE the db.insert:
const limitCheck = await checkStopLimit(orgId);
if (!limitCheck.allowed) {
  return reply.code(402).send({
    error: 'Stop limit reached',
    message: `Your plan allows ${limitCheck.limit} stops per month. You've used ${limitCheck.current}. Upgrade to add more stops.`,
    current: limitCheck.current,
    limit: limitCheck.limit,
  });
}
```

- [ ] **Step 3: TypeScript check + commit**

```bash
cd packages/backend && npx tsc --noEmit
git add packages/backend/src/routes/search.ts
git commit -m "feat(stops): enforce monthly stop limit on single stop creation (402 on limit reached)"
```

---

## Task 3: Enforce stop limit on CSV import

**Files:**
- Modify: `packages/backend/src/routes/import.ts` — POST /orgs/:orgId/stops/import (line ~42)

- [ ] **Step 1: Add import at top of import.ts**

```typescript
import { checkStopLimit } from '../utils/usageLimits.js';
```

- [ ] **Step 2: Check limit before import processing**

In POST /orgs/:orgId/stops/import, after body parsing and before the geocoding loop, add:

```typescript
// Check if import count would exceed monthly limit
// parsedStops is the array of valid rows after CSV parse
const limitCheck = await checkStopLimit(orgId, parsedStops.length);
if (!limitCheck.allowed) {
  return reply.code(402).send({
    error: 'Stop limit exceeded',
    message: `Importing ${parsedStops.length} stops would exceed your plan limit of ${limitCheck.limit}/month (currently at ${limitCheck.current}). You can import up to ${Math.max(0, (limitCheck.limit ?? 0) - limitCheck.current)} more stops this month.`,
    current: limitCheck.current,
    limit: limitCheck.limit,
    wouldExceedBy: limitCheck.wouldExceedBy,
  });
}
```

Note: To insert this correctly, read `import.ts` to find where `parsedStops` (or equivalent) is defined before the insert. The actual variable name may differ — read the file to find the right insertion point.

- [ ] **Step 3: TypeScript check + commit**

```bash
cd packages/backend && npx tsc --noEmit
git add packages/backend/src/routes/import.ts
git commit -m "feat(import): enforce monthly stop limit on CSV import — block whole import if would exceed"
```

---

## Task 4: Enforce driver limit on driver creation

**Files:**
- Modify: `packages/backend/src/routes/drivers.ts` — POST / (line ~57)

- [ ] **Step 1: Add import at top of drivers.ts**

```typescript
import { checkDriverLimit } from '../utils/usageLimits.js';
```

- [ ] **Step 2: Add limit check after body validation**

In POST /, after the `if (!body.name || !body.email || !body.password)` guard and before `hashPassword`:

```typescript
const limitCheck = await checkDriverLimit(orgId);
if (!limitCheck.allowed) {
  return reply.code(402).send({
    error: 'Driver limit reached',
    message: `Your plan allows ${limitCheck.limit} active drivers. You have ${limitCheck.current}. Upgrade to add more drivers.`,
    current: limitCheck.current,
    limit: limitCheck.limit,
  });
}
```

- [ ] **Step 3: TypeScript check + commit**

```bash
cd packages/backend && npx tsc --noEmit
git add packages/backend/src/routes/drivers.ts
git commit -m "feat(drivers): enforce driver limit at creation (402 on limit reached)"
```

---

## Task 5: Frontend — handle 402 with upgrade CTA

**Files:**
- Modify: `packages/dashboard/src/components/NewStopModal.tsx`
- Modify: `packages/dashboard/src/components/CsvImportModal.tsx`
- Modify: `packages/dashboard/src/app/dashboard/drivers/page.tsx` (or wherever Add Driver form lives — check the file)

The upgrade CTA pattern to use when catching a 402 error:

```tsx
// In the catch block of stop/driver creation:
} catch (e: any) {
  if (e.message?.includes('402') || e.message?.toLowerCase().includes('limit reached') || e.message?.toLowerCase().includes('limit exceeded')) {
    setError('Plan limit reached. Upgrade your plan to add more stops.');
    // Optionally: show a link to billing
    setShowUpgradeCta(true);
  } else {
    setError('Failed to create stop. Please try again.');
  }
}
```

For each component, add an `upgradeCta` conditional below the error text:

```tsx
{showUpgradeCta && (
  <p className="text-xs text-amber-600 mt-1">
    <a href="/dashboard/billing" className="font-medium underline hover:no-underline">
      Upgrade your plan →
    </a>
  </p>
)}
```

- [ ] **Step 1: Read NewStopModal.tsx to find the submit handler and error display**

```bash
# Read the file to understand the current error handling pattern
```

- [ ] **Step 2: Add showUpgradeCta state and 402 handling to NewStopModal**

Add state: `const [showUpgradeCta, setShowUpgradeCta] = useState(false);`

In submit catch:
```typescript
} catch (e: any) {
  const isLimitError = e.message?.toLowerCase().includes('limit');
  setError(isLimitError
    ? 'Monthly stop limit reached for your plan.'
    : 'Failed to create stop. Please try again.'
  );
  setShowUpgradeCta(isLimitError);
}
```

Below the error display:
```tsx
{showUpgradeCta && (
  <a href="/dashboard/billing" className="text-xs text-amber-600 font-medium hover:underline">
    Upgrade your plan to add more stops →
  </a>
)}
```

Also reset `showUpgradeCta` in the form reset handler.

- [ ] **Step 3: Same pattern for CsvImportModal**

The error message for CSV is more specific — "Importing X stops would exceed your plan limit":
```typescript
const isLimitError = e.message?.toLowerCase().includes('limit');
setError(isLimitError
  ? 'This import would exceed your monthly stop limit. Upgrade your plan or reduce the import size.'
  : 'Import failed. Please check your CSV format and try again.'
);
setShowUpgradeCta(isLimitError);
```

- [ ] **Step 4: Same pattern for driver creation (drivers page)**

Read drivers page to find the add driver form submit handler. Add same 402 detection:
```typescript
const isLimitError = e.message?.toLowerCase().includes('limit');
setError(isLimitError
  ? 'Driver limit reached for your plan.'
  : 'Failed to add driver. Please try again.'
);
setShowUpgradeCta(isLimitError);
```

- [ ] **Step 5: TypeScript check + commit**

```bash
cd packages/dashboard && npx tsc --noEmit
git add packages/dashboard/src/components/NewStopModal.tsx \
        packages/dashboard/src/components/CsvImportModal.tsx \
        packages/dashboard/src/app/dashboard/drivers/page.tsx
git commit -m "feat(ui): show upgrade CTA when billing plan limit reached (402 response)"
```

---

## Self-Review

**Spec coverage:**
- Monthly stop limit enforced on single creation ✅
- Monthly stop limit enforced on bulk CSV import (bulk-aware: checks N stops at once) ✅
- Driver limit enforced on creation ✅
- Frontend shows upgrade CTA instead of generic error on 402 ✅
- Enterprise plan (null limits) passes all checks ✅
- No migrations needed ✅

**Edge cases:**
- `addingCount` in checkStopLimit handles bulk imports (prevents "first 100 succeed, next 400 fail partway")
- `enterprise` plan with `stopLimit: null` → always `allowed: true`
- `org not found` → `allowed: false` (safe default — don't create orphaned data)

**Risk:**
- The invite flow (`POST /orgs/:orgId/users/invite` with `role: 'driver'`) also creates a driver record. This path is NOT covered by the driver limit check in Task 4 (only `POST /drivers` is covered). After implementing, also add `checkDriverLimit` to the invite path in `organizations.ts` for the `role === 'driver'` branch.

**Recurring auto-generation** (`POST /recurring/generate`) intentionally NOT rate-limited — auto-generated stops are scheduled deliveries, not ad-hoc additions. Blocking them would break committed delivery schedules. If org is over limit, existing stops complete normally.
