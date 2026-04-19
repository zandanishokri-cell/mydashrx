import { db } from '../db/connection.js';
import { organizations } from '../db/schema.js';
import { eq, isNull, and } from 'drizzle-orm';

export async function runAutoApproval(): Promise<{ approved: number; blocked: number }> {
  const now = new Date();
  let approved = 0;
  let blocked = 0;

  const toApprove = await db.select({ id: organizations.id })
    .from(organizations)
    .where(and(
      eq(organizations.trustTier, 'auto_approve'),
      eq(organizations.pendingApproval, true),
      isNull(organizations.deletedAt),
    ));

  for (const org of toApprove) {
    await db.update(organizations)
      .set({ pendingApproval: false, autoApprovedAt: now })
      .where(eq(organizations.id, org.id));
    approved++;
  }

  const toBlock = await db.select({ id: organizations.id })
    .from(organizations)
    .where(and(
      eq(organizations.trustTier, 'block'),
      eq(organizations.pendingApproval, true),
      isNull(organizations.rejectedAt),
      isNull(organizations.deletedAt),
    ));

  for (const org of toBlock) {
    await db.update(organizations)
      .set({
        pendingApproval: false,
        rejectedAt: now,
        rejectionReason: 'high_fraud_risk',
        rejectionNote: 'Auto-blocked by trust tier policy',
      })
      .where(eq(organizations.id, org.id));
    blocked++;
  }

  if (approved > 0 || blocked > 0) {
    console.log(`[AutoApproval] Approved: ${approved}, Blocked: ${blocked}`);
  }

  return { approved, blocked };
}
