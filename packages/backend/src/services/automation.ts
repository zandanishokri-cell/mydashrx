import { db } from '../db/connection.js';
import { automationRules, automationLog, users } from '../db/schema.js';
import { eq, and, sql, isNull } from 'drizzle-orm';

export interface TriggerContext {
  orgId: string;
  trigger: string;
  resourceId: string;
  data: Record<string, unknown>;
}

export async function fireTrigger(ctx: TriggerContext): Promise<void> {
  const rules = await db.select().from(automationRules).where(
    and(
      eq(automationRules.orgId, ctx.orgId),
      eq(automationRules.trigger, ctx.trigger as any),
      eq(automationRules.enabled, true),
    )
  );

  for (const rule of rules) {
    try {
      await executeRule(rule, ctx);
      await db.update(automationRules)
        .set({ runCount: sql`${automationRules.runCount} + 1`, lastRunAt: new Date() })
        .where(eq(automationRules.id, rule.id));
      await db.insert(automationLog).values({
        orgId: ctx.orgId, ruleId: rule.id, trigger: ctx.trigger,
        resourceId: ctx.resourceId, status: 'success',
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await db.insert(automationLog).values({
        orgId: ctx.orgId, ruleId: rule.id, trigger: ctx.trigger,
        resourceId: ctx.resourceId, status: 'failed', detail,
      });
    }
  }
}

async function executeRule(
  rule: typeof automationRules.$inferSelect,
  ctx: TriggerContext,
): Promise<void> {
  const actions = rule.actions as Array<{ type: string; to: string }>;
  for (const action of actions) {
    if (action.type === 'sms' && rule.smsTemplate) {
      const msg = interpolate(rule.smsTemplate, ctx.data);
      const toPhone = ctx.data[action.to + 'Phone'] as string | undefined;
      if (toPhone && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
        await sendTwilioSms(toPhone, msg);
      }
    }
    if (action.type === 'email' && rule.emailTemplate && rule.emailSubject) {
      const body = interpolate(rule.emailTemplate, ctx.data);
      const subject = interpolate(rule.emailSubject, ctx.data);
      if (!process.env.RESEND_API_KEY) continue;
      if (action.to === 'patient') {
        const toEmail = ctx.data.patientEmail as string | undefined;
        if (toEmail) await sendResendEmail(toEmail, subject, body);
      } else {
        // Resolve org users with matching role (dispatcher, pharmacy_admin, etc.)
        const orgUsers = await db
          .select({ email: users.email })
          .from(users)
          .where(and(eq(users.orgId, ctx.orgId), eq(users.role as any, action.to), isNull(users.deletedAt)));
        for (const u of orgUsers) {
          await sendResendEmail(u.email, subject, body).catch(console.error);
        }
      }
    }
  }
}

function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? ''));
}

async function sendTwilioSms(to: string, body: string): Promise<void> {
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_PHONE_NUMBER!, Body: body }).toString(),
    }
  );
  if (!res.ok) throw new Error(`Twilio error: ${res.status}`);
}

async function sendResendEmail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `MyDashRx <notifications@${process.env.SENDER_DOMAIN ?? 'cartana.life'}>`,
      to, subject, html,
    }),
  });
  if (!res.ok) throw new Error(`Resend error: ${res.status}`);
}
