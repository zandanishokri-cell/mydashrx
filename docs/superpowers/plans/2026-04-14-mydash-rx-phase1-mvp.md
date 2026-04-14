# MyDashRx Phase 1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core MyDashRx delivery management platform — backend API, dispatcher dashboard, and patient tracking — so a pharmacy can plan routes, dispatch drivers, capture proof of delivery, and notify patients, entirely without Dispatch.spoke.

**Architecture:** Monorepo with three packages: `backend` (Fastify + PostgreSQL + Supabase Realtime), `dashboard` (Next.js 14 App Router), and `shared` (TypeScript types). PostgreSQL via Supabase; Redis for pub/sub; Cloudflare R2 for POD photo storage. JWT auth with RBAC. Real-time driver tracking via Supabase Realtime websockets.

**Tech Stack:** Node.js 20, Fastify 4, PostgreSQL (Supabase), Drizzle ORM, Next.js 14 App Router, Tailwind CSS, shadcn/ui, Supabase Realtime, Twilio SMS, Cloudflare R2, Google Maps Directions API, TypeScript throughout.

---

## Monorepo File Map

```
mydash-rx/
├── package.json                          # workspace root
├── turbo.json                            # turborepo config
├── .env.example                          # all required env vars
├── docker-compose.yml                    # local postgres + redis
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   └── src/
│   │       ├── types/
│   │       │   ├── auth.ts               # User, Role, JWTPayload
│   │       │   ├── delivery.ts           # Organization, Depot, Driver, Plan, Route, Stop
│   │       │   ├── pod.ts                # ProofOfDelivery, Signature, Photo
│   │       │   └── notifications.ts      # NotificationEvent, NotificationChannel
│   │       └── index.ts
│   ├── backend/
│   │   ├── package.json
│   │   ├── drizzle.config.ts
│   │   └── src/
│   │       ├── index.ts                  # Fastify server entry
│   │       ├── db/
│   │       │   ├── connection.ts         # Drizzle + Supabase client
│   │       │   ├── schema.ts             # all table definitions
│   │       │   └── migrations/           # drizzle-kit generated
│   │       ├── plugins/
│   │       │   ├── auth.ts               # JWT verify plugin
│   │       │   ├── cors.ts
│   │       │   └── rateLimit.ts
│   │       ├── routes/
│   │       │   ├── auth.ts               # POST /auth/login, /auth/refresh
│   │       │   ├── organizations.ts      # CRUD /orgs
│   │       │   ├── depots.ts             # CRUD /orgs/:orgId/depots
│   │       │   ├── drivers.ts            # CRUD /orgs/:orgId/drivers
│   │       │   ├── plans.ts              # CRUD + optimize /orgs/:orgId/plans
│   │       │   ├── routes.ts             # CRUD /plans/:planId/routes
│   │       │   ├── stops.ts              # CRUD + status /routes/:routeId/stops
│   │       │   ├── pod.ts                # POST /stops/:stopId/pod
│   │       │   ├── tracking.ts           # GET /track/:token (public)
│   │       │   └── notifications.ts      # POST /notify (internal)
│   │       ├── services/
│   │       │   ├── auth.ts               # bcrypt, JWT sign/verify
│   │       │   ├── routeOptimizer.ts     # Google Maps Directions API wrapper
│   │       │   ├── geocoder.ts           # Google Maps Geocoding
│   │       │   ├── notifications.ts      # Twilio SMS dispatcher
│   │       │   ├── storage.ts            # Cloudflare R2 presigned URLs
│   │       │   └── trackingToken.ts      # UUID token → stop mapping
│   │       └── middleware/
│   │           ├── requireRole.ts        # RBAC guard
│   │           └── requireOrg.ts         # tenant isolation
│   └── dashboard/
│       ├── package.json
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       └── src/
│           ├── app/
│           │   ├── layout.tsx
│           │   ├── page.tsx              # redirect to /dashboard
│           │   ├── login/page.tsx
│           │   ├── dashboard/
│           │   │   ├── layout.tsx        # sidebar + auth guard
│           │   │   ├── page.tsx          # command center
│           │   │   ├── plans/
│           │   │   │   ├── page.tsx      # plan list
│           │   │   │   ├── new/page.tsx  # route builder
│           │   │   │   └── [planId]/page.tsx  # live monitor
│           │   │   ├── stops/page.tsx    # stop management
│           │   │   └── drivers/page.tsx  # driver roster
│           │   └── track/[token]/page.tsx  # public patient tracking
│           ├── components/
│           │   ├── ui/                   # shadcn components
│           │   ├── RouteCard.tsx
│           │   ├── StopDrawer.tsx
│           │   ├── LiveMap.tsx
│           │   ├── StopMarker.tsx
│           │   └── ComplianceChip.tsx
│           ├── lib/
│           │   ├── api.ts                # typed fetch client
│           │   ├── auth.ts               # session helpers
│           │   └── supabase.ts           # realtime client
│           └── hooks/
│               ├── useDriverPositions.ts # supabase realtime subscription
│               └── usePlan.ts
```

---

## Task 1: Monorepo Scaffold

**Files:**
- Create: `F:/CLAUDE/mydash-rx/package.json`
- Create: `F:/CLAUDE/mydash-rx/turbo.json`
- Create: `F:/CLAUDE/mydash-rx/.env.example`
- Create: `F:/CLAUDE/mydash-rx/docker-compose.yml`
- Create: `F:/CLAUDE/mydash-rx/packages/shared/package.json`
- Create: `F:/CLAUDE/mydash-rx/packages/backend/package.json`
- Create: `F:/CLAUDE/mydash-rx/packages/dashboard/package.json`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "mydash-rx",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "db:push": "turbo run db:push --filter=backend",
    "db:studio": "cd packages/backend && npx drizzle-kit studio"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "db:push": { "cache": false }
  }
}
```

- [ ] **Step 3: Create .env.example**

```bash
# Database (Supabase)
DATABASE_URL=postgresql://postgres:password@localhost:5432/mydash_rx
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

# Auth
JWT_SECRET=your-256-bit-secret-here
JWT_REFRESH_SECRET=your-256-bit-refresh-secret-here
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=90d

# Google Maps
GOOGLE_MAPS_API_KEY=your-google-maps-key

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_FROM_NUMBER=+15551234567

# Cloudflare R2
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=mydash-rx-pod
R2_PUBLIC_URL=https://your-r2-domain.com

# App
NODE_ENV=development
PORT=3001
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 4: Create docker-compose.yml**

```yaml
version: "3.9"
services:
  postgres:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_DB: mydash_rx
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

- [ ] **Step 5: Create packages/shared/package.json**

```json
{
  "name": "@mydash-rx/shared",
  "version": "0.1.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 6: Create packages/backend/package.json**

```json
{
  "name": "@mydash-rx/backend",
  "version": "0.1.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "db:push": "drizzle-kit push",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@mydash-rx/shared": "*",
    "@aws-sdk/client-s3": "^3.0.0",
    "@aws-sdk/s3-request-presigner": "^3.0.0",
    "bcryptjs": "^2.4.3",
    "drizzle-orm": "^0.30.0",
    "fastify": "^4.26.0",
    "@fastify/cors": "^9.0.0",
    "@fastify/jwt": "^8.0.0",
    "@fastify/rate-limit": "^9.0.0",
    "@fastify/multipart": "^8.0.0",
    "postgres": "^3.4.0",
    "twilio": "^5.0.0",
    "uuid": "^9.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20.0.0",
    "@types/uuid": "^9.0.0",
    "drizzle-kit": "^0.20.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 7: Create packages/dashboard/package.json**

```json
{
  "name": "@mydash-rx/dashboard",
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "@mydash-rx/shared": "*",
    "@supabase/supabase-js": "^2.43.0",
    "next": "14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@googlemaps/js-api-loader": "^1.16.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.376.0",
    "tailwind-merge": "^2.3.0",
    "zustand": "^4.5.0",
    "swr": "^2.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 8: Install dependencies**

```bash
cd F:/CLAUDE/mydash-rx && npm install
```

Expected: workspace symlinks created, node_modules populated.

- [ ] **Step 9: Commit**

```bash
cd F:/CLAUDE/mydash-rx
git init
git add .
git commit -m "feat: monorepo scaffold with backend, dashboard, shared packages"
```

---

## Task 2: Shared Types

**Files:**
- Create: `packages/shared/src/types/auth.ts`
- Create: `packages/shared/src/types/delivery.ts`
- Create: `packages/shared/src/types/pod.ts`
- Create: `packages/shared/src/types/notifications.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Create auth types**

```typescript
// packages/shared/src/types/auth.ts
export type Role = 'super_admin' | 'pharmacy_admin' | 'dispatcher' | 'driver' | 'pharmacist';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string;
  depotIds: string[]; // dispatchers may be scoped to specific depots
}

export interface JWTPayload {
  sub: string;    // user id
  email: string;
  role: Role;
  orgId: string;
  depotIds: string[];
  iat: number;
  exp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: Omit<User, 'id'> & { id: string };
}
```

- [ ] **Step 2: Create delivery types**

```typescript
// packages/shared/src/types/delivery.ts
export interface Organization {
  id: string;
  name: string;
  timezone: string;
  hipaaBaaStatus: 'pending' | 'signed';
  billingPlan: 'starter' | 'growth' | 'pro' | 'enterprise';
  createdAt: string;
}

export interface Depot {
  id: string;
  orgId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string;
  operatingHours: { open: string; close: string }; // "08:00", "18:00"
}

export type DriverStatus = 'available' | 'on_route' | 'offline';

export interface Driver {
  id: string;
  orgId: string;
  name: string;
  email: string;
  phone: string;
  licenseNumber: string;
  drugCapable: boolean;           // can handle controlled substances
  vehicleType: 'car' | 'van' | 'bicycle';
  status: DriverStatus;
  currentLat?: number;
  currentLng?: number;
  lastPingAt?: string;
  zoneIds: string[];
}

export type PlanStatus = 'draft' | 'optimized' | 'distributed' | 'completed';

export interface Plan {
  id: string;
  orgId: string;
  depotId: string;
  date: string; // YYYY-MM-DD
  status: PlanStatus;
  totalStops: number;
  completedStops: number;
  createdAt: string;
}

export type RouteStatus = 'pending' | 'active' | 'completed';

export interface Route {
  id: string;
  planId: string;
  driverId: string;
  status: RouteStatus;
  stopOrder: string[]; // ordered stop IDs
  startedAt?: string;
  completedAt?: string;
  estimatedDuration: number; // minutes
  totalDistance: number;     // km
}

export type StopStatus = 'pending' | 'en_route' | 'arrived' | 'completed' | 'failed' | 'rescheduled';

export type FailureReason =
  | 'not_home'
  | 'refused'
  | 'wrong_address'
  | 'patient_hospitalized'
  | 'safety_concern'
  | 'inaccessible'
  | 'other';

export interface Stop {
  id: string;
  routeId: string;
  orgId: string;
  // recipient
  recipientName: string;
  recipientPhone: string;
  address: string;
  unit?: string;
  deliveryNotes?: string;
  lat: number;
  lng: number;
  // rx details
  rxNumbers: string[];
  packageCount: number;
  requiresRefrigeration: boolean;
  controlledSubstance: boolean;
  codAmount?: number; // cents
  // requirements
  requiresSignature: boolean;
  requiresPhoto: boolean;
  requiresAgeVerification: boolean;
  // window
  windowStart?: string; // ISO datetime
  windowEnd?: string;
  // status
  status: StopStatus;
  failureReason?: FailureReason;
  failureNote?: string;
  completedAt?: string;
  arrivedAt?: string;
  // tracking
  trackingToken: string; // UUID for public tracking link
  sequenceNumber: number;
}
```

- [ ] **Step 3: Create POD types**

```typescript
// packages/shared/src/types/pod.ts
export interface Signature {
  svgData: string;   // base64 SVG
  signerName: string;
  capturedAt: string;
  lat: number;
  lng: number;
}

export interface Photo {
  url: string;        // presigned R2 URL
  key: string;        // R2 object key
  capturedAt: string;
  lat: number;
  lng: number;
}

export interface AgeVerification {
  verified: boolean;
  idType?: 'drivers_license' | 'passport' | 'state_id' | 'other';
  idLastFour?: string;
  dobConfirmed: boolean;
  refusedNote?: string;
}

export interface ProofOfDelivery {
  id: string;
  stopId: string;
  driverId: string;
  packageCount: number;
  signature?: Signature;
  photos: Photo[];
  ageVerification?: AgeVerification;
  codCollected?: { amount: number; method: 'cash' | 'card' | 'waived'; note?: string };
  driverNote?: string;
  customerNote?: string;
  capturedAt: string;
}
```

- [ ] **Step 4: Create notification types**

```typescript
// packages/shared/src/types/notifications.ts
export type NotificationEvent =
  | 'route_dispatched'
  | 'stop_approaching'   // 2 stops away
  | 'stop_arrived'
  | 'stop_completed'
  | 'stop_failed'
  | 'eta_updated';

export type NotificationChannel = 'sms' | 'email' | 'push';

export interface NotificationPayload {
  stopId: string;
  event: NotificationEvent;
  recipientPhone: string;
  recipientName: string;
  pharmacyName: string;
  pharmacyPhone: string;
  driverName: string;
  trackingUrl: string;
  etaMinutes?: number;
}
```

- [ ] **Step 5: Create index.ts**

```typescript
// packages/shared/src/index.ts
export * from './types/auth';
export * from './types/delivery';
export * from './types/pod';
export * from './types/notifications';
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat: shared TypeScript types for auth, delivery, POD, notifications"
```

---

## Task 3: Database Schema + Migrations

**Files:**
- Create: `packages/backend/src/db/schema.ts`
- Create: `packages/backend/src/db/connection.ts`
- Create: `packages/backend/drizzle.config.ts`

- [ ] **Step 1: Create drizzle.config.ts**

```typescript
// packages/backend/drizzle.config.ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config;
```

- [ ] **Step 2: Create db/connection.ts**

```typescript
// packages/backend/src/db/connection.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
export type DB = typeof db;
```

- [ ] **Step 3: Create db/schema.ts**

```typescript
// packages/backend/src/db/schema.ts
import {
  pgTable, text, timestamp, boolean, integer, real, jsonb,
  pgEnum, uuid, varchar, index
} from 'drizzle-orm/pg-core';

// Enums
export const roleEnum = pgEnum('role', ['super_admin', 'pharmacy_admin', 'dispatcher', 'driver', 'pharmacist']);
export const billingPlanEnum = pgEnum('billing_plan', ['starter', 'growth', 'pro', 'enterprise']);
export const driverStatusEnum = pgEnum('driver_status', ['available', 'on_route', 'offline']);
export const planStatusEnum = pgEnum('plan_status', ['draft', 'optimized', 'distributed', 'completed']);
export const routeStatusEnum = pgEnum('route_status', ['pending', 'active', 'completed']);
export const stopStatusEnum = pgEnum('stop_status', ['pending', 'en_route', 'arrived', 'completed', 'failed', 'rescheduled']);
export const vehicleTypeEnum = pgEnum('vehicle_type', ['car', 'van', 'bicycle']);
export const notifChannelEnum = pgEnum('notif_channel', ['sms', 'email', 'push']);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull().default('America/New_York'),
  hipaaBaaStatus: text('hipaa_baa_status').notNull().default('pending'),
  billingPlan: billingPlanEnum('billing_plan').notNull().default('starter'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull(),
  depotIds: jsonb('depot_ids').notNull().default('[]'), // string[]
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, t => ({ orgIdx: index('users_org_idx').on(t.orgId) }));

export const depots = pgTable('depots', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  address: text('address').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  phone: varchar('phone', { length: 20 }),
  operatingHours: jsonb('operating_hours'), // {open, close}
  deletedAt: timestamp('deleted_at'),
});

export const drivers = pgTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
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
}, t => ({ orgIdx: index('drivers_org_idx').on(t.orgId) }));

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  depotId: uuid('depot_id').notNull().references(() => depots.id),
  date: text('date').notNull(), // YYYY-MM-DD
  status: planStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, t => ({
  orgIdx: index('plans_org_idx').on(t.orgId),
  dateIdx: index('plans_date_idx').on(t.date),
}));

export const routes = pgTable('routes', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  status: routeStatusEnum('status').notNull().default('pending'),
  stopOrder: jsonb('stop_order').notNull().default('[]'), // string[]
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  estimatedDuration: integer('estimated_duration'), // minutes
  totalDistance: real('total_distance'), // km
  deletedAt: timestamp('deleted_at'),
});

export const stops = pgTable('stops', {
  id: uuid('id').primaryKey().defaultRandom(),
  routeId: uuid('route_id').notNull().references(() => routes.id),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  // recipient
  recipientName: text('recipient_name').notNull(),
  recipientPhone: varchar('recipient_phone', { length: 20 }).notNull(),
  address: text('address').notNull(),
  unit: text('unit'),
  deliveryNotes: text('delivery_notes'),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  // rx
  rxNumbers: jsonb('rx_numbers').notNull().default('[]'),
  packageCount: integer('package_count').notNull().default(1),
  requiresRefrigeration: boolean('requires_refrigeration').notNull().default(false),
  controlledSubstance: boolean('controlled_substance').notNull().default(false),
  codAmount: integer('cod_amount'), // cents
  // requirements
  requiresSignature: boolean('requires_signature').notNull().default(true),
  requiresPhoto: boolean('requires_photo').notNull().default(false),
  requiresAgeVerification: boolean('requires_age_verification').notNull().default(false),
  // window
  windowStart: timestamp('window_start'),
  windowEnd: timestamp('window_end'),
  // status
  status: stopStatusEnum('status').notNull().default('pending'),
  failureReason: text('failure_reason'),
  failureNote: text('failure_note'),
  arrivedAt: timestamp('arrived_at'),
  completedAt: timestamp('completed_at'),
  // tracking
  trackingToken: uuid('tracking_token').notNull().defaultRandom().unique(),
  sequenceNumber: integer('sequence_number').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, t => ({
  orgIdx: index('stops_org_idx').on(t.orgId),
  routeIdx: index('stops_route_idx').on(t.routeId),
  tokenIdx: index('stops_token_idx').on(t.trackingToken),
}));

export const proofOfDeliveries = pgTable('proof_of_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  stopId: uuid('stop_id').notNull().references(() => stops.id).unique(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  packageCount: integer('package_count').notNull(),
  signature: jsonb('signature'),    // Signature | null
  photos: jsonb('photos').notNull().default('[]'),         // Photo[]
  ageVerification: jsonb('age_verification'), // AgeVerification | null
  codCollected: jsonb('cod_collected'),       // {amount, method, note} | null
  driverNote: text('driver_note'),
  customerNote: text('customer_note'),
  capturedAt: timestamp('captured_at').notNull().defaultNow(),
});

export const notificationLogs = pgTable('notification_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  stopId: uuid('stop_id').notNull().references(() => stops.id),
  event: text('event').notNull(),
  channel: notifChannelEnum('channel').notNull(),
  recipient: text('recipient').notNull(),
  status: text('status').notNull().default('sent'), // sent | failed
  externalId: text('external_id'), // Twilio SID
  sentAt: timestamp('sent_at').notNull().defaultNow(),
});

export const driverLocationHistory = pgTable('driver_location_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  routeId: uuid('route_id').references(() => routes.id),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  recordedAt: timestamp('recorded_at').notNull().defaultNow(),
}, t => ({ driverIdx: index('location_driver_idx').on(t.driverId) }));
```

- [ ] **Step 4: Push schema to database**

```bash
cd packages/backend
cp ../../.env.example .env   # fill in DATABASE_URL first
npx drizzle-kit push
```

Expected: All tables created in PostgreSQL. No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/db packages/backend/drizzle.config.ts
git commit -m "feat: database schema — orgs, users, drivers, plans, routes, stops, POD"
```

---

## Task 4: Fastify Server + Auth Routes

**Files:**
- Create: `packages/backend/src/index.ts`
- Create: `packages/backend/src/plugins/auth.ts`
- Create: `packages/backend/src/plugins/cors.ts`
- Create: `packages/backend/src/services/auth.ts`
- Create: `packages/backend/src/routes/auth.ts`
- Create: `packages/backend/src/middleware/requireRole.ts`
- Create: `packages/backend/src/middleware/requireOrg.ts`

- [ ] **Step 1: Create Fastify server entry**

```typescript
// packages/backend/src/index.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { authRoutes } from './routes/auth';
import { organizationRoutes } from './routes/organizations';
import { depotRoutes } from './routes/depots';
import { driverRoutes } from './routes/drivers';
import { planRoutes } from './routes/plans';
import { routeRoutes } from './routes/routes';
import { stopRoutes } from './routes/stops';
import { podRoutes } from './routes/pod';
import { trackingRoutes } from './routes/tracking';

const app = Fastify({ logger: true });

await app.register(cors, { origin: process.env.DASHBOARD_URL || true });
await app.register(jwt, {
  secret: process.env.JWT_SECRET!,
  sign: { expiresIn: process.env.JWT_EXPIRES_IN || '15m' },
});
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// Routes
await app.register(authRoutes, { prefix: '/api/v1/auth' });
await app.register(organizationRoutes, { prefix: '/api/v1/orgs' });
await app.register(depotRoutes, { prefix: '/api/v1/orgs/:orgId/depots' });
await app.register(driverRoutes, { prefix: '/api/v1/orgs/:orgId/drivers' });
await app.register(planRoutes, { prefix: '/api/v1/orgs/:orgId/plans' });
await app.register(routeRoutes, { prefix: '/api/v1/plans/:planId/routes' });
await app.register(stopRoutes, { prefix: '/api/v1/routes/:routeId/stops' });
await app.register(podRoutes, { prefix: '/api/v1/stops/:stopId/pod' });
await app.register(trackingRoutes, { prefix: '/api/v1/track' });

app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

try {
  await app.listen({ port: Number(process.env.PORT) || 3001, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 2: Create auth service**

```typescript
// packages/backend/src/services/auth.ts
import bcrypt from 'bcryptjs';
import { db } from '../db/connection';
import { users, drivers } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { JWTPayload } from '@mydash-rx/shared';

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export function signTokens(app: FastifyInstance, payload: Omit<JWTPayload, 'iat' | 'exp'>) {
  const accessToken = app.jwt.sign(payload, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
  const refreshToken = app.jwt.sign(
    { sub: payload.sub, type: 'refresh' },
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '90d' }
  );
  return { accessToken, refreshToken };
}

export async function findUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user ?? null;
}
```

- [ ] **Step 3: Create requireRole middleware**

```typescript
// packages/backend/src/middleware/requireRole.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@mydash-rx/shared';

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const payload = req.user as { role: Role };
    if (!roles.includes(payload.role)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  };
}
```

- [ ] **Step 4: Create requireOrg middleware**

```typescript
// packages/backend/src/middleware/requireOrg.ts
import type { FastifyRequest, FastifyReply } from 'fastify';

export async function requireOrg(req: FastifyRequest, reply: FastifyReply) {
  const payload = req.user as { orgId: string };
  const params = req.params as { orgId?: string };
  if (params.orgId && params.orgId !== payload.orgId && payload.role !== 'super_admin') {
    return reply.code(403).send({ error: 'Access denied to this organization' });
  }
}
```

- [ ] **Step 5: Create auth routes**

```typescript
// packages/backend/src/routes/auth.ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { findUserByEmail, verifyPassword, signTokens } from '../services/auth';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', async (req, reply) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId,
      depotIds: user.depotIds as string[],
    };
    const tokens = signTokens(app, payload);
    return reply.send({ ...tokens, user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.orgId } });
  });

  app.post('/refresh', async (req, reply) => {
    const { refreshToken } = req.body as { refreshToken: string };
    try {
      const decoded = app.jwt.verify<{ sub: string; type: string }>(refreshToken);
      if (decoded.type !== 'refresh') throw new Error('wrong token type');
      const [user] = await app.db.select().from(app.db.schema.users).where(eq(app.db.schema.users.id, decoded.sub)).limit(1);
      if (!user) return reply.code(401).send({ error: 'User not found' });
      const tokens = signTokens(app, { sub: user.id, email: user.email, role: user.role, orgId: user.orgId, depotIds: user.depotIds as string[] });
      return reply.send(tokens);
    } catch {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }
  });
};
```

- [ ] **Step 6: Test auth endpoint**

```bash
cd packages/backend && npm run dev &
# wait for server to start, then:
curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"wrongpass"}' | jq
```

Expected: `{"error":"Invalid credentials"}` with 401 status.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src
git commit -m "feat: Fastify server, auth routes, JWT middleware, RBAC"
```

---

## Task 5: Core CRUD Routes (Orgs, Depots, Drivers, Plans, Stops)

**Files:**
- Create: `packages/backend/src/routes/organizations.ts`
- Create: `packages/backend/src/routes/depots.ts`
- Create: `packages/backend/src/routes/drivers.ts`
- Create: `packages/backend/src/routes/plans.ts`
- Create: `packages/backend/src/routes/routes.ts`
- Create: `packages/backend/src/routes/stops.ts`

- [ ] **Step 1: Create organizations routes**

```typescript
// packages/backend/src/routes/organizations.ts
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection';
import { organizations } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole';

export const organizationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: requireRole('super_admin') }, async () => {
    return db.select().from(organizations).where(isNull(organizations.deletedAt));
  });

  app.get('/:orgId', { preHandler: requireRole('super_admin', 'pharmacy_admin', 'dispatcher') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const user = req.user as { orgId: string; role: string };
    if (user.role !== 'super_admin' && user.orgId !== orgId) return reply.code(403).send({ error: 'Forbidden' });
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (!org) return reply.code(404).send({ error: 'Not found' });
    return org;
  });

  app.post('/', { preHandler: requireRole('super_admin') }, async (req, reply) => {
    const body = req.body as { name: string; timezone?: string };
    const [org] = await db.insert(organizations).values({ name: body.name, timezone: body.timezone ?? 'America/New_York' }).returning();
    return reply.code(201).send(org);
  });
};
```

- [ ] **Step 2: Create depots routes**

```typescript
// packages/backend/src/routes/depots.ts
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection';
import { depots } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole';

export const depotRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: requireRole('pharmacy_admin', 'dispatcher', 'super_admin') }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    return db.select().from(depots).where(and(eq(depots.orgId, orgId), isNull(depots.deletedAt)));
  });

  app.post('/', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as { name: string; address: string; lat: number; lng: number; phone?: string };
    const [depot] = await db.insert(depots).values({ ...body, orgId }).returning();
    return reply.code(201).send(depot);
  });

  app.put('/:depotId', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { depotId } = req.params as { orgId: string; depotId: string };
    const body = req.body as Partial<{ name: string; address: string; lat: number; lng: number; phone: string }>;
    const [updated] = await db.update(depots).set(body).where(eq(depots.id, depotId)).returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });
};
```

- [ ] **Step 3: Create drivers routes**

```typescript
// packages/backend/src/routes/drivers.ts
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection';
import { drivers } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole';
import { hashPassword } from '../services/auth';

export const driverRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: requireRole('pharmacy_admin', 'dispatcher', 'super_admin') }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    return db.select({
      id: drivers.id, orgId: drivers.orgId, name: drivers.name,
      email: drivers.email, phone: drivers.phone, drugCapable: drivers.drugCapable,
      vehicleType: drivers.vehicleType, status: drivers.status,
      currentLat: drivers.currentLat, currentLng: drivers.currentLng, lastPingAt: drivers.lastPingAt,
    }).from(drivers).where(and(eq(drivers.orgId, orgId), isNull(drivers.deletedAt)));
  });

  app.post('/', { preHandler: requireRole('pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = req.body as { name: string; email: string; phone: string; password: string; drugCapable?: boolean; vehicleType?: string };
    const passwordHash = await hashPassword(body.password);
    const [driver] = await db.insert(drivers).values({
      orgId, name: body.name, email: body.email, phone: body.phone,
      passwordHash, drugCapable: body.drugCapable ?? false,
      vehicleType: (body.vehicleType as any) ?? 'car',
    }).returning();
    const { passwordHash: _, ...safe } = driver;
    return reply.code(201).send(safe);
  });

  // Driver GPS ping — called by mobile app
  app.post('/:driverId/ping', { preHandler: requireRole('driver') }, async (req, reply) => {
    const { driverId } = req.params as { orgId: string; driverId: string };
    const { lat, lng } = req.body as { lat: number; lng: number };
    await db.update(drivers).set({ currentLat: lat, currentLng: lng, lastPingAt: new Date() }).where(eq(drivers.id, driverId));
    return { ok: true };
  });
};
```

- [ ] **Step 4: Create plans routes**

```typescript
// packages/backend/src/routes/plans.ts
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection';
import { plans, routes, stops } from '../db/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole';

export const planRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: requireRole('pharmacy_admin', 'dispatcher', 'super_admin') }, async (req) => {
    const { orgId } = req.params as { orgId: string };
    const { date } = req.query as { date?: string };
    const conditions = [eq(plans.orgId, orgId), isNull(plans.deletedAt)];
    if (date) conditions.push(eq(plans.date, date));
    return db.select().from(plans).where(and(...conditions)).orderBy(plans.date);
  });

  app.post('/', { preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { depotId, date } = req.body as { depotId: string; date: string };
    const [plan] = await db.insert(plans).values({ orgId, depotId, date }).returning();
    return reply.code(201).send(plan);
  });

  app.get('/:planId', { preHandler: requireRole('pharmacy_admin', 'dispatcher', 'super_admin') }, async (req, reply) => {
    const { planId } = req.params as { orgId: string; planId: string };
    const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (!plan) return reply.code(404).send({ error: 'Not found' });
    const planRoutes = await db.select().from(routes).where(eq(routes.planId, planId));
    return { ...plan, routes: planRoutes };
  });

  app.patch('/:planId/distribute', { preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { planId } = req.params as { orgId: string; planId: string };
    const [updated] = await db.update(plans).set({ status: 'distributed' }).where(eq(plans.id, planId)).returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    return updated;
  });
};
```

- [ ] **Step 5: Create stops routes**

```typescript
// packages/backend/src/routes/stops.ts
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection';
import { stops, routes } from '../db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole';
import { sendStopNotification } from '../services/notifications';
import type { StopStatus } from '@mydash-rx/shared';

export const stopRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: requireRole('dispatcher', 'pharmacy_admin', 'driver', 'super_admin') }, async (req) => {
    const { routeId } = req.params as { routeId: string };
    return db.select().from(stops).where(and(eq(stops.routeId, routeId), isNull(stops.deletedAt))).orderBy(stops.sequenceNumber);
  });

  app.post('/', { preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { routeId } = req.params as { routeId: string };
    const [route] = await db.select().from(routes).where(eq(routes.id, routeId)).limit(1);
    if (!route) return reply.code(404).send({ error: 'Route not found' });
    const body = req.body as any;
    const [stop] = await db.insert(stops).values({ ...body, routeId, orgId: body.orgId }).returning();
    return reply.code(201).send(stop);
  });

  app.patch('/:stopId/status', { preHandler: requireRole('driver', 'dispatcher', 'super_admin') }, async (req, reply) => {
    const { stopId } = req.params as { routeId: string; stopId: string };
    const { status, failureReason, failureNote } = req.body as {
      status: StopStatus; failureReason?: string; failureNote?: string
    };
    const now = new Date();
    const updates: Record<string, any> = { status };
    if (status === 'arrived') updates.arrivedAt = now;
    if (status === 'completed') updates.completedAt = now;
    if (failureReason) updates.failureReason = failureReason;
    if (failureNote) updates.failureNote = failureNote;
    const [updated] = await db.update(stops).set(updates).where(eq(stops.id, stopId)).returning();
    if (!updated) return reply.code(404).send({ error: 'Not found' });
    // Fire notification async
    sendStopNotification(updated, status).catch(console.error);
    return updated;
  });
};
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/routes
git commit -m "feat: CRUD routes for orgs, depots, drivers, plans, routes, stops"
```

---

## Task 6: Route Optimization Service

**Files:**
- Create: `packages/backend/src/services/routeOptimizer.ts`
- Create: `packages/backend/src/services/geocoder.ts`
- Modify: `packages/backend/src/routes/plans.ts` (add optimize endpoint)

- [ ] **Step 1: Create geocoder service**

```typescript
// packages/backend/src/services/geocoder.ts
interface GeoResult { lat: number; lng: number; formattedAddress: string }

export async function geocode(address: string): Promise<GeoResult | null> {
  const params = new URLSearchParams({ address, key: process.env.GOOGLE_MAPS_API_KEY! });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  const data = await res.json() as any;
  if (data.status !== 'OK' || !data.results[0]) return null;
  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng, formattedAddress: data.results[0].formatted_address };
}
```

- [ ] **Step 2: Create route optimizer service**

```typescript
// packages/backend/src/services/routeOptimizer.ts
import type { Stop } from '@mydash-rx/shared';

interface OptimizedRoute {
  stopIds: string[];       // ordered
  totalDistance: number;   // km
  totalDuration: number;   // minutes
  legs: { distanceKm: number; durationMin: number }[];
}

export async function optimizeRoute(
  originLat: number,
  originLng: number,
  stops: Pick<Stop, 'id' | 'lat' | 'lng'>[]
): Promise<OptimizedRoute> {
  if (stops.length === 0) return { stopIds: [], totalDistance: 0, totalDuration: 0, legs: [] };

  const waypoints = stops.map(s => `${s.lat},${s.lng}`).join('|');
  const params = new URLSearchParams({
    origin: `${originLat},${originLng}`,
    destination: `${stops[stops.length - 1].lat},${stops[stops.length - 1].lng}`,
    waypoints: stops.length > 1 ? `optimize:true|${stops.slice(0, -1).map(s => `${s.lat},${s.lng}`).join('|')}` : '',
    key: process.env.GOOGLE_MAPS_API_KEY!,
    departure_time: 'now',
  });

  const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params}`);
  const data = await res.json() as any;

  if (data.status !== 'OK') throw new Error(`Google Maps error: ${data.status}`);

  const route = data.routes[0];
  const waypointOrder: number[] = route.waypoint_order ?? [];

  // Map optimized order back to stop IDs
  const orderedStops = waypointOrder.length > 0
    ? [...waypointOrder.map((i: number) => stops[i]), stops[stops.length - 1]]
    : stops;

  const legs = route.legs.map((leg: any) => ({
    distanceKm: leg.distance.value / 1000,
    durationMin: Math.ceil(leg.duration_in_traffic?.value ?? leg.duration.value / 60),
  }));

  return {
    stopIds: orderedStops.map(s => s.id),
    totalDistance: legs.reduce((sum: number, l: any) => sum + l.distanceKm, 0),
    totalDuration: legs.reduce((sum: number, l: any) => sum + l.durationMin, 0),
    legs,
  };
}
```

- [ ] **Step 3: Add optimize endpoint to plans routes**

Add to `packages/backend/src/routes/plans.ts`:

```typescript
  app.post('/:planId/optimize', { preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { planId } = req.params as { orgId: string; planId: string };

    // Get all routes + stops for this plan
    const planRoutes = await db.select().from(routes).where(eq(routes.planId, planId));
    const depot = await db.select().from(depots).where(
      eq(depots.id, (await db.select({ depotId: plans.depotId }).from(plans).where(eq(plans.id, planId)).limit(1))[0].depotId)
    ).limit(1).then(r => r[0]);

    const results = await Promise.all(planRoutes.map(async route => {
      const routeStops = await db.select().from(stops).where(and(eq(stops.routeId, route.id), isNull(stops.deletedAt)));
      if (routeStops.length === 0) return route;
      const optimized = await optimizeRoute(depot.lat, depot.lng, routeStops);
      await db.update(routes).set({
        stopOrder: optimized.stopIds,
        estimatedDuration: optimized.totalDuration,
        totalDistance: optimized.totalDistance,
      }).where(eq(routes.id, route.id));
      // Update sequence numbers
      await Promise.all(optimized.stopIds.map((stopId, i) =>
        db.update(stops).set({ sequenceNumber: i }).where(eq(stops.id, stopId))
      ));
      return { ...route, stopOrder: optimized.stopIds, estimatedDuration: optimized.totalDuration };
    }));

    await db.update(plans).set({ status: 'optimized' }).where(eq(plans.id, planId));
    return { planId, routes: results };
  });
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/routeOptimizer.ts packages/backend/src/services/geocoder.ts packages/backend/src/routes/plans.ts
git commit -m "feat: Google Maps route optimization + geocoder service"
```

---

## Task 7: Proof of Delivery + Storage

**Files:**
- Create: `packages/backend/src/services/storage.ts`
- Create: `packages/backend/src/routes/pod.ts`

- [ ] **Step 1: Create R2 storage service**

```typescript
// packages/backend/src/services/storage.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function uploadBuffer(buffer: Buffer, mimeType: string, folder = 'pod'): Promise<{ key: string; url: string }> {
  const key = `${folder}/${randomUUID()}.${mimeType === 'image/jpeg' ? 'jpg' : 'png'}`;
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }));
  const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }), { expiresIn: 3600 * 24 * 7 });
  return { key, url };
}

export async function getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }), { expiresIn: expiresInSeconds });
}
```

- [ ] **Step 2: Create POD routes**

```typescript
// packages/backend/src/routes/pod.ts
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection';
import { proofOfDeliveries, stops } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '../middleware/requireRole';
import { uploadBuffer } from '../services/storage';

export const podRoutes: FastifyPluginAsync = async (app) => {
  app.post('/', { preHandler: requireRole('driver') }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const user = req.user as { sub: string };

    const body = req.body as {
      packageCount: number;
      signature?: { svgData: string; signerName: string; lat: number; lng: number };
      ageVerification?: { verified: boolean; idType?: string; idLastFour?: string; dobConfirmed: boolean };
      codCollected?: { amount: number; method: string; note?: string };
      driverNote?: string;
      customerNote?: string;
    };

    const [pod] = await db.insert(proofOfDeliveries).values({
      stopId,
      driverId: user.sub,
      packageCount: body.packageCount,
      signature: body.signature ? { ...body.signature, capturedAt: new Date().toISOString() } : null,
      photos: [],
      ageVerification: body.ageVerification ?? null,
      codCollected: body.codCollected ?? null,
      driverNote: body.driverNote,
      customerNote: body.customerNote,
    }).returning();

    // Mark stop completed
    await db.update(stops).set({ status: 'completed', completedAt: new Date() }).where(eq(stops.id, stopId));

    return reply.code(201).send(pod);
  });

  // Upload photo to POD
  app.post('/photo', { preHandler: requireRole('driver') }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    const buffer = await data.toBuffer();
    const { key, url } = await uploadBuffer(buffer, data.mimetype, `pod/${stopId}`);

    // Append photo to existing POD record
    const [existing] = await db.select().from(proofOfDeliveries).where(eq(proofOfDeliveries.stopId, stopId)).limit(1);
    if (existing) {
      const photos = (existing.photos as any[]) ?? [];
      photos.push({ key, url, capturedAt: new Date().toISOString() });
      await db.update(proofOfDeliveries).set({ photos }).where(eq(proofOfDeliveries.stopId, stopId));
    }

    return { key, url };
  });

  app.get('/', { preHandler: requireRole('dispatcher', 'pharmacy_admin', 'super_admin') }, async (req, reply) => {
    const { stopId } = req.params as { stopId: string };
    const [pod] = await db.select().from(proofOfDeliveries).where(eq(proofOfDeliveries.stopId, stopId)).limit(1);
    if (!pod) return reply.code(404).send({ error: 'No POD found' });
    return pod;
  });
};
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/storage.ts packages/backend/src/routes/pod.ts
git commit -m "feat: proof of delivery routes + Cloudflare R2 photo storage"
```

---

## Task 8: Twilio SMS Notifications + Tracking Route

**Files:**
- Create: `packages/backend/src/services/notifications.ts`
- Create: `packages/backend/src/services/trackingToken.ts`
- Create: `packages/backend/src/routes/tracking.ts`

- [ ] **Step 1: Create Twilio notification service**

```typescript
// packages/backend/src/services/notifications.ts
import twilio from 'twilio';
import type { Stop } from '@mydash-rx/shared';
import { db } from '../db/connection';
import { notificationLogs, organizations } from '../db/schema';
import { eq } from 'drizzle-orm';

const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

const SMS_TEMPLATES: Record<string, (data: any) => string> = {
  route_dispatched: d => `Your prescription from ${d.pharmacyName} is out for delivery today. Track: ${d.trackingUrl}`,
  stop_approaching: d => `Your delivery is ${d.stopsAway} stops away (~${d.etaMin} min). Track: ${d.trackingUrl}`,
  stop_arrived: d => `${d.driverName} from ${d.pharmacyName} has arrived at your address.`,
  stop_completed: d => `Your prescription has been delivered. Questions? Call ${d.pharmacyPhone}`,
  stop_failed: d => `We couldn't complete your delivery. Please call ${d.pharmacyPhone} to reschedule.`,
  eta_updated: d => `Your delivery ETA updated to ~${d.etaMin} min. Track: ${d.trackingUrl}`,
};

export async function sendStopNotification(
  stop: typeof stops.$inferSelect,
  event: string,
  extra: Record<string, any> = {}
) {
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, stop.orgId)).limit(1);
  const template = SMS_TEMPLATES[event];
  if (!template || !stop.recipientPhone) return;

  const body = template({
    pharmacyName: org.name,
    pharmacyPhone: 'your pharmacy',
    driverName: 'Your driver',
    trackingUrl: `${process.env.DASHBOARD_URL || 'https://app.mydashrx.com'}/track/${stop.trackingToken}`,
    ...extra,
  });

  try {
    const msg = await client.messages.create({
      body,
      from: process.env.TWILIO_FROM_NUMBER!,
      to: stop.recipientPhone,
    });
    await db.insert(notificationLogs).values({
      stopId: stop.id, event, channel: 'sms',
      recipient: stop.recipientPhone, status: 'sent', externalId: msg.sid,
    });
  } catch (err) {
    await db.insert(notificationLogs).values({
      stopId: stop.id, event, channel: 'sms',
      recipient: stop.recipientPhone, status: 'failed',
    });
    console.error('SMS failed:', err);
  }
}
```

- [ ] **Step 2: Create tracking route (public, no auth)**

```typescript
// packages/backend/src/routes/tracking.ts
import type { FastifyPluginAsync } from 'fastify';
import { db } from '../db/connection';
import { stops, routes, drivers, plans } from '../db/schema';
import { eq } from 'drizzle-orm';

export const trackingRoutes: FastifyPluginAsync = async (app) => {
  // Public endpoint — no auth, returns only data safe for patient
  app.get('/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const [stop] = await db.select().from(stops).where(eq(stops.trackingToken, token as any)).limit(1);
    if (!stop) return reply.code(404).send({ error: 'Not found' });

    const [route] = await db.select().from(routes).where(eq(routes.id, stop.routeId)).limit(1);
    const [driver] = route
      ? await db.select({ name: drivers.name, currentLat: drivers.currentLat, currentLng: drivers.currentLng, lastPingAt: drivers.lastPingAt })
          .from(drivers).where(eq(drivers.id, route.driverId)).limit(1)
      : [null];

    // Count stops ahead in route
    const stopsAhead = route
      ? (route.stopOrder as string[]).indexOf(stop.id)
      : 0;

    return {
      stopId: stop.id,
      status: stop.status,
      address: stop.address,
      recipientName: stop.recipientName.split(' ')[0], // first name only
      stopsAhead: Math.max(0, stopsAhead),
      windowStart: stop.windowStart,
      windowEnd: stop.windowEnd,
      completedAt: stop.completedAt,
      // Only share driver location when within 2 stops
      driverLocation: stopsAhead <= 2 && driver ? { lat: driver.currentLat, lng: driver.currentLng, lastPingAt: driver.lastPingAt } : null,
      pharmacyPhone: null, // filled from org on frontend
    };
  });
};
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/notifications.ts packages/backend/src/routes/tracking.ts
git commit -m "feat: Twilio SMS notifications + public patient tracking endpoint"
```

---

## Task 9: Next.js Dashboard — Layout + Auth

**Files:**
- Create: `packages/dashboard/src/app/layout.tsx`
- Create: `packages/dashboard/src/app/login/page.tsx`
- Create: `packages/dashboard/src/app/dashboard/layout.tsx`
- Create: `packages/dashboard/src/lib/api.ts`
- Create: `packages/dashboard/src/lib/auth.ts`
- Create: `packages/dashboard/next.config.ts`
- Create: `packages/dashboard/tailwind.config.ts`

- [ ] **Step 1: Create next.config.ts**

```typescript
// packages/dashboard/next.config.ts
import type { NextConfig } from 'next';
const config: NextConfig = {
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: 'https', hostname: '**.r2.cloudflarestorage.com' }] },
};
export default config;
```

- [ ] **Step 2: Create tailwind.config.ts**

```typescript
// packages/dashboard/tailwind.config.ts
import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#0F4C81', 50: '#e8f0f9', 900: '#082d4d' },
        teal: { DEFAULT: '#00B8A9', 50: '#e0f7f5' },
        amber: { DEFAULT: '#F6A623' },
        coral: { DEFAULT: '#E84855' },
        emerald: { DEFAULT: '#2ECC71' },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        heading: ['Sora', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3: Create root layout**

```tsx
// packages/dashboard/src/app/layout.tsx
import type { Metadata } from 'next';
import { Inter, Sora } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const sora = Sora({ subsets: ['latin'], variable: '--font-sora' });

export const metadata: Metadata = {
  title: 'MyDashRx — Pharmacy Delivery Management',
  description: 'AI-powered delivery dispatch for independent pharmacies',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable}`}>
      <body className="bg-[#F7F8FC] text-gray-900 font-sans antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Create API client**

```typescript
// packages/dashboard/src/lib/api.ts
const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
```

- [ ] **Step 5: Create auth helpers**

```typescript
// packages/dashboard/src/lib/auth.ts
import type { User } from '@mydash-rx/shared';

export function getUser(): User | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

export function setSession(tokens: { accessToken: string; refreshToken: string; user: User }) {
  localStorage.setItem('accessToken', tokens.accessToken);
  localStorage.setItem('refreshToken', tokens.refreshToken);
  localStorage.setItem('user', JSON.stringify(tokens.user));
}

export function clearSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}

export function isAuthenticated(): boolean {
  return !!getUser();
}
```

- [ ] **Step 6: Create login page**

```tsx
// packages/dashboard/src/app/login/page.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth';
import type { AuthTokens } from '@mydash-rx/shared';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const tokens = await api.post<AuthTokens>('/auth/login', { email, password });
      setSession(tokens);
      router.replace('/dashboard');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FC]">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h1 className="font-heading text-2xl font-bold text-primary mb-1">MyDashRx</h1>
        <p className="text-gray-500 text-sm mb-8">Pharmacy Delivery Management</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              required autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              required
            />
          </div>
          {error && <p className="text-coral text-sm">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full bg-primary text-white rounded-lg py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create dashboard layout with sidebar**

```tsx
// packages/dashboard/src/app/dashboard/layout.tsx
'use client';
import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { isAuthenticated, clearSession } from '@/lib/auth';
import { LayoutDashboard, Route, Package, Users, LogOut } from 'lucide-react';

const nav = [
  { href: '/dashboard', label: 'Command Center', icon: LayoutDashboard },
  { href: '/dashboard/plans', label: 'Route Plans', icon: Route },
  { href: '/dashboard/stops', label: 'Stops', icon: Package },
  { href: '/dashboard/drivers', label: 'Drivers', icon: Users },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isAuthenticated()) router.replace('/login');
  }, [router]);

  return (
    <div className="flex h-screen bg-[#F7F8FC]">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-100 flex flex-col py-6">
        <div className="px-5 mb-8">
          <span className="font-heading font-bold text-primary text-lg">MyDashRx</span>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname === href ? 'bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-3">
          <button onClick={() => { clearSession(); router.replace('/login'); }}
            className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors">
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      {/* Main */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add packages/dashboard/src packages/dashboard/next.config.ts packages/dashboard/tailwind.config.ts
git commit -m "feat: Next.js dashboard — layout, auth, login page, API client"
```

---

## Task 10: Command Center Dashboard Page

**Files:**
- Create: `packages/dashboard/src/app/dashboard/page.tsx`
- Create: `packages/dashboard/src/components/RouteCard.tsx`
- Create: `packages/dashboard/src/components/LiveMap.tsx`

- [ ] **Step 1: Create RouteCard component**

```tsx
// packages/dashboard/src/components/RouteCard.tsx
import type { Route, Driver } from '@mydash-rx/shared';

interface Props { route: Route & { driver?: Driver; completedCount: number } }

export function RouteCard({ route }: Props) {
  const pct = route.stopOrder.length > 0
    ? Math.round((route.completedCount / route.stopOrder.length) * 100)
    : 0;

  const statusColors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    active: 'bg-teal/10 text-teal',
    completed: 'bg-emerald/10 text-emerald',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
            {route.driver?.name?.[0] ?? '?'}
          </div>
          <div>
            <div className="text-sm font-medium text-gray-900">{route.driver?.name ?? 'Unassigned'}</div>
            <div className="text-xs text-gray-400">{route.stopOrder.length} stops · {route.estimatedDuration ?? '--'} min</div>
          </div>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[route.status]}`}>
          {route.status}
        </span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div className="bg-teal rounded-full h-1.5 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-gray-400">{route.completedCount} / {route.stopOrder.length} completed</div>
    </div>
  );
}
```

- [ ] **Step 2: Create Command Center page**

```tsx
// packages/dashboard/src/app/dashboard/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { RouteCard } from '@/components/RouteCard';
import type { Plan, Route, Driver } from '@mydash-rx/shared';
import { Package, Truck, CheckCircle, AlertCircle } from 'lucide-react';

interface DashboardStats {
  totalStops: number;
  completedStops: number;
  activeDrivers: number;
  failedStops: number;
}

export default function CommandCenter() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [routes, setRoutes] = useState<(Route & { driver?: Driver; completedCount: number })[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ totalStops: 0, completedStops: 0, activeDrivers: 0, failedStops: 0 });
  const [loading, setLoading] = useState(true);

  const user = getUser();
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      try {
        const todayPlans = await api.get<Plan[]>(`/orgs/${user.orgId}/plans?date=${today}`);
        setPlans(todayPlans);
        // TODO: fetch routes + stats per plan
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, today]);

  const kpis = [
    { label: 'Total Stops', value: stats.totalStops, icon: Package, color: 'text-primary' },
    { label: 'Active Drivers', value: stats.activeDrivers, icon: Truck, color: 'text-teal' },
    { label: 'Completed', value: stats.completedStops, icon: CheckCircle, color: 'text-emerald' },
    { label: 'Failed', value: stats.failedStops, icon: AlertCircle, color: 'text-coral' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-bold text-gray-900">Command Center</h1>
        <p className="text-gray-500 text-sm mt-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={16} className={color} />
              <span className="text-xs text-gray-500">{label}</span>
            </div>
            <div className={`text-2xl font-bold font-heading ${color}`}>{loading ? '—' : value}</div>
          </div>
        ))}
      </div>

      {/* Routes */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Today's Routes</h2>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
          </div>
        ) : routes.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
            <p className="text-gray-400 text-sm">No routes planned for today.</p>
            <a href="/dashboard/plans/new" className="text-primary text-sm font-medium hover:underline mt-1 block">Create a plan →</a>
          </div>
        ) : (
          <div className="space-y-3">
            {routes.map(r => <RouteCard key={r.id} route={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/app/dashboard/page.tsx packages/dashboard/src/components/RouteCard.tsx
git commit -m "feat: command center dashboard with KPI cards and route list"
```

---

## Task 11: Patient Tracking Page

**Files:**
- Create: `packages/dashboard/src/app/track/[token]/page.tsx`

- [ ] **Step 1: Create tracking page**

```tsx
// packages/dashboard/src/app/track/[token]/page.tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

interface TrackingData {
  stopId: string;
  status: string;
  address: string;
  recipientName: string;
  stopsAhead: number;
  windowStart?: string;
  windowEnd?: string;
  completedAt?: string;
  driverLocation?: { lat: number; lng: number; lastPingAt: string } | null;
}

async function getTrackingData(token: string): Promise<TrackingData | null> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/track/${token}`, {
    next: { revalidate: 30 },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  return { title: 'Track Your Delivery — MyDashRx' };
}

const STATUS_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  pending:   { label: 'Preparing', color: 'bg-gray-100 text-gray-600', desc: 'Your order is being prepared for dispatch.' },
  en_route:  { label: 'On the way', color: 'bg-teal-50 text-teal-700', desc: 'Your driver is heading toward your stop.' },
  arrived:   { label: 'Arrived', color: 'bg-blue-50 text-blue-700', desc: 'Your driver has arrived at your address.' },
  completed: { label: 'Delivered', color: 'bg-green-50 text-green-700', desc: 'Your prescription has been delivered.' },
  failed:    { label: 'Attempted', color: 'bg-red-50 text-red-700', desc: 'We attempted delivery but could not complete it.' },
};

export default async function TrackingPage({ params }: { params: { token: string } }) {
  const data = await getTrackingData(params.token);
  if (!data) notFound();

  const info = STATUS_LABELS[data.status] ?? STATUS_LABELS.pending;

  return (
    <div className="min-h-screen bg-[#F7F8FC] flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="font-heading font-bold text-2xl text-[#0F4C81]">MyDashRx</h1>
          <p className="text-gray-500 text-sm mt-1">Prescription Delivery Tracker</p>
        </div>

        {/* Status Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-500">Hi, {data.recipientName}</span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${info.color}`}>{info.label}</span>
          </div>
          <p className="text-sm text-gray-700 mb-4">{info.desc}</p>
          <div className="border-t border-gray-50 pt-3">
            <p className="text-xs text-gray-400">Delivering to</p>
            <p className="text-sm font-medium text-gray-800 mt-0.5">{data.address}</p>
          </div>
          {data.stopsAhead > 0 && data.status === 'en_route' && (
            <div className="mt-3 bg-teal-50 rounded-lg px-3 py-2">
              <p className="text-sm text-teal-700 font-medium">
                {data.stopsAhead === 1 ? 'You\'re next!' : `${data.stopsAhead} stops ahead of you`}
              </p>
            </div>
          )}
          {data.completedAt && (
            <div className="mt-3 text-xs text-gray-400">
              Delivered at {new Date(data.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>

        {/* Questions */}
        <p className="text-center text-xs text-gray-400">
          Questions about your delivery? Call your pharmacy.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/dashboard/src/app/track
git commit -m "feat: public patient tracking page with delivery status"
```

---

## Task 12: End-to-End Smoke Test

- [ ] **Step 1: Start all services**

```bash
cd F:/CLAUDE/mydash-rx
docker-compose up -d            # start postgres + redis
cd packages/backend && npm run dev &
cd packages/dashboard && npm run dev &
```

- [ ] **Step 2: Seed a test org + user**

```bash
# Run seed script (create manually or via psql)
cd packages/backend
node -e "
const { db } = require('./src/db/connection');
const { organizations, users } = require('./src/db/schema');
const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('password123', 12);
db.insert(organizations).values({ name: 'Test Pharmacy', timezone: 'America/New_York' })
  .returning().then(([org]) => {
    return db.insert(users).values({ orgId: org.id, email: 'admin@test.com', passwordHash: hash, name: 'Admin User', role: 'pharmacy_admin', depotIds: [] });
  }).then(() => { console.log('Seeded!'); process.exit(0); });
"
```

- [ ] **Step 3: Login via API**

```bash
curl -s -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}' | jq '.accessToken'
```

Expected: JWT string returned.

- [ ] **Step 4: Open dashboard in browser**

Navigate to `http://localhost:3000/login`, sign in with `admin@test.com` / `password123`.

Expected: Redirected to `/dashboard`, command center loads, KPI cards show zeros (no data yet).

- [ ] **Step 5: Test tracking page**

```bash
# Insert a test stop with a known tracking token
TOKEN=$(node -e "console.log(require('crypto').randomUUID())")
# Insert via psql or drizzle, then:
curl http://localhost:3000/track/$TOKEN
```

Expected: Tracking page renders with "Preparing" status.

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat: Phase 1 MVP complete — backend API + dispatcher dashboard + patient tracking"
```

---

## Phase 1 Definition of Done

- [ ] Pharmacy admin can log in and view the command center
- [ ] Dispatcher can create a plan, add stops, and trigger route optimization
- [ ] Route optimization calls Google Maps and reorders stops
- [ ] Driver GPS ping endpoint accepts location updates
- [ ] POD capture (signature + photo) works end-to-end
- [ ] Patient receives SMS notification on stop status change
- [ ] Patient tracking page renders correct status from public token
- [ ] All table migrations run cleanly on a fresh database

---

*Next plans: Phase 2 (Pharmacy Portal + Compliance + Spoke Migration) · Phase 3 (AI Layer)*
