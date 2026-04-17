# AI-Generated Lead Outreach Draft

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Generate Draft" button to the lead outreach email modal that uses Claude to write a personalized first-contact email using the pharmacy's name, city, rating, and business context. Returns a pre-populated subject + body that the dispatcher reviews and edits before sending. Zero auto-send.

**Architecture:** New backend endpoint `POST /orgs/:orgId/leads/:leadId/draft-outreach` reads the lead, constructs a targeted prompt, calls claude-haiku-4-5 (fast + cheap ≈ $0.0003/call), returns `{ subject, body }`. Frontend: "Generate Draft" button in the email modal populates `emailSubject` and `emailBody` states. Graceful 503 when `ANTHROPIC_API_KEY` not set.

**Tech Stack:** Fastify backend + `@anthropic-ai/sdk`, Next.js 14 frontend.

**Differentiator:** ScriptDrop and Onfleet have zero outreach tools. An AI-personalized first contact draft in a pharmacy CRM is genuinely novel and makes every demo memorable.

---

## File Structure

- **Modify:** `packages/backend/package.json` — add `@anthropic-ai/sdk`
- **Create:** `packages/backend/src/services/aiDraft.ts` — draft generation service
- **Modify:** `packages/backend/src/routes/leadFinder.ts` — add draft endpoint
- **Modify:** `packages/dashboard/src/app/dashboard/leads/[leadId]/page.tsx` — Generate Draft button in email modal

---

## Task 1: Backend draft endpoint

**Files:**
- Modify: `packages/backend/package.json`
- Create: `packages/backend/src/services/aiDraft.ts`
- Modify: `packages/backend/src/routes/leadFinder.ts`

- [ ] **Step 1: Add Anthropic SDK to backend dependencies**

```bash
cd packages/backend && npm install @anthropic-ai/sdk
```

Verify it appears in `package.json` dependencies.

- [ ] **Step 2: Create `packages/backend/src/services/aiDraft.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are a business development specialist for a pharmacy delivery company called MyDash Rx.
Write concise, professional outreach emails to independent pharmacies.
Tone: friendly but businesslike. Not salesy. Lead with value, not pitch.
Format: return JSON only — {"subject": "...", "body": "..."}.
Body: 3-4 short paragraphs. No em-dashes. No bullet lists. Plain text (no HTML).`;

export async function generateOutreachDraft(lead: {
  name: string;
  city: string;
  state: string;
  rating: number | null;
  reviewCount: number | null;
  businessType: string | null;
  ownerName: string | null;
}): Promise<{ subject: string; body: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const client = new Anthropic({ apiKey });

  const context = [
    `Pharmacy: ${lead.name}`,
    `Location: ${lead.city}, ${lead.state}`,
    lead.rating ? `Google rating: ${lead.rating}/5 (${lead.reviewCount ?? '?'} reviews)` : null,
    lead.businessType ? `Type: ${lead.businessType}` : null,
    lead.ownerName ? `Owner/contact name: ${lead.ownerName}` : null,
  ].filter(Boolean).join('\n');

  const userPrompt = `Write a first-contact outreach email for this pharmacy:\n\n${context}\n\nWe offer same-day prescription delivery services to pharmacies in Michigan. Our drivers are HIPAA-trained and handle controlled substances. Emphasize: reducing pharmacist workload on delivery logistics, patient adherence improvement, and zero upfront cost to the pharmacy (we charge patients a delivery fee).`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  // Extract JSON from response
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Model returned non-JSON response');

  const parsed = JSON.parse(match[0]) as { subject: string; body: string };
  if (!parsed.subject || !parsed.body) throw new Error('Missing subject or body in model response');

  return parsed;
}
```

- [ ] **Step 3: Add draft endpoint to `packages/backend/src/routes/leadFinder.ts`**

Add this import at the top:
```typescript
import { generateOutreachDraft } from '../services/aiDraft.js';
```

Add this endpoint inside `leadFinderRoutes` (after the outreach POST endpoint, before the closing `}`):

```typescript
  // POST /orgs/:orgId/leads/:leadId/draft-outreach — AI-generated first-contact draft
  app.post('/:leadId/draft-outreach', { preHandler: auth }, async (req, reply) => {
    const { orgId, leadId } = req.params as { orgId: string; leadId: string };

    const [lead] = await db
      .select({
        name: leadProspects.name,
        city: leadProspects.city,
        state: leadProspects.state,
        rating: leadProspects.rating,
        reviewCount: leadProspects.reviewCount,
        businessType: leadProspects.businessType,
        ownerName: leadProspects.ownerName,
      })
      .from(leadProspects)
      .where(and(eq(leadProspects.id, leadId), eq(leadProspects.orgId, orgId), isNull(leadProspects.deletedAt)))
      .limit(1);

    if (!lead) return reply.code(404).send({ error: 'Lead not found' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.code(503).send({ error: 'AI draft generation not configured — set ANTHROPIC_API_KEY' });
    }

    try {
      const draft = await generateOutreachDraft(lead);
      return draft;
    } catch (err) {
      console.error('AI draft generation failed:', err);
      return reply.code(502).send({ error: 'Failed to generate draft. Please try again.' });
    }
  });
```

- [ ] **Step 4: TypeScript check**

```bash
cd packages/backend && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/package.json packages/backend/src/services/aiDraft.ts packages/backend/src/routes/leadFinder.ts
git commit -m "feat(leads): AI outreach draft endpoint — POST /leads/:leadId/draft-outreach"
```

---

## Task 2: Frontend Generate Draft button

**Files:**
- Modify: `packages/dashboard/src/app/dashboard/leads/[leadId]/page.tsx`

- [ ] **Step 1: Add generatingDraft state and handler**

After the `const [sendingEmail, setSendingEmail] = useState(false);` line, add:

```typescript
  const [generatingDraft, setGeneratingDraft] = useState(false);
```

After `showToast`, add the handler:

```typescript
  const generateDraft = async () => {
    if (!lead || generatingDraft) return;
    setGeneratingDraft(true);
    try {
      const draft = await api.post<{ subject: string; body: string }>(
        `/orgs/${user!.orgId}/leads/${lead.id}/draft-outreach`,
        {},
      );
      setEmailSubject(draft.subject);
      setEmailBody(draft.body);
    } catch {
      showToast('Failed to generate draft. Please try again.');
    } finally {
      setGeneratingDraft(false);
    }
  };
```

- [ ] **Step 2: Add Sparkles icon to lucide-react import**

Find the lucide-react import line and add `Sparkles`:

```typescript
import {
  ArrowLeft, Phone, Mail, ExternalLink, Star, Calendar,
  Tag, Save, Send, X, Clock, Sparkles
} from 'lucide-react';
```

- [ ] **Step 3: Add the Generate Draft button in the email modal**

Find the email modal. It has `emailSubject` and `emailBody` inputs. Find the modal header (the title "Send Outreach Email" or similar).

Add the Generate Draft button in the modal header area, right of the title:

```tsx
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Send Outreach Email</h3>
                <button
                  onClick={generateDraft}
                  disabled={generatingDraft}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors"
                >
                  {generatingDraft ? (
                    <>
                      <span className="animate-spin inline-block w-3 h-3 border border-violet-500 border-t-transparent rounded-full" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} />
                      Generate Draft
                    </>
                  )}
                </button>
              </div>
```

Note: Find the exact modal header structure in the file and fit this pattern into it. If the modal uses a different header layout, adapt the button placement to sit near the modal title.

- [ ] **Step 4: TypeScript check**

```bash
cd packages/dashboard && npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/app/dashboard/leads/[leadId]/page.tsx
git commit -m "feat(leads): Generate Draft button — AI-personalized outreach email from lead detail"
```

---

## Self-Review

**Spec coverage:**
- SDK installed ✅
- `ANTHROPIC_API_KEY` unset → 503 (not 500) ✅
- Lead not found → 404 ✅
- Model call fails → 502 with static message (no raw error exposure) ✅
- JSON extraction with regex (handles markdown code fences from model) ✅
- Returns `{ subject, body }` ✅
- Frontend: populates `emailSubject` + `emailBody` states ✅
- Frontend: loading spinner on button ✅
- Frontend: static error toast on failure (no raw error) ✅
- Zero auto-send — dispatcher reviews before sending ✅
- claude-haiku-4-5-20251001 (cheapest, fastest — ~$0.0003/call) ✅

**ENV var to add in Render:**
- `ANTHROPIC_API_KEY` — production Anthropic key

**Cost estimate:**
- 512 max_tokens output + ~200 input tokens = ~700 tokens per call
- claude-haiku-4-5: $0.80/MTok input + $4.00/MTok output
- Per call: ~$0.0006 input + $0.002 output ≈ **$0.003/draft**
- 100 drafts/month ≈ **$0.30/month** — negligible

**Edge cases:**
- Lead has no owner name: prompt omits it gracefully (null filter in context array) ✅
- Model returns JSON in markdown fences: regex `\{[\s\S]*\}` extracts inner JSON ✅
- Model returns incomplete JSON: `JSON.parse` throws → caught → 502 ✅
