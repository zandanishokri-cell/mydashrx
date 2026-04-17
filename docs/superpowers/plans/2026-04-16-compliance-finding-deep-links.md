# Compliance Scanner Finding Deep Links

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw UUID dump on each `ScanFindingCard` with a human-readable count badge and a "View affected →" link that navigates the dispatcher to the relevant resource page (stops, BAA registry, MI checklist, etc.). Turns the scanner from an audit report into an actionable remediation queue.

**Architecture:** Pure frontend change in `compliance/page.tsx`. Add a `FINDING_ACTIONS` map from `checkName` → `{ href: string; label: string }`. Replace the raw UUID `<div>` in `ScanFindingCard` with a count badge + navigation link. No backend changes.

**Tech Stack:** Next.js 14 App Router, TypeScript. One file.

---

## File Structure

- **Modify:** `packages/dashboard/src/app/dashboard/compliance/page.tsx`

---

## Task 1: Add deep links to ScanFindingCard

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/compliance/page.tsx`

- [ ] **Step 1: Add FINDING_ACTIONS map**

After the `SEV_STYLES` const, add:

```typescript
// Maps each scanner checkName to a navigation action so dispatchers can jump directly
// to the affected resources without manually searching
const FINDING_ACTIONS: Record<string, { href: string; label: string }> = {
  hipaa_cs_no_age_verify:         { href: '/dashboard/stops?controlledSubstance=true', label: 'View CS stops' },
  hipaa_cs_no_pod_id_verify:      { href: '/dashboard/stops?controlledSubstance=true', label: 'View CS stops' },
  hipaa_cs_no_signature_required: { href: '/dashboard/stops?controlledSubstance=true', label: 'View CS stops' },
  hipaa_phi_baa_unsigned:         { href: '/dashboard/compliance/baa', label: 'View BAA registry' },
  hipaa_baa_expiring_soon:        { href: '/dashboard/compliance/baa', label: 'View BAA registry' },
  hipaa_no_audit_activity:        { href: '/dashboard/compliance/audit', label: 'View audit log' },
  mi_cs_no_id_photo:              { href: '/dashboard/stops?controlledSubstance=true', label: 'View CS stops' },
  mi_cs_no_dob_confirmed:         { href: '/dashboard/stops?controlledSubstance=true', label: 'View CS stops' },
  mi_cs_completed_no_pod:         { href: '/dashboard/stops?status=completed&controlledSubstance=true', label: 'View completed CS stops' },
  mi_drug_incapable_driver_on_cs_route: { href: '/dashboard/drivers', label: 'View drivers' },
  mi_recurring_cs_no_signature:   { href: '/dashboard/recurring', label: 'View recurring schedules' },
  mi_checklist_items_overdue:     { href: '/dashboard/mi-compliance/items', label: 'View MI checklist' },
};
```

- [ ] **Step 2: Update ScanFindingCard to use action links**

Find the `ScanFindingCard` function. Locate the `{f.resourceIds.length > 0 && ...}` block at the bottom:

```tsx
      {f.resourceIds.length > 0 && (
        <div className="text-xs text-gray-400 mt-1">
          <span className="font-medium text-gray-600">Affected IDs:</span>{' '}
          {f.resourceIds.slice(0, 3).join(', ')}{f.resourceIds.length > 3 ? ` +${f.resourceIds.length - 3} more` : ''}
        </div>
      )}
```

Replace with:

```tsx
      <div className="flex items-center justify-between mt-2">
        {f.resourceIds.length > 0 && (
          <span className="text-xs text-gray-400">
            {f.resourceIds.length} affected record{f.resourceIds.length !== 1 ? 's' : ''}
          </span>
        )}
        {FINDING_ACTIONS[f.checkName] && (
          <Link
            href={FINDING_ACTIONS[f.checkName].href}
            className="text-xs text-[#0F4C81] hover:underline flex items-center gap-1 ml-auto"
          >
            {FINDING_ACTIONS[f.checkName].label} <ChevronRight size={11} />
          </Link>
        )}
      </div>
```

Note: `Link` from `next/link` is already imported. `ChevronRight` is already imported from lucide-react (line 8).

- [ ] **Step 3: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/app/dashboard/compliance/page.tsx
git commit -m "feat(compliance): deep links from scanner findings to affected resource pages"
```

---

## Self-Review

**Spec coverage:**
- All 12 scanner checkNames mapped ✅
- Stop checks → `/dashboard/stops?controlledSubstance=true` (surfaces relevant subset) ✅
- BAA checks → `/dashboard/compliance/baa` ✅
- Audit check → `/dashboard/compliance/audit` ✅
- Drug-incapable driver check → `/dashboard/drivers` ✅
- Recurring check → `/dashboard/recurring` ✅
- MI checklist check → `/dashboard/mi-compliance/items` ✅
- Raw UUID dump replaced with human-readable count ✅
- Link rendered even when `resourceIds.length === 0` (e.g. audit activity check has no IDs) ✅
- No new imports needed (Link, ChevronRight already present) ✅

**UX impact:** During a demo, a P0 finding now has a one-click path to the exact page where it can be fixed. Before: "12 affected IDs: a3f2... b7d1... e9c4..." — After: "12 affected records → View CS stops". This is the difference between an audit tool and a remediation workflow.

**Future upgrade:** When the stops page gains `?ids=` filter support (e.g. for a "bulk fix CS stops" workflow), the FINDING_ACTIONS map can be updated to pass specific IDs — the architecture is already correct.
