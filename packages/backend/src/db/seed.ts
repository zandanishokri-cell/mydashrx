import 'dotenv/config';
import { db } from './connection.js';
import {
  organizations,
  users,
  depots,
  drivers,
  plans,
  routes,
  stops,
} from './schema.js';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

console.log('🌱 Seeding MyDashRx database...');

// ── Org ────────────────────────────────────────────────────────────────────
const [org] = await db
  .insert(organizations)
  .values({
    name: 'Greater Care Pharmacy',
    timezone: 'America/New_York',
    hipaaBaaStatus: 'pending',
    billingPlan: 'starter',
  })
  .returning();
console.log(`✅ Org created: ${org.name} (${org.id})`);

// ── Users ──────────────────────────────────────────────────────────────────
const passwordHash = await bcrypt.hash('Password123!', 12);

const [admin] = await db
  .insert(users)
  .values({
    orgId: org.id,
    email: 'admin@greatercare.com',
    passwordHash,
    name: 'Sarah Admin',
    role: 'pharmacy_admin',
    depotIds: [],
  })
  .returning();
console.log(`✅ Admin user: ${admin.email}`);

const [dispatcher] = await db
  .insert(users)
  .values({
    orgId: org.id,
    email: 'dispatcher@greatercare.com',
    passwordHash,
    name: 'James Dispatcher',
    role: 'dispatcher',
    depotIds: [],
  })
  .returning();
console.log(`✅ Dispatcher user: ${dispatcher.email}`);

// ── Depot ──────────────────────────────────────────────────────────────────
const [depot] = await db
  .insert(depots)
  .values({
    orgId: org.id,
    name: 'Main Branch',
    address: '123 Main Street, Detroit, MI 48201',
    lat: 42.3314,
    lng: -83.0458,
    phone: '+13135550100',
    operatingHours: { open: '08:00', close: '18:00' },
  })
  .returning();
console.log(`✅ Depot created: ${depot.name}`);

// ── Drivers ────────────────────────────────────────────────────────────────
const [driver1] = await db
  .insert(drivers)
  .values({
    orgId: org.id,
    name: 'Maria Rodriguez',
    email: 'maria@greatercare.com',
    phone: '+13135550101',
    passwordHash,
    drugCapable: true,
    vehicleType: 'car',
    status: 'available',
  })
  .returning();

const [driver2] = await db
  .insert(drivers)
  .values({
    orgId: org.id,
    name: 'Carlos Johnson',
    email: 'carlos@greatercare.com',
    phone: '+13135550102',
    passwordHash,
    drugCapable: false,
    vehicleType: 'van',
    status: 'available',
  })
  .returning();
console.log(`✅ Drivers created: ${driver1.name}, ${driver2.name}`);

// ── Plan ───────────────────────────────────────────────────────────────────
const today = new Date().toISOString().split('T')[0]!;
const [plan] = await db
  .insert(plans)
  .values({
    orgId: org.id,
    depotId: depot.id,
    date: today,
    status: 'draft',
  })
  .returning();
console.log(`✅ Plan created for ${plan.date}`);

// ── Routes ─────────────────────────────────────────────────────────────────
const [route1] = await db
  .insert(routes)
  .values({ planId: plan.id, driverId: driver1.id })
  .returning();

const [route2] = await db
  .insert(routes)
  .values({ planId: plan.id, driverId: driver2.id })
  .returning();
console.log(`✅ Routes created for both drivers`);

// ── Stops ──────────────────────────────────────────────────────────────────
const stopData = [
  {
    routeId: route1.id,
    orgId: org.id,
    recipientName: 'Alice Brown',
    recipientPhone: '+13135550201',
    address: '456 Oak Avenue, Detroit, MI 48202',
    lat: 42.3398,
    lng: -83.0521,
    rxNumbers: ['RX-10023', 'RX-10024'],
    packageCount: 2,
    requiresRefrigeration: false,
    controlledSubstance: false,
    requiresSignature: true,
    requiresPhoto: false,
    requiresAgeVerification: false,
    sequenceNumber: 0,
  },
  {
    routeId: route1.id,
    orgId: org.id,
    recipientName: 'Bob Wilson',
    recipientPhone: '+13135550202',
    address: '789 Elm Street, Detroit, MI 48203',
    lat: 42.3461,
    lng: -83.0478,
    rxNumbers: ['RX-10025'],
    packageCount: 1,
    requiresRefrigeration: true,
    controlledSubstance: true,
    requiresSignature: true,
    requiresPhoto: true,
    requiresAgeVerification: true,
    sequenceNumber: 1,
  },
  {
    routeId: route2.id,
    orgId: org.id,
    recipientName: 'Carol Davis',
    recipientPhone: '+13135550203',
    address: '321 Pine Road, Detroit, MI 48204',
    lat: 42.3267,
    lng: -83.0601,
    rxNumbers: ['RX-10026'],
    packageCount: 1,
    requiresRefrigeration: false,
    controlledSubstance: false,
    codAmount: 2500,
    requiresSignature: true,
    requiresPhoto: false,
    requiresAgeVerification: false,
    sequenceNumber: 0,
  },
];

const insertedStops = await db.insert(stops).values(stopData).returning();
console.log(`✅ ${insertedStops.length} stops created`);

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n🎉 Seed complete!\n');
console.log('Login credentials (all use Password123!):');
console.log(`  Admin:      admin@greatercare.com`);
console.log(`  Dispatcher: dispatcher@greatercare.com`);
console.log(`\nTracking links (visit in browser):`);
for (const stop of insertedStops) {
  console.log(`  ${stop.recipientName}: http://localhost:3000/track/${stop.trackingToken}`);
}
