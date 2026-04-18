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
  leadProspects,
  automationRules,
  baaRegistry,
  miComplianceItems,
  regulatoryUpdates,
  recurringDeliveries,
} from './schema.js';
import bcrypt from 'bcryptjs';
import { eq, and } from 'drizzle-orm';

console.log('🌱 Seeding MyDashRx database...');

// ── Guard: skip if already seeded ──────────────────────────────────────────
const existingOrg = await db.select().from(organizations).where(eq(organizations.name, 'Greater Care Pharmacy')).limit(1);
if (existingOrg.length > 0) {
  console.log('ℹ️  Database already seeded — skipping.');
  process.exit(0);
}

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

// ══════════════════════════════════════════════════════════════════════════════
// DEMO ORG — Metro Independent Pharmacy
// ══════════════════════════════════════════════════════════════════════════════

// ── Demo Org ───────────────────────────────────────────────────────────────
let demoOrg: typeof org;
try {
  const existing = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, 'Metro Independent Pharmacy'));
  if (existing.length > 0) {
    demoOrg = existing[0]!;
    console.log(`ℹ️  Demo org already exists: ${demoOrg.name}`);
  } else {
    [demoOrg] = await db
      .insert(organizations)
      .values({
        name: 'Metro Independent Pharmacy',
        timezone: 'America/Detroit',
        hipaaBaaStatus: 'pending',
        billingPlan: 'growth',
      })
      .returning();
    console.log(`✅ Demo org created: ${demoOrg.name} (${demoOrg.id})`);
  }
} catch (e) {
  console.error('✗ Demo org failed:', e);
  process.exit(1);
}

// ── Demo Users ─────────────────────────────────────────────────────────────
try {
  const demoUsers = [
    { email: 'admin@mydashrx.com',    password: 'Admin123!', name: 'Platform Admin',   role: 'super_admin'     as const },
    { email: 'pharmacy@demo.com',     password: 'Demo123!',  name: 'Demo Pharmacy Admin', role: 'pharmacy_admin' as const },
    { email: 'dispatch@demo.com',     password: 'Demo123!',  name: 'Demo Dispatcher',  role: 'dispatcher'      as const },
    { email: 'driver1@demo.com',      password: 'Demo123!',  name: 'Demo Driver One',  role: 'driver'          as const },
    { email: 'driver2@demo.com',      password: 'Demo123!',  name: 'Demo Driver Two',  role: 'driver'          as const },
  ];

  for (const u of demoUsers) {
    const existing = await db.select().from(users).where(eq(users.email, u.email));
    if (existing.length > 0) {
      console.log(`ℹ️  User already exists: ${u.email}`);
      continue;
    }
    const hash = await bcrypt.hash(u.password, 12);
    await db.insert(users).values({
      orgId: demoOrg.id,
      email: u.email,
      passwordHash: hash,
      name: u.name,
      role: u.role,
      depotIds: [],
    });
    console.log(`✅ Demo user created: ${u.email}`);
  }
} catch (e) {
  console.error('✗ Demo users failed:', e);
}

// ── Demo Drivers (for driver1@demo.com / driver2@demo.com users) ───────────
try {
  const demoDriverUsers = [
    { email: 'driver1@demo.com', name: 'Demo Driver One' },
    { email: 'driver2@demo.com', name: 'Demo Driver Two' },
  ];
  const demoDriverHash = await bcrypt.hash('Demo123!', 12);
  for (const d of demoDriverUsers) {
    const existing = await db.select({ id: drivers.id }).from(drivers)
      .where(and(eq(drivers.email, d.email), eq(drivers.orgId, demoOrg.id))).limit(1);
    if (existing.length > 0) {
      console.log(`ℹ️  Demo driver record already exists: ${d.email}`);
      continue;
    }
    await db.insert(drivers).values({
      orgId: demoOrg.id,
      name: d.name,
      email: d.email,
      phone: '',
      passwordHash: demoDriverHash,
      vehicleType: 'car',
      status: 'offline',
    });
    console.log(`✅ Demo driver record created: ${d.email}`);
  }
} catch (e) {
  console.error('✗ Demo drivers failed:', e);
}

// ── Demo Depot ─────────────────────────────────────────────────────────────
let demoDepot: typeof depot;
try {
  const existingDepots = await db
    .select()
    .from(depots)
    .where(eq(depots.orgId, demoOrg.id));
  if (existingDepots.length > 0) {
    demoDepot = existingDepots[0]!;
    console.log(`ℹ️  Demo depot already exists: ${demoDepot.name}`);
  } else {
    [demoDepot] = await db
      .insert(depots)
      .values({
        orgId: demoOrg.id,
        name: 'Main Pharmacy Hub',
        address: '123 Woodward Ave, Detroit, MI 48226',
        lat: 42.3314,
        lng: -83.0458,
        phone: '+13135550100',
        operatingHours: { open: '08:00', close: '18:00' },
      })
      .returning();
    console.log(`✅ Demo depot created: ${demoDepot.name}`);
  }
} catch (e) {
  console.error('✗ Demo depot failed:', e);
}

// ── Demo Leads ─────────────────────────────────────────────────────────────
try {
  const existingLeads = await db
    .select()
    .from(leadProspects)
    .where(eq(leadProspects.orgId, demoOrg.id));

  if (existingLeads.length > 0) {
    console.log(`ℹ️  Demo leads already seeded (${existingLeads.length})`);
  } else {
    await db.insert(leadProspects).values([
      {
        orgId: demoOrg.id,
        name: 'Greektown Pharmacy',
        address: '500 Monroe St',
        city: 'Detroit',
        state: 'MI',
        zip: '48226',
        phone: '313-555-0101',
        businessType: 'independent',
        score: 85,
        status: 'new',
      },
      {
        orgId: demoOrg.id,
        name: 'Midtown Rx',
        address: '4750 Cass Ave',
        city: 'Detroit',
        state: 'MI',
        zip: '48201',
        phone: '313-555-0202',
        businessType: 'independent',
        score: 70,
        status: 'contacted',
      },
      {
        orgId: demoOrg.id,
        name: 'Ann Arbor Apothecary',
        address: '220 S Main St',
        city: 'Ann Arbor',
        state: 'MI',
        zip: '48104',
        phone: '734-555-0303',
        website: 'https://a2apothecary.com',
        businessType: 'compounding',
        score: 60,
        status: 'interested',
      },
      {
        orgId: demoOrg.id,
        name: 'Dearborn Family Pharmacy',
        address: '6200 Michigan Ave',
        city: 'Dearborn',
        state: 'MI',
        zip: '48126',
        phone: '313-555-0404',
        businessType: 'independent',
        score: 90,
        status: 'new',
      },
      {
        orgId: demoOrg.id,
        name: 'CVS Pharmacy #4421',
        address: '1000 8 Mile Rd',
        city: 'Detroit',
        state: 'MI',
        zip: '48220',
        phone: '313-555-0505',
        businessType: 'chain',
        score: 15,
        status: 'lost',
      },
    ]);
    console.log('✅ Seeded leads');
  }
} catch (e) {
  console.error('✗ Demo leads failed:', e);
}

// ── Demo Automation Rules ──────────────────────────────────────────────────
try {
  const existingRules = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.orgId, demoOrg.id));

  if (existingRules.length > 0) {
    console.log(`ℹ️  Demo automation rules already seeded (${existingRules.length})`);
  } else {
    await db.insert(automationRules).values([
      {
        orgId: demoOrg.id,
        name: 'Patient Delivery Confirmation',
        trigger: 'stop_completed',
        enabled: true,
        conditions: {},
        actions: [{ type: 'sms', recipient: 'patient' }],
        smsTemplate: 'Your prescription from Metro Independent Pharmacy has been delivered. Thank you!',
        emailSubject: 'Your delivery is complete',
        emailTemplate: 'Hi {{recipientName}}, your prescription delivery is complete.',
      },
      {
        orgId: demoOrg.id,
        name: 'Failed Delivery Alert',
        trigger: 'stop_failed',
        enabled: true,
        conditions: {},
        actions: [{ type: 'sms', recipient: 'dispatcher' }, { type: 'email', recipient: 'dispatcher' }],
        smsTemplate: 'ALERT: Delivery failed for {{recipientName}} at {{address}}. Reason: {{failureReason}}',
        emailSubject: 'Delivery Failed — Action Required',
        emailTemplate: 'A delivery has failed and requires follow-up. Patient: {{recipientName}}, Address: {{address}}.',
      },
      {
        orgId: demoOrg.id,
        name: 'Driver Route Started',
        trigger: 'driver_started_route',
        enabled: true,
        conditions: {},
        actions: [{ type: 'email', recipient: 'dispatcher' }],
        emailSubject: 'Driver {{driverName}} has started their route',
        emailTemplate: '{{driverName}} started their delivery route at {{time}}. {{stopCount}} stops scheduled.',
      },
    ]);
    console.log('✅ Seeded automation rules');
  }
} catch (e) {
  console.error('✗ Demo automation rules failed:', e);
}

// ── Demo BAA Registry ──────────────────────────────────────────────────────
try {
  const existingBaa = await db
    .select()
    .from(baaRegistry)
    .where(eq(baaRegistry.orgId, demoOrg.id));

  if (existingBaa.length > 0) {
    console.log(`ℹ️  BAA registry already seeded (${existingBaa.length})`);
  } else {
    await db.insert(baaRegistry).values([
      {
        orgId: demoOrg.id,
        vendorName: 'Render',
        service: 'Backend hosting & PostgreSQL database',
        baaStatus: 'pending',
        touchesPhi: true,
        notes: 'Required before go-live. Request via Render dashboard.',
      },
      {
        orgId: demoOrg.id,
        vendorName: 'Twilio',
        service: 'SMS notifications',
        baaStatus: 'pending',
        touchesPhi: true,
        notes: 'BAA available via Twilio Trust Hub at enterprise tier.',
      },
      {
        orgId: demoOrg.id,
        vendorName: 'Cloudflare',
        service: 'R2 object storage (proof-of-delivery photos)',
        baaStatus: 'pending',
        touchesPhi: true,
        notes: 'Cloudflare R2 BAA available under Enterprise agreement.',
      },
      {
        orgId: demoOrg.id,
        vendorName: 'Stripe',
        service: 'Payment processing',
        baaStatus: 'not_required',
        touchesPhi: false,
        notes: 'Stripe does not process PHI — billing data only.',
      },
    ]);
    console.log('✅ Seeded BAA registry');
  }
} catch (e) {
  console.error('✗ BAA registry failed:', e);
}

// ── Demo Michigan Compliance Items ─────────────────────────────────────────
try {
  const existingMi = await db
    .select()
    .from(miComplianceItems)
    .where(eq(miComplianceItems.orgId, demoOrg.id));

  if (existingMi.length > 0) {
    console.log(`ℹ️  Michigan compliance items already seeded (${existingMi.length})`);
  } else {
    await db.insert(miComplianceItems).values([
      {
        orgId: demoOrg.id,
        category: 'MAPS Reporting',
        itemName: 'MAPS system registration',
        status: 'pending',
        legalRef: 'MCL 333.7333a',
        notes: 'Register dispensing location with Michigan MAPS system.',
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      {
        orgId: demoOrg.id,
        category: 'MAPS Reporting',
        itemName: 'Real-time MAPS reporting enabled',
        status: 'pending',
        legalRef: 'MCL 333.7333a',
        notes: 'Configure real-time reporting for Schedule II-V dispensing.',
      },
      {
        orgId: demoOrg.id,
        category: 'Controlled Substances',
        itemName: 'ID verification for CII deliveries',
        status: 'in_progress',
        legalRef: 'R 338.3162',
        notes: 'Driver app captures government-issued ID photo for all CII deliveries.',
      },
      {
        orgId: demoOrg.id,
        category: 'Controlled Substances',
        itemName: 'Driver controlled-substance training',
        status: 'pending',
        legalRef: 'MCL 333.17701',
        notes: 'All drivers handling controlled substances must complete training.',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
      {
        orgId: demoOrg.id,
        category: 'Pharmacy License',
        itemName: 'Michigan pharmacy delivery license',
        status: 'pending',
        legalRef: 'MCL 333.17748',
        notes: 'Verify delivery operations are covered under current pharmacy license.',
      },
      {
        orgId: demoOrg.id,
        category: 'HIPAA',
        itemName: 'Patient consent for delivery notifications',
        status: 'completed',
        legalRef: '45 CFR 164.522',
        notes: 'Consent captured at point of prescription intake.',
        completedAt: new Date(),
      },
    ]);
    console.log('✅ Seeded Michigan compliance items');
  }
} catch (e) {
  console.error('✗ Michigan compliance items failed:', e);
}

// ── Demo Regulatory Updates ────────────────────────────────────────────────
try {
  const existingRegs = await db
    .select()
    .from(regulatoryUpdates)
    .where(eq(regulatoryUpdates.orgId, demoOrg.id));

  if (existingRegs.length > 0) {
    console.log(`ℹ️  Regulatory updates already seeded (${existingRegs.length})`);
  } else {
    await db.insert(regulatoryUpdates).values([
      {
        orgId: demoOrg.id,
        title: 'Michigan MAPS Real-Time Reporting Mandate',
        summary: 'Effective January 2025, all Michigan pharmacies must report Schedule II-V dispensing to MAPS within 1 minute of dispensing. Previous 24-hour window eliminated.',
        source: 'Michigan Department of Licensing and Regulatory Affairs (LARA)',
        impactLevel: 'high',
        effectiveDate: new Date('2025-01-01'),
        url: 'https://www.michigan.gov/lara/bureau-list/bpl/health-facilities/pharmacy',
        acknowledged: false,
      },
      {
        orgId: demoOrg.id,
        title: 'Updated ID Verification Requirements for CII Home Delivery',
        summary: 'Michigan Board of Pharmacy clarified that pharmacies must verify and record government-issued photo ID for all Schedule II deliveries to residences. Driver must document refusal if patient declines.',
        source: 'Michigan Board of Pharmacy Advisory Opinion 2024-03',
        impactLevel: 'high',
        effectiveDate: new Date('2024-07-01'),
        acknowledged: false,
      },
      {
        orgId: demoOrg.id,
        title: 'MCL 333.17748 Amendment — Delivery Zone Documentation',
        summary: 'Pharmacies offering home delivery must maintain documented delivery zones and response time commitments. Annual review required.',
        source: 'Michigan Legislature — Public Act 112 of 2024',
        impactLevel: 'medium',
        effectiveDate: new Date('2024-09-01'),
        url: 'https://www.legislature.mi.gov',
        acknowledged: false,
      },
    ]);
    console.log('✅ Seeded regulatory updates');
  }
} catch (e) {
  console.error('✗ Regulatory updates failed:', e);
}

// ── Demo Recurring Deliveries ──────────────────────────────────────────────
try {
  const existingRecurring = await db
    .select()
    .from(recurringDeliveries)
    .where(eq(recurringDeliveries.orgId, demoOrg.id));

  if (existingRecurring.length > 0) {
    console.log(`ℹ️  Recurring deliveries already seeded (${existingRecurring.length})`);
  } else {
    // Compute next Monday, Wednesday
    const now = new Date();
    const nextDay = (dow: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7 || 7));
      return d;
    };

    await db.insert(recurringDeliveries).values([
      {
        orgId: demoOrg.id,
        recipientName: 'Johnson, R.',
        address: '789 Joy Rd, Detroit, MI 48228',
        lat: 42.3523,
        lng: -83.1012,
        schedule: 'weekly',
        dayOfWeek: 1, // Monday
        rxNumber: 'RX-10001',
        isControlled: false,
        enabled: true,
        depotId: demoDepot!.id,
        nextDeliveryDate: nextDay(1),
      },
      {
        orgId: demoOrg.id,
        recipientName: 'Williams, T.',
        address: '2345 Grand River Ave, Detroit, MI 48208',
        lat: 42.3643,
        lng: -83.0892,
        schedule: 'biweekly',
        dayOfWeek: 3, // Wednesday
        rxNumber: 'RX-10002',
        isControlled: true,
        enabled: true,
        depotId: demoDepot!.id,
        nextDeliveryDate: nextDay(3),
      },
      {
        orgId: demoOrg.id,
        recipientName: 'Martinez, L.',
        address: '567 E Warren Ave, Detroit, MI 48201',
        lat: 42.3487,
        lng: -83.0621,
        schedule: 'monthly',
        dayOfMonth: 15,
        rxNumber: 'RX-10003',
        isControlled: false,
        enabled: true,
        depotId: demoDepot!.id,
        nextDeliveryDate: (() => {
          const d = new Date(now.getFullYear(), now.getMonth(), 15);
          if (d <= now) d.setMonth(d.getMonth() + 1);
          return d;
        })(),
      },
    ]);
    console.log('✅ Seeded recurring deliveries');
  }
} catch (e) {
  console.error('✗ Recurring deliveries failed:', e);
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n🎉 Seed complete!\n');
console.log('Greater Care Pharmacy credentials (Password123!):');
console.log(`  Admin:      admin@greatercare.com`);
console.log(`  Dispatcher: dispatcher@greatercare.com`);
console.log('\nDemo org credentials:');
console.log('  Super Admin: admin@mydashrx.com     / Admin123!');
console.log('  Pharmacy:    pharmacy@demo.com       / Demo123!');
console.log('  Dispatcher:  dispatch@demo.com       / Demo123!');
console.log('  Driver 1:    driver1@demo.com        / Demo123!');
console.log('  Driver 2:    driver2@demo.com        / Demo123!');
console.log(`\nTracking links (visit in browser):`);
for (const stop of insertedStops) {
  console.log(`  ${stop.recipientName}: http://localhost:3000/track/${stop.trackingToken}`);
}
