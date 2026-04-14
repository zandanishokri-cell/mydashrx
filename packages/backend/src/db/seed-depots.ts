import 'dotenv/config';
import { db } from './connection.js';
import { organizations, depots } from './schema.js';
import { eq } from 'drizzle-orm';

const PHARMACIES = [
  { name: 'Trenton Pharmacy', address: '14721 West Jefferson Ave, Trenton, MI 48183', lat: 42.1394, lng: -83.1785 },
  { name: 'Clinton Rx Pharmacy', address: '37479 Gratiot Ave, Clinton Township, MI 48036', lat: 42.5878, lng: -82.9196 },
  { name: 'Detroit Rx Pharmacy', address: '8430 W Vernor Hwy, Detroit, MI 48209', lat: 42.3145, lng: -83.1131 },
  { name: 'Executive Care/Family Drugs Pharmacy', address: '13545 Michigan Ave, Dearborn, MI 48126', lat: 42.3223, lng: -83.1763 },
  { name: 'Family Scripts Pharmacy', address: '18711 W 7 Mile Rd, Detroit, MI 48219', lat: 42.4127, lng: -83.2345 },
  { name: 'H&A Health Pharmacy', address: '7054 W Vernor Hwy, Detroit, MI 48209', lat: 42.3138, lng: -83.1045 },
  { name: 'Lahren Medical Campus Pharmacy', address: '37477 Dequindre Rd, Sterling Heights, MI 48310', lat: 42.5607, lng: -83.0143 },
  { name: 'Minute Script Sav-Mor Pharmacy', address: '14351 Gratiot Ave, Detroit, MI 48205', lat: 42.4012, lng: -82.9876 },
  { name: 'Oak Park Rx Pharmacy', address: '14000 W 9 Mile Rd, Oak Park, MI 48237', lat: 42.4595, lng: -83.1827 },
  { name: 'Park Pharmacy', address: '23720 Michigan Ave, Dearborn, MI 48124', lat: 42.3056, lng: -83.2365 },
  { name: "Pharmacy Recruit's", address: '16807 W 7 Mile Rd, Detroit, MI 48235', lat: 42.4198, lng: -83.1934 },
  { name: 'Pipeline Pharmacy', address: '3011 W Grand Blvd, Detroit, MI 48202', lat: 42.3731, lng: -83.0754 },
  { name: 'PharMor Pharmacy - Evergreen', address: '20250 W 7 Mile Rd, Detroit, MI 48219', lat: 42.4191, lng: -83.2422 },
  { name: 'PharMor Pharmacy - Six Mile', address: '10620 W McNichols Rd, Detroit, MI 48221', lat: 42.4165, lng: -83.1743 },
  { name: 'ProCare Pharmacy', address: '1315 Woodward Ave, Highland Park, MI 48203', lat: 42.4053, lng: -83.0985 },
  { name: 'Rite Health/Town Pharmacy', address: '4835 Michigan Ave, Detroit, MI 48210', lat: 42.3338, lng: -83.1131 },
  { name: 'Wellness Health Mart Pharmacy', address: '11790 Telegraph Rd, Taylor, MI 48180', lat: 42.2409, lng: -83.2697 },
  { name: 'West Meds Pharmacy', address: '22260 W Village Dr, Dearborn, MI 48124', lat: 42.3056, lng: -83.2565 },
  { name: 'Xpress Care Pharmacy', address: '3040 E 7 Mile Rd, Detroit, MI 48234', lat: 42.4165, lng: -83.0123 },
  { name: 'TEST DEPOT', address: '14009 Prospect St, Dearborn, MI 48126', lat: 42.3289, lng: -83.1763 },
];

const [org] = await db.select().from(organizations).limit(1);
if (!org) { console.error('No org found. Run seed.ts first.'); process.exit(1); }
console.log(`📦 Adding depots to org: ${org.name} (${org.id})`);

const existing = await db.select({ name: depots.name }).from(depots).where(eq(depots.orgId, org.id));
const existingNames = new Set(existing.map(d => d.name));

let added = 0;
for (const pharmacy of PHARMACIES) {
  if (existingNames.has(pharmacy.name)) {
    console.log(`  ⏭  Skipping (exists): ${pharmacy.name}`);
    continue;
  }
  await db.insert(depots).values({ orgId: org.id, ...pharmacy });
  console.log(`  ✅ Added: ${pharmacy.name}`);
  added++;
}

console.log(`\n🎉 Done! Added ${added} depots (${existing.length} already existed).`);
process.exit(0);
