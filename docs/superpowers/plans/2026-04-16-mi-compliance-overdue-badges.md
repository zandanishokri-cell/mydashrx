# MI Compliance Items — Inline Overdue Date Badges

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface overdue compliance checklist items directly in the items table on `mi-compliance/items/page.tsx` with the same red OVERDUE badge treatment used by the compliance hub (`compliance/mi/page.tsx`). Currently the items page shows "Due: Jan 5" with no urgency signal — dispatchers miss critical overdue items.

**Architecture:** Pure frontend change. `dueDate` already returned from backend. Same `isOverdue()` helper pattern used in leads pipeline (lexicographic YYYY-MM-DD comparison, `en-CA` locale). No backend changes.

**Tech Stack:** Next.js 14, TypeScript. One file.

---

## File Structure

- **Modify:** `packages/dashboard/src/app/dashboard/mi-compliance/items/page.tsx`

---

## Task 1: Add overdue badge to MI compliance items table

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/mi-compliance/items/page.tsx`

- [ ] **Step 1: Read the file to locate imports and the dueDate cell**

Read the file. The dueDate is displayed at approximately line 239-243:
```tsx
{item.dueDate && (
  <p className="text-xs text-gray-400 mt-0.5">
    Due: {new Date(item.dueDate).toLocaleDateString()}
  </p>
)}
```

- [ ] **Step 2: Add `isOverdue` helper after imports, before the component**

After imports (before `const STATUS_BADGE` or similar constants), add:

```typescript
const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local

function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'compliant') return false;
  return dueDate.split('T')[0] < todayStr;
}
```

Note: Non-compliant items past due date = overdue. Compliant items are never overdue regardless of date.

- [ ] **Step 3: Replace the dueDate cell with overdue-aware display**

Replace:
```tsx
{item.dueDate && (
  <p className="text-xs text-gray-400 mt-0.5">
    Due: {new Date(item.dueDate).toLocaleDateString()}
  </p>
)}
```

With:
```tsx
{item.dueDate && (
  <div className="flex items-center gap-1 mt-0.5">
    {isOverdue(item.dueDate, item.status) ? (
      <>
        <span className="text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full">OVERDUE</span>
        <span className="text-xs text-red-400">{new Date(item.dueDate + 'T00:00:00').toLocaleDateString()}</span>
      </>
    ) : (
      <span className="text-xs text-gray-400">Due: {new Date(item.dueDate + 'T00:00:00').toLocaleDateString()}</span>
    )}
  </div>
)}
```

Note: Adding `'T00:00:00'` to the date string forces local timezone parsing (prevents UTC midnight shifting date by 1 day).

- [ ] **Step 4: Also update the compliance/mi/page.tsx overdue check to use the same helper**

File: `packages/dashboard/src/app/dashboard/compliance/mi/page.tsx`

The existing overdue check uses `new Date(i.dueDate) < new Date()` which evaluates at render time and doesn't use local date comparison. Replace any similar pattern with:

```typescript
const todayStr = new Date().toLocaleDateString('en-CA');
function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'compliant') return false;
  return dueDate.split('T')[0] < todayStr;
}
```

Then replace `new Date(i.dueDate) < new Date()` with `isOverdue(i.dueDate, i.status)`.

- [ ] **Step 5: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/app/dashboard/mi-compliance/items/page.tsx packages/dashboard/src/app/dashboard/compliance/mi/page.tsx
git commit -m "feat(mi-compliance): overdue badges on checklist items — red OVERDUE pill + red date when past due"
```

---

## Self-Review

**Spec coverage:**
- `isOverdue()`: compliant items never flagged ✅
- `isOverdue()`: null dueDate never flagged ✅
- `T00:00:00` suffix prevents UTC midnight off-by-one ✅
- `todayStr` computed once at module level (not per-render) ✅
- Red OVERDUE badge + red date when overdue ✅
- Normal gray "Due:" text when not overdue ✅
- Unified helper across both MI compliance pages ✅
- No backend changes needed ✅

**Clinical value:** Compliance officers and pharmacy admins reviewing the MI checklist see at a glance which items are overdue. A red OVERDUE badge on "Drug-Incapable Driver Policy" or "MAPS Reporting" creates urgency that a plain date string doesn't.
