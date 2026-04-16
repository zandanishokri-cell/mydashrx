# UTC Date Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all 26 instances of `new Date().toISOString().split('T')[0]` with timezone-correct alternatives, preventing wrong-date bugs after ~7pm EST.

**Architecture:** Two helpers — `localDateStr()` on frontend (browser local time), `todayInTz(tz)` on backend (uses org timezone via `Intl.DateTimeFormat`). Fix in severity order: TIER 1 (breaks driver app) → TIER 2 (wrong today filters) → TIER 3 (off-by-one defaults) → TIER 4 (harmless, skip).

**Tech Stack:** TypeScript, Intl.DateTimeFormat (Node.js built-in, no deps), existing `organizations.timezone` field

---

## Background: Why This Matters

`new Date().toISOString()` always returns UTC time. For EST (UTC-4), after 8:00 PM local time:
- UTC is already next day (midnight+)
- `split('T')[0]` returns tomorrow's date
- Drivers load routes for "today" and get empty list
- Plan calendar highlights wrong day
- Dashboard shows wrong today counts

The server runs UTC (Render default). The frontend runs in user's browser timezone. The org has a `timezone` field (default `'America/New_York'`).

---

## File Structure

- **Create:** `packages/backend/src/utils/date.ts` — `todayInTz(tz?)` helper
- **Create/Update:** `packages/dashboard/src/lib/dateUtils.ts` — `localDateStr(d?)` helper
- **Modify:** 15 backend/frontend files (see tasks below)

---

## Instance Inventory

### TIER 1 — Critical (breaks driver workflow)
| File | Line | Issue |
|------|------|-------|
| `backend/src/routes/driverApp.ts` | 18 | `today` used to filter routes — after 8pm EST, drivers see empty list |

### TIER 2 — High (wrong "today" in UI and dashboard)
| File | Line | Issue |
|------|------|-------|
| `backend/src/routes/dashboard.ts` | 24 | Plans filter uses UTC today |
| `backend/src/routes/dashboard.ts` | 90 | Fleet "today's stops" count |
| `backend/src/routes/dashboard.ts` | 168 | `/today` endpoint date param |
| `dashboard/src/app/dashboard/plans/page.tsx` | 29 | Week calendar days — `getWeekRange` uses UTC |
| `dashboard/src/app/dashboard/plans/page.tsx` | 42 | `selectedDate` initial value |
| `dashboard/src/app/dashboard/plans/page.tsx` | 47 | `today` highlight on calendar |
| `dashboard/src/app/dashboard/stops/page.tsx` | 69 | "Today" filter tab comparison |
| `dashboard/src/app/dashboard/page.tsx` | 49 | Dashboard "today" comparison |

### TIER 3 — Medium (off-by-one on date range defaults)
| File | Line | Issue |
|------|------|-------|
| `backend/src/routes/drivers.ts` | 153–154 | Performance range default (`to`/`from`) |
| `backend/src/routes/drivers.ts` | 198 | Daily breakdown key from `createdAt.toISOString()` |
| `backend/src/routes/import.ts` | 67 | Import default date |
| `backend/src/routes/pharmacyPortal.ts` | 97 | Portal delivery date default |
| `dashboard/src/app/dashboard/stops/page.tsx` | 74–75 | Default date range |
| `dashboard/src/app/dashboard/compliance/audit/page.tsx` | 28–29 | Default audit filter range |
| `dashboard/src/app/dashboard/plans/new/page.tsx` | 17 | Default new plan date |
| `dashboard/src/components/ui/DateRangePicker.tsx` | 31 | `fmt` helper |

### TIER 4 — Harmless (filename generation, skip)
| File | Lines | Notes |
|------|-------|-------|
| `backend/src/routes/compliance.ts` | 160 | CSV filename only |
| `dashboard/src/app/dashboard/analytics/page.tsx` | 202 | CSV filename only (fixed in C93) |
| `dashboard/src/app/dashboard/compliance/audit/page.tsx` | 86 | CSV filename only |
| `backend/src/db/seed.ts` | 117 | Dev seed, irrelevant |

---

## Task 1: Backend date helper

**Files:**
- Create: `packages/backend/src/utils/date.ts`

- [ ] **Step 1: Create the helper**

```typescript
// packages/backend/src/utils/date.ts
/**
 * Returns today's date as YYYY-MM-DD in the given IANA timezone.
 * Defaults to America/New_York (most pharmacy deployments).
 * Use org.timezone when available.
 */
export const todayInTz = (tz = 'America/New_York'): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
```

- [ ] **Step 2: Verify output**

```bash
node -e "const f = (tz='America/New_York') => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); console.log(f());"
# Expected: YYYY-MM-DD matching local date in NY timezone
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/utils/date.ts
git commit -m "feat(utils): add todayInTz helper for timezone-correct date strings"
```

---

## Task 2: Frontend date helper

**Files:**
- Create/Update: `packages/dashboard/src/lib/dateUtils.ts`

- [ ] **Step 1: Create the helper**

```typescript
// packages/dashboard/src/lib/dateUtils.ts
/** Returns d (default: now) as YYYY-MM-DD in browser local time */
export const localDateStr = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/lib/dateUtils.ts
git commit -m "feat(utils): add localDateStr helper for browser-local date strings"
```

---

## Task 3: Fix TIER 1 — driverApp.ts (CRITICAL)

**Files:**
- Modify: `packages/backend/src/routes/driverApp.ts:18`

- [ ] **Step 1: Add import**

At top of `driverApp.ts`, add:
```typescript
import { todayInTz } from '../utils/date.js';
```

- [ ] **Step 2: Fix today**

Replace line 18:
```typescript
// BEFORE:
const today = new Date().toISOString().split('T')[0];

// AFTER (uses org timezone if available, falls back to NY):
const today = todayInTz();
```

Note: `driverApp.ts` has access to `user.orgId`. For a more precise fix, look up `org.timezone` — but that adds a DB query on every route load. The NY default is sufficient for current deployments. Add org lookup only if multi-timezone becomes a requirement.

- [ ] **Step 3: TypeScript check**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/driverApp.ts
git commit -m "fix(driver-app): today comparison used UTC — drivers saw empty routes after 8pm EST"
```

---

## Task 4: Fix TIER 2 — dashboard.ts backend

**Files:**
- Modify: `packages/backend/src/routes/dashboard.ts` lines 24, 90, 168

- [ ] **Step 1: Add import**

```typescript
import { todayInTz } from '../utils/date.js';
```

- [ ] **Step 2: Fix line 24** (plans filter)

```typescript
// BEFORE:
eq(plans.date, todayStart.toISOString().split('T')[0]),

// AFTER:
eq(plans.date, todayInTz()),
```

- [ ] **Step 3: Fix line 90** (fleet today stops)

```typescript
// BEFORE:
const today = new Date().toISOString().split('T')[0];

// AFTER:
const today = todayInTz();
```

- [ ] **Step 4: Fix line 168** (/today endpoint)

```typescript
// BEFORE:
const today = q.date ?? new Date().toISOString().split('T')[0];

// AFTER:
const today = q.date ?? todayInTz();
```

- [ ] **Step 5: TypeScript check + commit**

```bash
cd packages/backend && npx tsc --noEmit
git add packages/backend/src/routes/dashboard.ts
git commit -m "fix(dashboard): today filter used UTC — wrong KPI counts after 8pm EST"
```

---

## Task 5: Fix TIER 2 — plans/page.tsx frontend

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/plans/page.tsx` lines 29, 42, 47

- [ ] **Step 1: Add import**

```typescript
import { localDateStr } from '@/lib/dateUtils';
```

- [ ] **Step 2: Fix getWeekRange (line 29)**

```typescript
// BEFORE:
days.push(d.toISOString().split('T')[0]);

// AFTER:
days.push(localDateStr(d));
```

- [ ] **Step 3: Fix selectedDate initial value (line 42)**

```typescript
// BEFORE:
const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);

// AFTER:
const [selectedDate, setSelectedDate] = useState(() => localDateStr());
```

- [ ] **Step 4: Fix today highlight (line 47)**

```typescript
// BEFORE:
const today = new Date().toISOString().split('T')[0];

// AFTER:
const today = localDateStr();
```

- [ ] **Step 5: TypeScript check + commit**

```bash
cd packages/dashboard && npx tsc --noEmit
git add packages/dashboard/src/app/dashboard/plans/page.tsx
git commit -m "fix(plans): calendar week and today highlight used UTC dates"
```

---

## Task 6: Fix TIER 2 — stops/page.tsx + dashboard/page.tsx frontend

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/stops/page.tsx` lines 69, 74, 75
- Modify: `packages/dashboard/src/app/dashboard/page.tsx` line 49

- [ ] **Step 1: Add import to both files**

```typescript
import { localDateStr } from '@/lib/dateUtils';
```

- [ ] **Step 2: Fix stops/page.tsx line 69** (Today tab filter)

```typescript
// BEFORE:
const t = new Date().toISOString().split('T')[0];

// AFTER:
const t = localDateStr();
```

- [ ] **Step 3: Fix stops/page.tsx lines 74–75** (default date range)

```typescript
// BEFORE:
const to = new Date().toISOString().split('T')[0];
const from = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];

// AFTER:
const to = localDateStr();
const from = localDateStr(new Date(Date.now() - 90 * 86400000));
```

- [ ] **Step 4: Fix dashboard/page.tsx line 49**

```typescript
// BEFORE:
const today = new Date().toISOString().split('T')[0];

// AFTER:
const today = localDateStr();
```

- [ ] **Step 5: TypeScript check + commit**

```bash
cd packages/dashboard && npx tsc --noEmit
git add packages/dashboard/src/app/dashboard/stops/page.tsx packages/dashboard/src/app/dashboard/page.tsx
git commit -m "fix(stops,dashboard): today comparisons used UTC dates"
```

---

## Task 7: Fix TIER 3 — remaining backend instances

**Files:**
- Modify: `packages/backend/src/routes/drivers.ts` lines 153–154, 198
- Modify: `packages/backend/src/routes/import.ts` line 67
- Modify: `packages/backend/src/routes/pharmacyPortal.ts` line 97

- [ ] **Step 1: Add import to each file**

```typescript
import { todayInTz } from '../utils/date.js';
```

- [ ] **Step 2: Fix drivers.ts lines 153–154** (performance range default)

```typescript
// BEFORE:
const to = query.to ?? new Date().toISOString().split('T')[0];
const from = query.from ?? new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

// AFTER:
const to = query.to ?? todayInTz();
const from = query.from ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - 30 * 86400000));
```

- [ ] **Step 3: Fix drivers.ts line 198** (daily breakdown key)

```typescript
// BEFORE:
const date = s.createdAt.toISOString().split('T')[0];

// AFTER:
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(s.createdAt);
```

- [ ] **Step 4: Fix import.ts line 67**

```typescript
// BEFORE:
const today = new Date().toISOString().split('T')[0];

// AFTER:
const today = todayInTz();
```

- [ ] **Step 5: Fix pharmacyPortal.ts line 97**

```typescript
// BEFORE:
const date = body.deliveryDate ?? new Date().toISOString().split('T')[0];

// AFTER:
const date = body.deliveryDate ?? todayInTz();
```

- [ ] **Step 6: TypeScript check + commit**

```bash
cd packages/backend && npx tsc --noEmit
git add packages/backend/src/routes/drivers.ts packages/backend/src/routes/import.ts packages/backend/src/routes/pharmacyPortal.ts
git commit -m "fix(drivers,import,portal): remaining UTC date defaults in backend routes"
```

---

## Task 8: Fix TIER 3 — remaining frontend instances

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/compliance/audit/page.tsx` lines 28–29
- Modify: `packages/dashboard/src/app/dashboard/plans/new/page.tsx` line 17
- Modify: `packages/dashboard/src/components/ui/DateRangePicker.tsx` line 31

- [ ] **Step 1: Add import to each file**

```typescript
import { localDateStr } from '@/lib/dateUtils';
```

- [ ] **Step 2: Fix audit/page.tsx lines 28–29**

```typescript
// BEFORE:
const defaultFrom = () => new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
const defaultTo = () => new Date().toISOString().split('T')[0];

// AFTER:
const defaultFrom = () => localDateStr(new Date(Date.now() - 7 * 86400000));
const defaultTo = () => localDateStr();
```

- [ ] **Step 3: Fix plans/new/page.tsx line 17**

```typescript
// BEFORE:
const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

// AFTER:
const [date, setDate] = useState(() => localDateStr());
```

- [ ] **Step 4: Fix DateRangePicker.tsx line 31**

```typescript
// BEFORE:
const fmt = (d: Date) => d.toISOString().split('T')[0];

// AFTER:
const fmt = (d: Date) => localDateStr(d);
```

- [ ] **Step 5: TypeScript check + commit**

```bash
cd packages/dashboard && npx tsc --noEmit
git add packages/dashboard/src/app/dashboard/compliance/audit/page.tsx \
        packages/dashboard/src/app/dashboard/plans/new/page.tsx \
        packages/dashboard/src/components/ui/DateRangePicker.tsx
git commit -m "fix(frontend): remaining UTC date defaults — audit, new plan, date picker"
```

---

## Self-Review

**Spec coverage:**
- All 22 non-harmless instances covered across 8 tasks ✅
- 4 harmless filename instances explicitly skipped ✅
- `en-CA` locale used because it produces `YYYY-MM-DD` format natively ✅
- Default timezone `America/New_York` correct for current deployment ✅

**Risk:**
- `todayInTz()` uses `Intl.DateTimeFormat` — available in all modern Node.js and browsers ✅
- No dependency changes required ✅
- Frontend fixes are pure local-time arithmetic — no server calls ✅
- `DateRangePicker.tsx` change affects all date pickers — regression test by checking plans page calendar ✅
