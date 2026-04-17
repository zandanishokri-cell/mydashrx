# Automation Test Fire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Test Fire" button to each automation rule row that dispatches a mock trigger event with sample data, executes the rule's SMS/email actions, and shows success/failure inline. Turns silent automation rules into verifiable, trustworthy features — critical for demos and operator confidence.

**Architecture:** New backend endpoint `POST /orgs/:orgId/automation/rules/:ruleId/test` that calls `executeRule` with sample data. No DB side effects (no log entry, no runCount increment). Frontend: Test button per row, inline result toast (success/failure).

**Tech Stack:** Fastify (backend), React (frontend), existing executeRule + sendTwilioSms + sendResendEmail

---

## Background

Automation rules are currently a black box. Operators can't verify:
- That SMS/email credentials are working
- That their template variables render correctly  
- That the right people receive the message

With Test Fire, operators click one button and see "SMS sent ✓" or "Email failed: no RESEND_API_KEY" immediately. This is critical for:
- **Demos**: Show a live SMS firing during a demo walkthrough
- **Onboarding**: New pharmacies verify their notification setup works
- **Debugging**: Diagnose why "Alert dispatcher" rule isn't sending

---

## File Structure

- **Modify:** `packages/backend/src/routes/automation.ts` — add POST /rules/:ruleId/test
- **Modify:** `packages/backend/src/services/automation.ts` — expose executeRule (or inline test logic)
- **Modify:** `packages/dashboard/src/app/dashboard/automation/page.tsx` — Test Fire button + result display

---

## Sample Data Per Trigger

Each trigger type needs sample data that matches what real fireTrigger calls provide:

```typescript
const SAMPLE_DATA: Record<string, Record<string, string>> = {
  stop_completed:       { patientName: 'Jane Smith', patientPhone: '+15555550100', patientEmail: 'patient@example.com', address: '123 Main St, Detroit, MI', stopStatus: 'completed', driverName: 'Marcus J.' },
  stop_failed:          { patientName: 'Jane Smith', patientPhone: '+15555550100', patientEmail: 'patient@example.com', address: '456 Oak Ave, Ann Arbor, MI', stopStatus: 'failed',    driverName: 'Marcus J.' },
  stop_status_changed:  { patientName: 'Jane Smith', patientPhone: '+15555550100', patientEmail: 'patient@example.com', address: '789 Elm St, Dearborn, MI', stopStatus: 'arrived',    driverName: 'Marcus J.' },
  driver_started_route: { patientName: 'Jane Smith', patientPhone: '+15555550100', patientEmail: 'patient@example.com', address: '321 Pine Rd, Lansing, MI',  stopStatus: 'pending',    driverName: 'Marcus J.', routeId: 'test-route', driverId: 'test-driver' },
  route_completed:      { patientName: '',            patientPhone: '',             patientEmail: '',                    address: '',                           driverName: 'Marcus J.', routeId: 'test-route', completedCount: '8', totalStops: '10', failedCount: '2' },
  stop_approaching:     { patientName: 'Jane Smith', patientPhone: '+15555550100', patientEmail: 'patient@example.com', address: '654 Birch Ln, Flint, MI',    stopStatus: 'pending',    driverName: 'Marcus J.', stopsAway: '2', etaMin: '16' },
};
```

---

## Task 1: Backend test-fire endpoint

**Files:**
- Modify: `packages/backend/src/routes/automation.ts`
- Modify: `packages/backend/src/services/automation.ts`

- [ ] **Step 1: Export executeRule from automation.ts service**

In `packages/backend/src/services/automation.ts`, change:
```typescript
async function executeRule(
```
to:
```typescript
export async function executeRule(
```

- [ ] **Step 2: Add SAMPLE_DATA constant to automation.ts routes**

At the top of `automationRoutes` (after `VALID_TRIGGERS`), add:
```typescript
const SAMPLE_DATA: Record<string, Record<string, string>> = {
  stop_completed:       { patientName: 'Jane Smith', patientPhone: '+15555550100', patientEmail: 'patient@example.com', address: '123 Main St, Detroit, MI', stopStatus: 'completed', driverName: 'Marcus J.' },
  stop_failed:          { patientName: 'Jane Smith', patientPhone: '+15555550100', patientEmail: 'patient@example.com', address: '456 Oak Ave, Ann Arbor, MI', stopStatus: 'failed', driverName: 'Marcus J.' },
  stop_status_changed:  { patientName: 'Jane Smith', patientPhone: '+15555550100', patientEmail: 'patient@example.com', address: '789 Elm St, Dearborn, MI', stopStatus: 'arrived', driverName: 'Marcus J.' },
  driver_started_route: { patientName: 'Jane Smith', patientPhone: '+15555550100', patientEmail: 'patient@example.com', address: '321 Pine Rd, Lansing, MI', stopStatus: 'pending', driverName: 'Marcus J.', routeId: 'test-route', driverId: 'test-driver' },
  route_completed:      { patientName: '', patientPhone: '', patientEmail: '', address: '', driverName: 'Marcus J.', routeId: 'test-route', completedCount: '8', totalStops: '10', failedCount: '2' },
  stop_approaching:     { patientName: 'Jane Smith', patientPhone: '+15555550100', patientEmail: 'patient@example.com', address: '654 Birch Ln, Flint, MI', stopStatus: 'pending', driverName: 'Marcus J.', stopsAway: '2', etaMin: '16' },
};
```

- [ ] **Step 3: Add the test-fire endpoint**

After the PATCH /rules/:ruleId handler, add:

```typescript
// POST /orgs/:orgId/automation/rules/:ruleId/test — fire rule with sample data (no side effects)
app.post('/rules/:ruleId/test', { preHandler: requireRole(...authRoles) }, async (req, reply) => {
  const { orgId, ruleId } = req.params as { orgId: string; ruleId: string };

  const [rule] = await db.select().from(automationRules)
    .where(and(eq(automationRules.id, ruleId), eq(automationRules.orgId, orgId)))
    .limit(1);
  if (!rule) return reply.code(404).send({ error: 'Rule not found' });

  const sampleData = SAMPLE_DATA[rule.trigger] ?? {};

  try {
    await executeRule(rule, {
      orgId,
      trigger: rule.trigger,
      resourceId: 'test-fire',
      data: sampleData,
    });
    return { ok: true, message: 'Test fired successfully. Check your SMS/email for delivery confirmation.' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return reply.code(422).send({ ok: false, message: `Test failed: ${detail}` });
  }
});
```

- [ ] **Step 4: Add executeRule import in routes file**

At the top of `automation.ts` routes file, add to the import from automation service:
```typescript
import { fireTrigger, executeRule } from '../services/automation.js';
```

Wait — `automation.ts` routes does NOT currently import from services. It imports separately. Add the import:
```typescript
import { executeRule } from '../services/automation.js';
```

- [ ] **Step 5: TypeScript check**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: 0 errors
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/routes/automation.ts packages/backend/src/services/automation.ts
git commit -m "feat(automation): test-fire endpoint POST /rules/:ruleId/test with sample data"
```

---

## Task 2: Frontend — Test Fire button + result display

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/automation/page.tsx`

- [ ] **Step 1: Add test-fire state**

After the `deleting` state declarations, add:
```typescript
const [testingId, setTestingId] = useState<string | null>(null);
const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
```

- [ ] **Step 2: Add testFire handler**

After the `deleteRule` function, add:
```typescript
const testFire = async (ruleId: string) => {
  setTestingId(ruleId);
  setTestResults(r => ({ ...r, [ruleId]: { ok: true, message: '' } }));
  try {
    const result = await api.post<{ ok: boolean; message: string }>(`/orgs/${orgId}/automation/rules/${ruleId}/test`, {});
    setTestResults(r => ({ ...r, [ruleId]: result }));
  } catch {
    setTestResults(r => ({ ...r, [ruleId]: { ok: false, message: 'Test failed. Check credentials.' } }));
  } finally {
    setTestingId(null);
    // Auto-clear after 6s
    setTimeout(() => setTestResults(r => { const n = { ...r }; delete n[ruleId]; return n; }), 6000);
  }
};
```

- [ ] **Step 3: Add Flask/Play icon to imports**

In the lucide-react import line, add `FlaskConical` (or `Play` if FlaskConical not available):
```typescript
import {
  Zap, Plus, CheckCircle2, XCircle, Clock, RefreshCw,
  X, ToggleLeft, ToggleRight, Loader2, Trash2, AlertCircle, FlaskConical,
} from 'lucide-react';
```

- [ ] **Step 4: Add Test Fire button to each rule row**

In the rule row actions area, between the run count div and the delete Trash2 button, add:
```tsx
<button
  onClick={() => testFire(rule.id)}
  disabled={testingId === rule.id || !rule.enabled}
  title={rule.enabled ? 'Test fire this rule with sample data' : 'Enable rule to test'}
  className="p-1.5 text-gray-300 hover:text-purple-500 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-40"
>
  {testingId === rule.id
    ? <Loader2 size={13} className="animate-spin" />
    : <FlaskConical size={13} />
  }
</button>
```

- [ ] **Step 5: Add inline result display below each rule**

After the main rule row `<div>`, still inside the `.map(rule => ...)`, add:
```tsx
{testResults[rule.id] && (
  <div className={`mx-4 mb-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${
    testResults[rule.id].ok
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-red-50 text-red-600'
  }`}>
    {testResults[rule.id].ok
      ? <CheckCircle2 size={12} />
      : <XCircle size={12} />
    }
    {testResults[rule.id].message}
  </div>
)}
```

- [ ] **Step 6: TypeScript check + commit**

```bash
cd packages/dashboard && npx tsc --noEmit
git add packages/dashboard/src/app/dashboard/automation/page.tsx
git commit -m "feat(automation): Test Fire button per rule with 6s inline result toast"
```

---

## Self-Review

**Spec coverage:**
- Backend endpoint dispatches real actions (SMS/email) with sample data ✅
- No side effects: no automationLog entry, no runCount increment ✅
- Frontend button per rule row ✅
- Disabled when rule is disabled (would always no-op) ✅
- Auto-clears result after 6s ✅
- Error shown when credentials missing or send fails ✅

**Risks:**
- Test SMS sends to a real phone number (`patientPhone: '+15555550100'`) — this is a fake US number that should be unreachable in Twilio (555 numbers). If not, use Twilio test number +15005550006 instead.
- `executeRule` export change is safe — it was already used internally in `fireTrigger` loop
- Test fires during demo could send test messages if Twilio is configured — operators should know this

**No migrations needed.** No schema changes.
