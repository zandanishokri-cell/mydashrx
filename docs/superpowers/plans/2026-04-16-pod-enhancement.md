# POD Enhancement: Photo Capture + Package Count + COD Collection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three silent gaps in PodCaptureModal where schema fields and backend endpoints already exist but driver UI never surfaces them: delivery photo, package count confirmation, and COD cash collection.

**Architecture:** Extend PodCaptureModal with up to 3 conditional steps gated by stop flags. Step count is dynamic (3–6 steps). All additions are additive — no existing step logic changes.

**Tech Stack:** React canvas (existing), `input[type=file][capture=environment]` (existing pattern from ID step), Fastify multipart (existing `/pod/photo` endpoint), no new dependencies

---

## Background: Discovered Gaps

### Gap 1 — requiresPhoto ignored
- `stops.requiresPhoto: boolean` exists in schema ✅
- Backend `POST /stops/:stopId/pod/photo` endpoint exists ✅  
- `PodCaptureModal` has zero photo capture step ❌
- `PodViewer` renders photos when present ✅
- Result: Every stop marked `requiresPhoto=true` completes without a photo

### Gap 2 — packageCount hardcoded
```typescript
// PodCaptureModal.tsx line 113
const podPayload = {
  packageCount: 1,  // ← always 1, ignores stop.packageCount
  ...
};
```
- Multi-package stops can't confirm actual received count
- Result: POD record always shows 1 package regardless

### Gap 3 — COD collection never prompted (LOW-c46-COD)
- `stops.codAmount: number` can be non-zero ✅
- `proofOfDeliveries.codCollected: { amount, method, note }` schema field exists ✅
- Backend POD POST accepts `codCollected?: { amount: number; method: string; note?: string }` ✅
- PodCaptureModal has no COD step ❌
- Result: COD stops complete without recording cash collection confirmation

---

## File Structure

- **Modify:** `packages/dashboard/src/components/PodCaptureModal.tsx`
  - Add props: `requiresPhoto`, `packageCount`, `codAmount`
  - Add step states for photo, packageCount, codAmount
  - Insert conditional steps between existing steps
- **Modify:** `packages/dashboard/src/app/driver/stops/[stopId]/page.tsx`
  - Pass new props to PodCaptureModal from stop data
  - **⚠️ PHOTO PATH CONFLICT:** The stop detail page has a standalone "Proof of Delivery Photo" section (direct upload to `/driver/me/stops/:stopId/photo`) AND the POD modal will add a photo step for `requiresPhoto=true` stops. After Task 2 (photo step in modal), hide the standalone section when `requiresPhoto=true` to prevent duplicate capture. Show only the POD modal path.

---

## Current Step Flow (before)
```
Step 1: Recipient name + CS flag
Step 2: Signature canvas
Step 3 (CS only): Photo ID verification
Step 3/4: Review + Submit
```

## New Step Flow (after)
```
Step 1: Recipient name + CS flag
Step 2: Signature canvas (unchanged)
Step 3 (if requiresPhoto): Delivery photo capture
Step 4 (CS only): Photo ID + MAPS confirmation
Step 5 (if codAmount > 0): COD cash collection
Step 6/final: Package count + Review + Submit
```

All steps are conditional — flow adapts to stop flags. Total steps: 3 minimum, 6 maximum.

---

## Task 1: Extend PodCaptureModal props and step states

**Files:**
- Modify: `packages/dashboard/src/components/PodCaptureModal.tsx`

- [ ] **Step 1: Extend Props interface**

```typescript
interface Props {
  stopId: string;
  recipientNameHint?: string;
  requiresPhoto?: boolean;       // new
  packageCount?: number;         // new — from stop.packageCount
  codAmount?: number;            // new — from stop.codAmount
  isOnline?: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  onQueued?: () => void;
}
```

- [ ] **Step 2: Extend step state and add new state variables**

Add after existing step state variables:

```typescript
// Step: delivery photo (when requiresPhoto=true)
const photoInputRef = useRef<HTMLInputElement>(null);
const [deliveryPhotoDataUrl, setDeliveryPhotoDataUrl] = useState<string | null>(null);

// Step: package count
const [confirmedPackageCount, setConfirmedPackageCount] = useState<number>(packageCount ?? 1);

// Step: COD
const [codMethod, setCodMethod] = useState<'cash' | 'check' | ''>('');
const [codAmountConfirmed, setCodAmountConfirmed] = useState<string>(String(codAmount ?? ''));
const [codNote, setCodNote] = useState('');
```

- [ ] **Step 3: Compute step numbers dynamically**

Replace the `Step = 1 | 2 | 3 | 4` type with a computed step map:

```typescript
// Build ordered step list based on stop flags
const steps: string[] = ['recipient', 'signature'];
if (requiresPhoto) steps.push('photo');
if (isCS) steps.push('id');
if ((codAmount ?? 0) > 0) steps.push('cod');
steps.push('review');

const totalSteps = steps.length;
const currentStepName = steps[step - 1];
```

- [ ] **Step 4: Commit checkpoint**

```bash
git add packages/dashboard/src/components/PodCaptureModal.tsx
git commit -m "feat(pod): extend props and step scaffolding for photo/cod/packageCount"
```

---

## Task 2: Delivery photo step

**Files:**
- Modify: `packages/dashboard/src/components/PodCaptureModal.tsx`

- [ ] **Step 1: Add photo handler** (after handleIdPhoto)

```typescript
const handleDeliveryPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => setDeliveryPhotoDataUrl(ev.target?.result as string ?? null);
  reader.readAsDataURL(file);
};
```

- [ ] **Step 2: Add photo step JSX** (after signature step, before ID step)

```tsx
{/* ── STEP: Delivery Photo ──────────────────────────────── */}
{currentStepName === 'photo' && (
  <div className="space-y-4 pt-2">
    <div className="flex items-center gap-2 mb-1">
      <Camera size={18} className="text-[#0F4C81]" />
      <h3 className="font-semibold text-gray-800">Delivery Photo</h3>
    </div>
    <p className="text-sm text-gray-500">Take a photo showing the delivered package(s) at the door or drop location.</p>
    {deliveryPhotoDataUrl ? (
      <div>
        <img src={deliveryPhotoDataUrl} alt="Delivery" className="w-full rounded-xl object-cover max-h-48 border border-gray-200" />
        <button
          onClick={() => photoInputRef.current?.click()}
          className="mt-2 w-full border border-gray-200 rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 flex items-center justify-center gap-2"
        >
          <Camera size={14} /> Retake photo
        </button>
      </div>
    ) : (
      <button
        onClick={() => photoInputRef.current?.click()}
        className="w-full bg-[#0F4C81] text-white py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 min-h-[56px]"
      >
        <Camera size={18} /> Capture Delivery Photo
      </button>
    )}
    <input
      ref={photoInputRef}
      type="file"
      accept="image/*"
      capture="environment"
      className="hidden"
      onChange={handleDeliveryPhoto}
    />
  </div>
)}
```

- [ ] **Step 3: Gate advance button** — photo step requires photo captured

```typescript
const canAdvancePhotoStep = !!deliveryPhotoDataUrl;
```

- [ ] **Step 4: Upload delivery photo during submit** (in `submit()` function)

After the main POD POST, upload delivery photo as a separate request (same pattern as existing `/pod/photo` endpoint):

```typescript
// After api.post(`/driver/me/stops/${stopId}/pod`, podPayload):
if (deliveryPhotoDataUrl) {
  try {
    // Convert data URL to blob and upload
    const blob = await (await fetch(deliveryPhotoDataUrl)).blob();
    const formData = new FormData();
    formData.append('file', blob, 'delivery.jpg');
    await api.upload(`/driver/me/stops/${stopId}/pod/photo`, formData);
  } catch {
    // Non-blocking — POD was submitted, photo upload failure is non-fatal
  }
}
```

Note: `api.upload()` may not exist — check `packages/dashboard/src/lib/api.ts`. If missing, add:
```typescript
upload: async (path: string, formData: FormData) => {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
},
```

- [ ] **Step 5: Add photo to review summary**

In the review step summary section:
```tsx
{requiresPhoto && (
  <div className="flex justify-between">
    <span className="text-gray-500">Delivery Photo</span>
    <span className={`font-medium flex items-center gap-1 ${deliveryPhotoDataUrl ? 'text-green-600' : 'text-amber-500'}`}>
      {deliveryPhotoDataUrl ? <><CheckCircle2 size={13} /> Captured</> : 'Skipped'}
    </span>
  </div>
)}
```

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/components/PodCaptureModal.tsx packages/dashboard/src/lib/api.ts
git commit -m "feat(pod): delivery photo capture step when requiresPhoto=true"
```

---

## Task 3: COD collection step

**Files:**
- Modify: `packages/dashboard/src/components/PodCaptureModal.tsx`

- [ ] **Step 1: Add COD step JSX** (after ID step, before review)

```tsx
{/* ── STEP: COD Collection ─────────────────────────────── */}
{currentStepName === 'cod' && (
  <div className="space-y-4 pt-2">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-lg">💵</span>
      <h3 className="font-semibold text-gray-800">Cash on Delivery</h3>
    </div>
    <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-yellow-800">Amount Due: <span className="text-lg">${codAmount?.toFixed(2)}</span></p>
      <p className="text-xs text-yellow-600 mt-1">Collect payment before handing over the package</p>
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">Payment method received</label>
      <div className="grid grid-cols-2 gap-2">
        {(['cash', 'check'] as const).map(m => (
          <button
            key={m}
            onClick={() => setCodMethod(m)}
            className={`py-3 rounded-xl text-sm font-semibold border-2 capitalize transition-colors ${
              codMethod === m ? 'border-[#0F4C81] bg-[#0F4C81] text-white' : 'border-gray-200 text-gray-600'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">Amount collected ($)</label>
      <input
        type="number"
        step="0.01"
        value={codAmountConfirmed}
        onChange={e => setCodAmountConfirmed(e.target.value)}
        placeholder={String(codAmount ?? '')}
        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
      />
    </div>

    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">Note (optional)</label>
      <input
        value={codNote}
        onChange={e => setCodNote(e.target.value)}
        placeholder="e.g. Patient gave exact change"
        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F4C81]/20"
      />
    </div>
  </div>
)}
```

- [ ] **Step 2: Gate advance** — COD step requires method selected

```typescript
const canAdvanceCodStep = codMethod !== '' && parseFloat(codAmountConfirmed) > 0;
```

- [ ] **Step 3: Include codCollected in POD payload**

In `submit()`, extend `podPayload`:
```typescript
...(codAmount && codMethod ? {
  codCollected: {
    amount: parseFloat(codAmountConfirmed) || codAmount,
    method: codMethod,
    note: codNote.trim() || undefined,
  }
} : {}),
```

- [ ] **Step 4: Add COD to review summary**

```tsx
{(codAmount ?? 0) > 0 && codMethod && (
  <div className="flex justify-between">
    <span className="text-gray-500">COD Collected</span>
    <span className="font-medium text-green-600 flex items-center gap-1">
      <CheckCircle2 size={13} /> ${parseFloat(codAmountConfirmed).toFixed(2)} ({codMethod})
    </span>
  </div>
)}
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/PodCaptureModal.tsx
git commit -m "feat(pod): COD collection step — records amount and method in proofOfDeliveries"
```

---

## Task 4: Package count confirmation

**Files:**
- Modify: `packages/dashboard/src/components/PodCaptureModal.tsx`

- [ ] **Step 1: Add package count to review step** (in review section, not a separate step)

Replace the hardcoded `packageCount: 1` with a simple stepper in the review step:

```tsx
{/* Package count in review step */}
<div className="flex justify-between items-center">
  <span className="text-gray-500">Packages delivered</span>
  <div className="flex items-center gap-3">
    <button
      onClick={() => setConfirmedPackageCount(c => Math.max(1, c - 1))}
      className="w-8 h-8 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center font-bold"
    >
      −
    </button>
    <span className="text-sm font-bold text-gray-900 w-6 text-center">{confirmedPackageCount}</span>
    <button
      onClick={() => setConfirmedPackageCount(c => c + 1)}
      className="w-8 h-8 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 flex items-center justify-center font-bold"
    >
      +
    </button>
  </div>
</div>
```

- [ ] **Step 2: Use confirmedPackageCount in submit payload**

```typescript
// BEFORE:
packageCount: 1,

// AFTER:
packageCount: confirmedPackageCount,
```

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/components/PodCaptureModal.tsx
git commit -m "feat(pod): package count stepper in review step — replaces hardcoded 1"
```

---

## Task 5: Wire props from driver stop page

**Files:**
- Modify: `packages/dashboard/src/app/driver/stops/[stopId]/page.tsx`

- [ ] **Step 1: Read current PodCaptureModal usage**

Find the `<PodCaptureModal` render in the driver stop page. It currently passes: `stopId`, `recipientNameHint`, `isOnline`, `onClose`, `onSubmitted`, `onQueued`.

- [ ] **Step 2: Pass new props**

```tsx
<PodCaptureModal
  stopId={stop.id}
  recipientNameHint={stop.recipientName}
  requiresPhoto={stop.requiresPhoto}      // add
  packageCount={stop.packageCount}        // add
  codAmount={stop.codAmount ?? undefined} // add
  isOnline={isOnline}
  onClose={() => setShowPod(false)}
  onSubmitted={handlePodSubmitted}
  onQueued={handlePodQueued}
/>
```

- [ ] **Step 3: Verify stop interface includes these fields**

Check that the `Stop` interface in `driver/stops/[stopId]/page.tsx` includes:
```typescript
requiresPhoto: boolean;
packageCount: number;
codAmount: number | null;
```
Add if missing.

- [ ] **Step 4: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/app/driver/stops/[stopId]/page.tsx
git commit -m "feat(pod): wire requiresPhoto, packageCount, codAmount props to PodCaptureModal"
```

---

## Task 6: PodViewer — add COD and package count display

**Files:**
- Modify: `packages/dashboard/src/components/PodViewer.tsx`

- [ ] **Step 1: Extend PodViewerProps**

```typescript
interface PodViewerProps {
  pod: {
    // ... existing fields ...
    packageCount?: number;
    codCollected?: { amount: number; method: string; note?: string } | null;
  };
}
```

- [ ] **Step 2: Add COD display** (after Notes section)

```tsx
{pod.codCollected && (
  <div className="flex items-center justify-between text-xs bg-yellow-50 text-yellow-800 rounded-xl px-3 py-2.5">
    <span className="font-medium flex items-center gap-1.5">💵 COD Collected</span>
    <span className="font-semibold">${pod.codCollected.amount.toFixed(2)} · {pod.codCollected.method}</span>
  </div>
)}
```

- [ ] **Step 3: Add package count to meta row**

```tsx
{pod.packageCount != null && pod.packageCount > 0 && (
  <span className="flex items-center gap-1.5 text-xs text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full">
    📦 {pod.packageCount} pkg{pod.packageCount !== 1 ? 's' : ''}
  </span>
)}
```

- [ ] **Step 4: TypeScript check + commit**

```bash
cd packages/dashboard && npx tsc --noEmit
git add packages/dashboard/src/components/PodViewer.tsx
git commit -m "feat(pod-viewer): display COD collected and package count"
```

---

## Self-Review

**Spec coverage:**
- Gap 1 (requiresPhoto): Tasks 2 + 5 ✅
- Gap 2 (packageCount hardcoded): Tasks 4 + 5 ✅  
- Gap 3 (COD never recorded): Tasks 3 + 5 + 6 ✅
- Viewer updated for new fields: Task 6 ✅

**Risks:**
- `api.upload()` may not exist — check `lib/api.ts` before Task 2 ✅ (mitigated)
- Photo upload is non-fatal (fire-and-forget) if fails ✅
- COD step is conditional — non-COD deliveries unaffected ✅
- Step count is dynamic (3–6) — step indicator handles this via `steps.length` ✅
- `requiresPhoto` is an existing schema field — no migration needed ✅
- `codCollected` is existing JSONB field in proofOfDeliveries — no migration needed ✅
- `packageCount` is existing integer field — no migration needed ✅

**No migrations needed** — all fields already exist in schema.
