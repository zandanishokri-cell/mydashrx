import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  real,
  jsonb,
  pgEnum,
  uuid,
  varchar,
  index,
  uniqueIndex,
  time,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─── Enums ────────────────────────────────────────────────────────────────────
export const roleEnum = pgEnum('role', [
  'super_admin',
  'pharmacy_admin',
  'dispatcher',
  'driver',
  'pharmacist',
]);
export const billingPlanEnum = pgEnum('billing_plan', [
  'starter',
  'growth',
  'pro',
  'enterprise',
]);
export const driverStatusEnum = pgEnum('driver_status', [
  'available',
  'on_route',
  'offline',
]);
export const planStatusEnum = pgEnum('plan_status', [
  'draft',
  'optimized',
  'distributed',
  'completed',
]);
export const routeStatusEnum = pgEnum('route_status', [
  'pending',
  'active',
  'completed',
]);
export const stopStatusEnum = pgEnum('stop_status', [
  'pending',
  'en_route',
  'arrived',
  'completed',
  'failed',
  'rescheduled',
]);
export const vehicleTypeEnum = pgEnum('vehicle_type', ['car', 'van', 'bicycle']);
export const notifChannelEnum = pgEnum('notif_channel', ['sms', 'email', 'push']);

// ─── Tables ───────────────────────────────────────────────────────────────────
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull().default('America/New_York'),
  hipaaBaaStatus: text('hipaa_baa_status').notNull().default('pending'),
  billingPlan: billingPlanEnum('billing_plan').notNull().default('starter'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripeSubscriptionStatus: text('stripe_subscription_status').default('inactive'),
  pendingApproval: boolean('pending_approval').notNull().default(false),
  approvalReminderSentAt: jsonb('approval_reminder_sent_at').$type<Record<string, string>>(),
  approvedAt: timestamp('approved_at'),
  onboardingEmailSentAt: jsonb('onboarding_email_sent_at').default('{}'),
  rejectedAt: timestamp('rejected_at'),
  rejectionReason: text('rejection_reason'),
  rejectionNote: text('rejection_note'),
  riskFlags: jsonb('risk_flags').$type<string[]>(),
  riskScore: integer('risk_score'), // 0-100 composite risk score (P-ADM22)
  trustTier: text('trust_tier').default('manual'), // 'auto_approve' | 'block' | 'manual'
  autoApprovedAt: timestamp('auto_approved_at'),
  npiNumber: text('npi_number'), // P-ADM27: 10-digit NPI captured at signup
  npiVerified: boolean('npi_verified').default(false), // NPPES API verified
  npiVerifiedAt: timestamp('npi_verified_at'), // when NPPES confirmed NPI
  reappliedAt: timestamp('reapplied_at'), // P-ADM28: timestamp of most recent reapplication
  // P-ADM20: hold-back state — admin can pause review to request more info
  onHold: boolean('on_hold').notNull().default(false),
  holdReason: text('hold_reason'),
  holdRequestedAt: timestamp('hold_requested_at'),
  onboardingDepotAt: timestamp('onboarding_depot_at'), // P-ONB10: when depot step completed in wizard
  onboardingDriverAt: timestamp('onboarding_driver_at'), // P-ONB10: when driver step completed
  onboardingCompletedAt: timestamp('onboarding_completed_at'), // P-ONB10: when full onboarding completed
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    role: roleEnum('role').notNull(),
    depotIds: jsonb('depot_ids').notNull().default('[]'),
    notificationPreferences: jsonb('notification_preferences').notNull().default('{"route_completed":true,"stop_failed":true,"stop_assigned":true}'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    pendingApproval: boolean('pending_approval').notNull().default(false),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until'),
    tokenVersion: integer('token_version').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => ({ orgIdx: index('users_org_idx').on(t.orgId) }),
);

export const depots = pgTable('depots', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  address: text('address').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  phone: varchar('phone', { length: 20 }),
  operatingHours: jsonb('operating_hours'),
  deletedAt: timestamp('deleted_at'),
});

export const drivers = pgTable(
  'drivers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: varchar('phone', { length: 20 }).notNull().default(''),
    passwordHash: text('password_hash').notNull(),
    licenseNumber: text('license_number'),
    drugCapable: boolean('drug_capable').notNull().default(false),
    vehicleType: vehicleTypeEnum('vehicle_type').notNull().default('car'),
    status: driverStatusEnum('status').notNull().default('offline'),
    currentLat: real('current_lat'),
    currentLng: real('current_lng'),
    lastPingAt: timestamp('last_ping_at'),
    zoneIds: jsonb('zone_ids').notNull().default('[]'),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => ({ orgIdx: index('drivers_org_idx').on(t.orgId) }),
);

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    depotId: uuid('depot_id')
      .notNull()
      .references(() => depots.id),
    date: text('date').notNull(),
    status: planStatusEnum('status').notNull().default('draft'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => ({
    orgIdx: index('plans_org_idx').on(t.orgId),
    dateIdx: index('plans_date_idx').on(t.date),
  }),
);

export const routes = pgTable('routes', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id),
  driverId: uuid('driver_id')
    .references(() => drivers.id),
  status: routeStatusEnum('status').notNull().default('pending'),
  stopOrder: jsonb('stop_order').notNull().default('[]'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  estimatedDuration: integer('estimated_duration'),
  totalDistance: real('total_distance'),
  deletedAt: timestamp('deleted_at'),
});

export const stops = pgTable(
  'stops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routeId: uuid('route_id')
      .references(() => routes.id),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    recipientName: text('recipient_name').notNull(),
    recipientPhone: varchar('recipient_phone', { length: 20 }).notNull(),
    recipientEmail: text('recipient_email'),
    address: text('address').notNull(),
    unit: text('unit'),
    deliveryNotes: text('delivery_notes'),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    rxNumbers: jsonb('rx_numbers').notNull().default('[]'),
    barcodesScanned: jsonb('barcodes_scanned').notNull().default('[]'),
    packageConfirmed: boolean('package_confirmed').notNull().default(false),
    packageCount: integer('package_count').notNull().default(1),
    requiresRefrigeration: boolean('requires_refrigeration').notNull().default(false),
    controlledSubstance: boolean('controlled_substance').notNull().default(false),
    codAmount: integer('cod_amount'),
    codCollected: boolean('cod_collected').notNull().default(false), // P-COMP8: co-pay collected flag
    codMethod: text('cod_method'),                                   // 'cash' | 'card' | 'waived'
    codCollectedAt: timestamp('cod_collected_at'),
    requiresSignature: boolean('requires_signature').notNull().default(true),
    requiresPhoto: boolean('requires_photo').notNull().default(false),
    requiresAgeVerification: boolean('requires_age_verification').notNull().default(false),
    windowStart: timestamp('window_start'),
    windowEnd: timestamp('window_end'),
    status: stopStatusEnum('status').notNull().default('pending'),
    failureReason: text('failure_reason'),
    failureNote: text('failure_note'),
    arrivedAt: timestamp('arrived_at'),
    completedAt: timestamp('completed_at'),
    returnedAt: timestamp('returned_at'),
    redeliveryScheduledAt: timestamp('redelivery_scheduled_at'),
    approachNotifiedAt: timestamp('approach_notified_at'),
    trackingToken: uuid('tracking_token').notNull().defaultRandom().unique(),
    sequenceNumber: integer('sequence_number').notNull().default(0),
    priority: text('priority').notNull().default('normal'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => ({
    orgIdx: index('stops_org_idx').on(t.orgId),
    routeIdx: index('stops_route_idx').on(t.routeId),
    tokenIdx: index('stops_token_idx').on(t.trackingToken),
    // P-PERF1: composite index for analytics date-range queries — 80-95% latency reduction
    orgCreatedIdx: index('stops_org_created_idx').on(t.orgId, t.createdAt),
    // P-PERF1: partial index for active (non-deleted) stops — skips all soft-deleted rows
    activeIdx: index('stops_active_idx').on(t.orgId).where(sql`deleted_at IS NULL`),
  }),
);

export const proofOfDeliveries = pgTable('proof_of_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  stopId: uuid('stop_id')
    .notNull()
    .references(() => stops.id)
    .unique(),
  driverId: uuid('driver_id')
    .notNull()
    .references(() => drivers.id),
  packageCount: integer('package_count').notNull(),
  signature: jsonb('signature'),
  photos: jsonb('photos').notNull().default('[]'),
  ageVerification: jsonb('age_verification'),
  codCollected: jsonb('cod_collected'),
  driverNote: text('driver_note'),
  customerNote: text('customer_note'),
  barcodesScanned: jsonb('barcodes_scanned').notNull().default('[]'),
  // Enhanced POD fields
  signatureData: text('signature_data'),
  idPhotoUrl: text('id_photo_url'),
  idVerified: boolean('id_verified').notNull().default(false),
  recipientName: text('recipient_name'),
  deliveryNotes: text('delivery_notes'),
  isControlledSubstance: boolean('is_controlled_substance').notNull().default(false),
  idDobConfirmed: boolean('id_dob_confirmed').notNull().default(false),
  capturedAt: timestamp('captured_at').notNull().defaultNow(),
});

export const notificationLogs = pgTable('notification_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  stopId: uuid('stop_id')
    .notNull()
    .references(() => stops.id),
  event: text('event').notNull(),
  channel: notifChannelEnum('channel').notNull(),
  recipient: text('recipient').notNull(),
  status: text('status').notNull().default('sent'),
  externalId: text('external_id'),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
});

export const driverLocationHistory = pgTable(
  'driver_location_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id),
    routeId: uuid('route_id').references(() => routes.id),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    recordedAt: timestamp('recorded_at').notNull().defaultNow(),
  },
  (t) => ({ driverIdx: index('location_driver_idx').on(t.driverId) }),
);

// ─── Lead Finder ──────────────────────────────────────────────────────────────
export const leadStatusEnum = pgEnum('lead_status', [
  'new', 'contacted', 'interested', 'negotiating', 'closed', 'lost',
]);

export const leadProspects = pgTable('lead_prospects', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  address: text('address').notNull(),
  city: text('city').notNull(),
  state: varchar('state', { length: 2 }).notNull().default('MI'),
  zip: varchar('zip', { length: 10 }),
  phone: varchar('phone', { length: 20 }),
  website: text('website'),
  email: text('email'),
  ownerName: text('owner_name'),
  businessType: text('business_type'),
  googlePlaceId: text('google_place_id'),
  rating: real('rating'),
  reviewCount: integer('review_count'),
  score: integer('score').notNull().default(0),
  status: leadStatusEnum('status').notNull().default('new'),
  assignedTo: uuid('assigned_to').references(() => users.id),
  notes: text('notes'),
  nextFollowUp: timestamp('next_follow_up'),
  lastContactedAt: timestamp('last_contacted_at'),
  tags: jsonb('tags').notNull().default('[]'),
  sourceData: jsonb('source_data').notNull().default('{}'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (t) => ({
  orgIdx: index('leads_org_idx').on(t.orgId),
  statusIdx: index('leads_status_idx').on(t.status),
  // Per-org uniqueness: same pharmacy can't be imported twice by the same org,
  // but two different orgs may import the same Google Place.
  orgPlaceUniq: uniqueIndex('leads_org_place_idx').on(t.orgId, t.googlePlaceId),
}));

export const leadOutreachLog = pgTable('lead_outreach_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  leadId: uuid('lead_id').notNull().references(() => leadProspects.id),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  channel: text('channel').notNull().default('email'),
  subject: text('subject'),
  body: text('body'),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
  sentBy: uuid('sent_by').references(() => users.id),
  resendMessageId: text('resend_message_id'),
  status: text('status').notNull().default('sent'),
});

// ─── HIPAA Compliance ─────────────────────────────────────────────────────────
export const baaStatusEnum = pgEnum('baa_status', ['signed', 'pending', 'not_required', 'expired']);

export const baaRegistry = pgTable('baa_registry', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  vendorName: text('vendor_name').notNull(),
  service: text('service').notNull(),
  baaStatus: baaStatusEnum('baa_status').notNull().default('pending'),
  signedAt: timestamp('signed_at'),
  expiresAt: timestamp('expires_at'),
  documentUrl: text('document_url'),
  notes: text('notes'),
  touchesPhi: boolean('touches_phi').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  userId: uuid('user_id').references(() => users.id),
  userEmail: text('user_email'),
  action: text('action').notNull(),
  resource: text('resource').notNull(),
  resourceId: text('resource_id'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  metadata: jsonb('metadata').notNull().default('{}'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('audit_org_idx').on(t.orgId),
  createdIdx: index('audit_created_idx').on(t.createdAt),
}));

export const complianceChecks = pgTable('compliance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  category: text('category').notNull(),
  checkName: text('check_name').notNull(),
  status: text('status').notNull().default('unknown'),
  detail: text('detail'),
  lastCheckedAt: timestamp('last_checked_at').notNull().defaultNow(),
  nextCheckAt: timestamp('next_check_at'),
});

export const complianceScoreHistory = pgTable('compliance_score_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  score: integer('score').notNull(),
  violationCount: integer('violation_count').notNull().default(0),
  p0Count: integer('p0_count').notNull().default(0),
  p1Count: integer('p1_count').notNull().default(0),
  scannedAt: timestamp('scanned_at').notNull().defaultNow(),
});

// ─── Michigan Compliance ──────────────────────────────────────────────────────
export const miComplianceItems = pgTable('mi_compliance_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  category: text('category').notNull(),
  itemName: text('item_name').notNull(),
  status: text('status').notNull().default('pending'),
  notes: text('notes'),
  dueDate: timestamp('due_date'),
  completedAt: timestamp('completed_at'),
  legalRef: text('legal_ref'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('mi_compliance_org_idx').on(t.orgId),
  categoryIdx: index('mi_compliance_category_idx').on(t.category),
}));

export const regulatoryUpdates = pgTable('regulatory_updates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  source: text('source').notNull(),
  impactLevel: text('impact_level').notNull().default('medium'),
  effectiveDate: timestamp('effective_date'),
  url: text('url'),
  acknowledged: boolean('acknowledged').notNull().default(false),
  acknowledgedAt: timestamp('acknowledged_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('regulatory_updates_org_idx').on(t.orgId),
}));

// ─── Recurring Deliveries ─────────────────────────────────────────────────────
export const recurringScheduleEnum = pgEnum('recurring_schedule', [
  'weekly', 'biweekly', 'monthly', 'custom',
]);

export const recurringDeliveries = pgTable('recurring_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  recipientName: text('recipient_name').notNull(),
  address: text('address').notNull(),
  lat: real('lat'),
  lng: real('lng'),
  recipientPhone: varchar('recipient_phone', { length: 20 }),
  recipientEmail: text('recipient_email'),
  notes: text('notes'),
  schedule: recurringScheduleEnum('schedule').notNull().default('weekly'),
  dayOfWeek: integer('day_of_week'),
  dayOfMonth: integer('day_of_month'),
  nextDeliveryDate: timestamp('next_delivery_date'),
  lastDeliveryDate: timestamp('last_delivery_date'),
  rxNumber: text('rx_number'),
  isControlled: boolean('is_controlled').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  endDate: timestamp('end_date'),
  requiresSignature: boolean('requires_signature').notNull().default(true),
  requiresRefrigeration: boolean('requires_refrigeration').notNull().default(false),
  windowStartTime: time('window_start_time'),
  windowEndTime: time('window_end_time'),
  customIntervalDays: integer('custom_interval_days'),
  depotId: uuid('depot_id').references(() => depots.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (t) => ({ orgIdx: index('recurring_org_idx').on(t.orgId) }));

// ─── Automation ───────────────────────────────────────────────────────────────
export const automationTriggerEnum = pgEnum('automation_trigger', [
  'stop_status_changed',
  'stop_failed',
  'stop_completed',
  'driver_started_route',
  'route_completed',
  'stop_approaching',
]);

export const automationRules = pgTable('automation_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  trigger: automationTriggerEnum('trigger').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  conditions: jsonb('conditions').notNull().default('{}'),
  actions: jsonb('actions').notNull().default('[]'),
  smsTemplate: text('sms_template'),
  emailSubject: text('email_subject'),
  emailTemplate: text('email_template'),
  runCount: integer('run_count').notNull().default(0),
  lastRunAt: timestamp('last_run_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const automationLog = pgTable('automation_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  ruleId: uuid('rule_id').notNull().references(() => automationRules.id),
  trigger: text('trigger').notNull(),
  resourceId: text('resource_id'),
  status: text('status').notNull().default('success'),
  detail: text('detail'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ orgIdx: index('auto_log_org_idx').on(t.orgId) }));

// ─── Staff Invitations ────────────────────────────────────────────────────────
export const staffInvitations = pgTable('staff_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  email: text('email').notNull(),
  role: roleEnum('role').notNull().default('pharmacist'),
  tokenHash: text('token_hash').notNull().unique(),
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ orgIdx: index('staff_inv_org_idx').on(t.orgId) }));

// ─── Admin Audit Logs (HIPAA §164.312(b)) ────────────────────────────────────
export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').notNull().references(() => users.id),
  actorEmail: text('actor_email').notNull(),
  action: text('action').notNull(), // 'approve_org' | 'reject_org' | 'batch_approve' | 'batch_reject' | 'role_change' | 'depot_assign' | 'depot_remove' | 'user_deactivate'
  targetId: uuid('target_id').notNull(),
  targetName: text('target_name').notNull(),
  metadata: jsonb('metadata'),      // { reason?: string, batchSize?: number, oldRole?: string, newRole?: string }
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ actorIdx: index('audit_actor_idx').on(t.actorId) }));

// ─── Magic Link Tokens ────────────────────────────────────────────────────────
export const magicLinkTokens = pgTable('magic_link_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  otpCode: varchar('otp_code', { length: 64 }),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  firstClickedAt: timestamp('first_clicked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  emailIdx: index('magic_link_email_idx').on(t.email),
  activeTokenIdx: index('mlt_active_idx').on(t.tokenHash).where(sql`used_at IS NULL AND expires_at > NOW()`),
}));

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  jti: uuid('jti').notNull().unique(),
  familyId: uuid('family_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  status: text('status').notNull().default('active'), // 'active' | 'used' | 'revoked'
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  usedAt: timestamp('used_at'),
  lastUsedAt: timestamp('last_used_at'), // P-SES16: updated on each rotation for idle expiry tracking
  absoluteExpiresAt: timestamp('absolute_expires_at'), // P-SES16: hard upper bound (90d) regardless of activity
  deviceName: text('device_name'), // P-SES18: stable device label stored at RT creation (not re-parsed on each view)
  expiresAt: timestamp('expires_at').notNull(),
}, (t) => ({
  familyIdx: index('rt_family_idx').on(t.familyId),
  userStatusIdx: index('rt_user_status_idx').on(t.userId, t.status),
}));


// P-ADM19: Internal admin notes on pending approvals
export const approvalNotes = pgTable('approval_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  adminId: uuid('admin_id').notNull().references(() => users.id),
  adminEmail: text('admin_email').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ orgIdx: index('approval_notes_org_idx').on(t.orgId) }));

// P-CNV14: Signup intent capture for abandonment email recovery
export const signupIntents = pgTable('signup_intents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgName: text('org_name'),
  adminEmail: text('admin_email').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  recoveredAt: timestamp('recovered_at'), // set when abandonment email sent
  unsubscribedAt: timestamp('unsubscribed_at'), // CAN-SPAM compliance
}, (t) => ({
  emailIdx: index('si_email_idx').on(t.adminEmail),
}));
