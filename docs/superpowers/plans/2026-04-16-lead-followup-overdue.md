# Lead Follow-Up Overdue Indicators

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface overdue follow-up dates as red "OVERDUE" badges in both the pipeline card view and the leads list, so dispatchers/admins see actionable items immediately without any configuration — increasing daily engagement with the Lead Finder.

**Architecture:** Pure frontend change. `nextFollowUp` is already returned as a date string from the backend. A helper function computes overdue status by comparing to today's local date. No backend changes needed.

**Tech Stack:** Next.js 14 frontend, TypeScript. Modifies 2 files.

---

## File Structure

- **Modify:** `packages/dashboard/src/app/dashboard/leads/pipeline/page.tsx` — overdue badge on pipeline cards
- **Modify:** `packages/dashboard/src/app/dashboard/leads/page.tsx` — overdue badge in leads list rows

---

## Task 1: Pipeline card overdue badges

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/leads/pipeline/page.tsx`

- [ ] **Step 1: Add isOverdue helper**

After the `STAGE_ORDER` const, add:

```typescript
const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local

function isOverdue(nextFollowUp: string | null): boolean {
  if (!nextFollowUp) return false;
  return nextFollowUp.split('T')[0] < todayStr;
}
```

Note: `'en-CA'` format gives `YYYY-MM-DD` which is lexicographically comparable to `nextFollowUp.split('T')[0]`.

- [ ] **Step 2: Add AlertCircle to imports (if not already there)**

`AlertCircle` is already imported on line 6. No change needed — but verify it's present.

- [ ] **Step 3: Replace the nextFollowUp display on pipeline cards**

Find the pipeline card follow-up section:

```tsx
                        {lead.nextFollowUp && (
                          <p className="text-xs text-amber-600 mt-1">
                            Follow-up: {new Date(lead.nextFollowUp).toLocaleDateString()}
                          </p>
                        )}
```

Replace with:

```tsx
                        {lead.nextFollowUp && (
                          <div className="flex items-center gap-1.5 mt-1">
                            {isOverdue(lead.nextFollowUp) ? (
                              <>
                                <span className="text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">OVERDUE</span>
                                <span className="text-xs text-red-500">{new Date(lead.nextFollowUp + 'T00:00:00').toLocaleDateString()}</span>
                              </>
                            ) : (
                              <p className="text-xs text-amber-600">
                                Follow-up: {new Date(lead.nextFollowUp + 'T00:00:00').toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        )}
```

Note: Adding `'T00:00:00'` to the date string ensures local midnight parsing (avoids UTC shift showing wrong date).

- [ ] **Step 4: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/app/dashboard/leads/pipeline/page.tsx
git commit -m "feat(leads): overdue follow-up badge on pipeline cards"
```

---

## Task 2: Leads list overdue badge

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/leads/page.tsx`

- [ ] **Step 1: Read the file to find the Lead interface and table row rendering**

Read `packages/dashboard/src/app/dashboard/leads/page.tsx`. Find:
- The `Lead` interface — verify it has `nextFollowUp: string | null`
- The table/list row where `nextFollowUp` is currently displayed

- [ ] **Step 2: Add the isOverdue helper**

Near the top of the file (after imports, before the component), add:

```typescript
const todayStr = new Date().toLocaleDateString('en-CA');
function isOverdue(nextFollowUp: string | null): boolean {
  if (!nextFollowUp) return false;
  return nextFollowUp.split('T')[0] < todayStr;
}
```

- [ ] **Step 3: Update the nextFollowUp cell in the table row**

Find where `lead.nextFollowUp` is rendered in the list. It likely shows as a date string. Replace with:

```tsx
{lead.nextFollowUp ? (
  <div className="flex items-center gap-1.5">
    {isOverdue(lead.nextFollowUp) && (
      <span className="text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full shrink-0">OVERDUE</span>
    )}
    <span className={`text-xs ${isOverdue(lead.nextFollowUp) ? 'text-red-500' : 'text-gray-500'}`}>
      {new Date(lead.nextFollowUp + 'T00:00:00').toLocaleDateString()}
    </span>
  </div>
) : (
  <span className="text-xs text-gray-400">—</span>
)}
```

- [ ] **Step 4: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/app/dashboard/leads/page.tsx
git commit -m "feat(leads): overdue follow-up badge in leads list"
```

---

## Self-Review

**Spec coverage:**
- Overdue = nextFollowUp date < today (local, not UTC) ✅
- Non-overdue shows existing amber style unchanged ✅
- Null nextFollowUp shows nothing / dash ✅
- `T00:00:00` suffix prevents UTC midnight shift on date display ✅
- Pipeline card: red OVERDUE badge + red date ✅
- Leads list: same OVERDUE badge in Follow-Up column ✅
- Zero backend changes needed ✅
- `todayStr` computed once at module level (not re-computed per render) ✅

**Clinical/business value:**
Every dispatcher opens the pipeline daily. Overdue badges make it immediately obvious which leads need action today — without searching, filtering, or remembering. This is the kind of feature that increases daily active usage and makes the product feel "smart."
