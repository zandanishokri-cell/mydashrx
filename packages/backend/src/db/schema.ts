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
} from 'drizzle-orm/pg-core';

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
    phone: varchar('phone', { length: 20 }).notNull(),
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
      .notNull()
      .references(() => routes.id),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    recipientName: text('recipient_name').notNull(),
    recipientPhone: varchar('recipient_phone', { length: 20 }).notNull(),
    address: text('address').notNull(),
    unit: text('unit'),
    deliveryNotes: text('delivery_notes'),
    lat: real('lat').notNull(),
    lng: real('lng').notNull(),
    rxNumbers: jsonb('rx_numbers').notNull().default('[]'),
    packageCount: integer('package_count').notNull().default(1),
    requiresRefrigeration: boolean('requires_refrigeration').notNull().default(false),
    controlledSubstance: boolean('controlled_substance').notNull().default(false),
    codAmount: integer('cod_amount'),
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
    trackingToken: uuid('tracking_token').notNull().defaultRandom().unique(),
    sequenceNumber: integer('sequence_number').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    deletedAt: timestamp('deleted_at'),
  },
  (t) => ({
    orgIdx: index('stops_org_idx').on(t.orgId),
    routeIdx: index('stops_route_idx').on(t.routeId),
    tokenIdx: index('stops_token_idx').on(t.trackingToken),
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
  googlePlaceId: text('google_place_id').unique(),
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
