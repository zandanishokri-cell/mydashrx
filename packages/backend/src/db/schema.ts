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
    .notNull()
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
