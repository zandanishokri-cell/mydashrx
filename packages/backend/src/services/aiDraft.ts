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

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Model returned non-JSON response');

  const parsed = JSON.parse(match[0]) as { subject: string; body: string };
  if (!parsed.subject || !parsed.body) throw new Error('Missing subject or body in model response');

  return parsed;
}
