# Compliance Score History Trend

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a compliance score snapshot every time a scan runs. Display a 30-day trend sparkline on the compliance hub page. Turns the compliance hub from a snapshot tool into a longitudinal record — showing "your score went from 42 → 97 after you fixed those 3 CS stops" in a pharmacy demo.

**Architecture:** New `compliance_score_history` table. After each `POST /scan`, compute score and INSERT. New GET endpoint returns last 30 data points. Frontend: pure SVG sparkline (no new dependencies) on the hub page.

**Score formula:** `100 - min(100, P0×25 + P1×10 + P2×5 + P3×2)`. P0 violations deduct 25 points each (critical, blocks deploy). Simple, transparent, clinically meaningful.

**Tech Stack:** Fastify backend, Drizzle ORM, TypeScript, Next.js 14 frontend. No new npm packages.

---

## File Structure

- **Create:** `packages/backend/src/db/migrations/0011_compliance_score_history.sql`
- **Modify:** `packages/backend/src/db/schema.ts` — add `complianceScoreHistory` table
- **Modify:** `packages/backend/src/routes/compliance.ts` — persist score after scan, add GET endpoint
- **Modify:** `packages/dashboard/src/app/dashboard/compliance/page.tsx` — sparkline + score change badge

---

## Task 1: Schema + migration

**Files:**
- Create: `packages/backend/src/db/migrations/0011_compliance_score_history.sql`
- Modify: `packages/backend/src/db/schema.ts`

- [ ] **Step 1: Create migration file**

Create `packages/backend/src/db/migrations/0011_compliance_score_history.sql`:

```sql
CREATE TABLE IF NOT EXISTS "compliance_score_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "score" integer NOT NULL,
  "violation_count" integer NOT NULL DEFAULT 0,
  "p0_count" integer NOT NULL DEFAULT 0,
  "p1_count" integer NOT NULL DEFAULT 0,
  "scanned_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "score_history_org_time_idx" ON "compliance_score_history" ("org_id", "scanned_at" DESC);
```

- [ ] **Step 2: Add table to schema.ts**

Find the `complianceChecks` table definition. After it (before the Michigan Compliance section), add:

```typescript
export const complianceScoreHistory = pgTable('compliance_score_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  score: integer('score').notNull(),
  violationCount: integer('violation_count').notNull().default(0),
  p0Count: integer('p0_count').notNull().default(0),
  p1Count: integer('p1_count').notNull().default(0),
  scannedAt: timestamp('scanned_at').notNull().defaultNow(),
});
```

- [ ] **Step 3: TypeScript check**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/db/schema.ts packages/backend/src/db/migrations/0011_compliance_score_history.sql
git commit -m "feat(compliance): compliance_score_history table + migration"
```

---

## Task 2: Backend — persist score + history endpoint

**Files:**
- Modify: `packages/backend/src/routes/compliance.ts`

- [ ] **Step 1: Import complianceScoreHistory in compliance.ts**

Find the schema import line:
```typescript
import { ..., complianceChecks, ... } from '../db/schema.js';
```

Add `complianceScoreHistory` to the destructured import.

Also add `desc` to the drizzle-orm import if not already present:
```typescript
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
```

- [ ] **Step 2: Add score computation helper**

After the imports (before the route handler), add:

```typescript
function computeScannerScore(findings: { severity: string; count: number }[]): number {
  const violations = findings.filter(f => f.count > 0);
  const p0 = violations.filter(f => f.severity === 'P0').length;
  const p1 = violations.filter(f => f.severity === 'P1').length;
  const p2 = violations.filter(f => f.severity === 'P2').length;
  const p3 = violations.filter(f => f.severity === 'P3').length;
  return Math.max(0, 100 - Math.min(100, p0 * 25 + p1 * 10 + p2 * 5 + p3 * 2));
}
```

- [ ] **Step 3: Persist score after scan in POST /scan**

Find the `app.post('/scan', ...)` handler. After `const findings = await runComplianceScan(...)`, add:

```typescript
    const score = computeScannerScore(findings);
    // Persist score snapshot (fire-and-forget — don't fail the scan if history insert fails)
    db.insert(complianceScoreHistory).values({
      orgId,
      score,
      violationCount: findings.filter(f => f.count > 0).length,
      p0Count: findings.filter(f => f.severity === 'P0' && f.count > 0).length,
      p1Count: findings.filter(f => f.severity === 'P1' && f.count > 0).length,
    }).catch(console.error);
```

Then in the return object, add the score:
```typescript
    return {
      scannedAt: new Date(),
      findings,
      score,
      summary: { ... },  // existing summary
      blocksDeployment: isDeploymentBlocked(findings),
    };
```

- [ ] **Step 4: Add GET /score-history endpoint**

After the `POST /scan` handler, add:

```typescript
  // GET /orgs/:orgId/compliance/score-history — last 30 scan score data points
  app.get('/score-history', { preHandler: ADMIN }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const rows = await db
      .select({
        score: complianceScoreHistory.score,
        violationCount: complianceScoreHistory.violationCount,
        p0Count: complianceScoreHistory.p0Count,
        scannedAt: complianceScoreHistory.scannedAt,
      })
      .from(complianceScoreHistory)
      .where(eq(complianceScoreHistory.orgId, orgId))
      .orderBy(desc(complianceScoreHistory.scannedAt))
      .limit(30);
    return rows.reverse(); // chronological order for charting
  });
```

- [ ] **Step 5: TypeScript check**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/routes/compliance.ts
git commit -m "feat(compliance): persist compliance score after each scan, GET /score-history endpoint"
```

---

## Task 3: Frontend sparkline on compliance hub

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/compliance/page.tsx`

- [ ] **Step 1: Add ScoreHistory interface and state**

After the `ScanResult` interface, add:

```typescript
interface ScorePoint {
  score: number;
  violationCount: number;
  p0Count: number;
  scannedAt: string;
}
```

In the `CompliancePage` component, after `const [scanResult, setScanResult] = useState<ScanResult | null>(null);`, add:

```typescript
  const [scoreHistory, setScoreHistory] = useState<ScorePoint[]>([]);
```

- [ ] **Step 2: Fetch score history on mount**

In the `useEffect` that calls `loadLatestScan()`, add a parallel fetch for score history:

```typescript
  useEffect(() => {
    if (!user) return;
    loadData();
    loadLatestScan();
    // Fetch score history (best-effort — non-fatal if empty)
    api.get<ScorePoint[]>(`/orgs/${user.orgId}/compliance/score-history`)
      .then(setScoreHistory)
      .catch(() => setScoreHistory([]));
  }, [user, loadData, loadLatestScan]);
```

- [ ] **Step 3: Update scoreHistory after a new scan**

In the `runScan` function, after `setScanResult(result)`, add:

```typescript
      // Append new score point to history immediately (no re-fetch needed)
      if (result.score !== undefined) {
        setScoreHistory(prev => [...prev, {
          score: result.score,
          violationCount: result.summary.violations,
          p0Count: result.summary.P0,
          scannedAt: new Date().toISOString(),
        }]);
      }
```

Note: This requires updating the `ScanResult` interface to include `score?: number`.

- [ ] **Step 4: Add ScoreSparkline component**

After the `statusScoreColor` function, add:

```typescript
function ScoreSparkline({ data }: { data: ScorePoint[] }) {
  if (data.length < 2) return null;

  const W = 200, H = 48, PAD = 4;
  const scores = data.map(d => d.score);
  const minS = Math.min(...scores, 0);
  const maxS = Math.max(...scores, 100);
  const range = maxS - minS || 1;

  const x = (i: number) => PAD + (i / (data.length - 1)) * (W - PAD * 2);
  const y = (s: number) => PAD + ((maxS - s) / range) * (H - PAD * 2);

  const pathD = scores.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(s).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${x(scores.length - 1).toFixed(1)} ${H} L ${x(0).toFixed(1)} ${H} Z`;

  const last = data[data.length - 1];
  const prev = data.length >= 2 ? data[data.length - 2] : null;
  const delta = prev ? last.score - prev.score : 0;

  return (
    <div className="flex items-center gap-3">
      <svg width={W} height={H} className="shrink-0">
        <defs>
          <linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0F4C81" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#0F4C81" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#sparkGrad)" />
        <path d={pathD} fill="none" stroke="#0F4C81" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(scores.length - 1)} cy={y(last.score)} r="3" fill="#0F4C81" />
      </svg>
      <div className="text-right shrink-0">
        <p className="text-xs text-gray-500">Latest: <span className="font-semibold text-gray-800">{last.score}</span></p>
        {delta !== 0 && (
          <p className={`text-xs font-semibold ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {delta > 0 ? '+' : ''}{delta} pts
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Render the sparkline on the hub page**

In the main compliance hub JSX, find the overall score display area (the circular score badge or the `score` number display). After the score display, add:

```tsx
              {scoreHistory.length >= 2 && (
                <div className="mt-3">
                  <p className="text-xs text-gray-400 mb-1.5">30-day trend</p>
                  <ScoreSparkline data={scoreHistory} />
                </div>
              )}
```

Place this inside the same card/section that shows the overall compliance score.

- [ ] **Step 6: Update ScanResult interface to include score**

Find `interface ScanResult` and add:

```typescript
interface ScanResult {
  scannedAt: string;
  findings: ScanFinding[];
  score?: number;
  summary: { total: number; violations: number; P0: number; P1: number; P2: number; P3: number };
  blocksDeployment: boolean;
}
```

- [ ] **Step 7: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src/app/dashboard/compliance/page.tsx
git commit -m "feat(compliance): score history sparkline — 30-day trend on compliance hub"
```

---

## Self-Review

**Spec coverage:**
- Migration creates table + index ✅
- Schema type matches migration ✅
- Score formula: `100 - min(100, P0×25 + P1×10 + P2×5 + P3×2)` ✅
- Fire-and-forget insert (scan never fails due to history) ✅
- History endpoint: last 30 points, chronological, orgId scoped ✅
- Frontend: history fetched on mount (best-effort) ✅
- Frontend: new score appended immediately after scan (no re-fetch) ✅
- Sparkline: SVG area + line + dot, no dependencies ✅
- Sparkline hidden when < 2 data points ✅
- Delta badge shows +N or -N pts vs previous scan ✅

**Demo narrative:** Run a scan → see P0 violations → fix them → run scan again → sparkline shows jump from 42→97 with "+55 pts" badge. This is the most compelling compliance demo moment in the product.

**Edge cases:**
- First scan: history has 1 point → sparkline hidden (needs ≥2 points) ✅
- All perfect: score=100, delta=0 → delta badge hidden ✅
- All scores same: range=1 (guarded) → flat line renders cleanly ✅
