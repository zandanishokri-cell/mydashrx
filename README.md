# MyDashRx — Pharmacy Delivery Management Platform

> The modern dispatch platform for independent pharmacies. HIPAA-compliant, Michigan-pharmacy-law-ready, and built to replace expensive legacy systems like Spoke and Dispatch.

## What It Is

MyDashRx is a full-stack SaaS platform for pharmacy delivery operations. It covers everything from route dispatch and real-time driver tracking to HIPAA compliance management and pharmacy lead generation.

## Feature Overview

### Core Dispatch
- **Command Center** — Today's KPIs, active plans, driver status at a glance
- **Route Planning** — Create delivery plans, assign drivers, optimize routes (nearest-neighbor TSP)
- **Live Map** — Real-time driver locations, active route sidebar, stale-driver alerts
- **Stop Management** — Individual stop tracking with status updates, notes, and failure reasons

### Driver App
- Mobile-optimized driver interface (responsive, large touch targets)
- Route navigation with stop-by-stop guidance
- Proof of delivery: photo capture, digital signature pad, controlled substance ID verification
- Real-time location updates, ETA calculation, completion celebration

### Pharmacy Portal
- Dedicated pharmacy staff interface for order submission
- Order tracking with status timeline
- Real-time auto-refresh, patient name privacy protection

### Compliance
- **HIPAA Compliance Center** — Audit logs, BAA registry, compliance scoring, CSV export
- **Michigan Compliance Panel** — MAPS reporting tracker, controlled substance ID verification logs, regulatory updates
- Audit trail for all PHI access (who, what, when, from where)

### Lead Finder CRM
- Google Places pharmacy discovery with lead scoring engine
- Kanban pipeline (New → Contacted → Interested → Negotiating → Closed/Lost)
- Email outreach via Resend, outreach history log
- Built-in lead database with search, filters, follow-up reminders

### Analytics
- 7/14/30-day delivery metrics: success rate, failure reasons, driver performance
- Week-over-week comparison, top performing drivers, performance insights
- Driver leaderboard with completion rate rankings

### Automation
- Configurable trigger rules (stop completed, stop failed, driver started route)
- SMS notifications via Twilio, email via Resend
- Pre-built templates: patient delivery confirmation, failed delivery alert, dispatcher notification
- Automation log with per-rule execution history

### Operations
- **Recurring Deliveries** — Weekly/biweekly/monthly patient schedules, auto-generate stops
- **CSV Bulk Import** — Import stops from spreadsheet with geocoding
- **Route Optimization** — One-click nearest-neighbor reordering with ETA estimates

### Administration
- **Settings** — Org config, team management (invite/remove users), depot management
- **Billing** — Plan management, usage tracking, Stripe checkout integration
- **Super-Admin** — Platform-wide stats, org management, plan overrides (super_admin role only)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Backend | Fastify 4, TypeScript, ESM |
| Database | PostgreSQL 17, Drizzle ORM |
| Auth | JWT (HS256), role-based access control |
| Maps | Leaflet (driver tracking), Google Places API (lead discovery, geocoding) |
| SMS | Twilio |
| Email | Resend |
| File Storage | Cloudflare R2 (S3-compatible) |
| Payments | Stripe |
| Hosting | Backend → Render, Frontend → Vercel |
| CI/CD | GitHub Actions |
| Monorepo | Turborepo + npm workspaces |

## Project Structure

```
mydash-rx/
├── packages/
│   ├── backend/          # Fastify API
│   │   └── src/
│   │       ├── db/       # Drizzle schema + seed
│   │       ├── routes/   # All API routes
│   │       ├── services/ # automation, errorMonitor
│   │       └── middleware/
│   ├── dashboard/        # Next.js (all 3 portals + public track page)
│   │   └── src/app/
│   │       ├── dashboard/    # Dispatcher portal
│   │       ├── driver/       # Driver app
│   │       ├── pharmacy/     # Pharmacy portal
│   │       └── track/        # Public delivery tracking
│   ├── marketing/        # Landing page (cartana.life)
│   └── shared/           # Shared TypeScript types
├── render.yaml           # Render deployment config
├── DEPLOY.md             # Step-by-step deployment guide
└── .github/workflows/    # CI/CD pipelines
```

## Quick Start (Local Dev)

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp packages/backend/.env.example packages/backend/.env
# Edit .env with your values (see Environment Variables section)

# 3. Start PostgreSQL (Docker)
docker-compose up -d

# 4. Push database schema
cd packages/backend && npm run db:push

# 5. Seed demo data
npm run db:seed

# 6. Start development servers (from repo root)
npm run dev
# Backend: http://localhost:3001
# Dashboard: http://localhost:3000
# Marketing: http://localhost:3002 (if running)
```

## Demo Credentials

After seeding, log in at `http://localhost:3000/login`:

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@mydashrx.com | Admin123! |
| Pharmacy Admin | pharmacy@demo.com | Demo123! |
| Dispatcher | dispatch@demo.com | Demo123! |
| Driver | driver1@demo.com | Demo123! |
| Driver | driver2@demo.com | Demo123! |

The seed also creates a **Greater Care Pharmacy** org (the original test org):

| Role | Email | Password |
|------|-------|----------|
| Pharmacy Admin | admin@greatercare.com | Password123! |
| Dispatcher | dispatcher@greatercare.com | Password123! |

## Environment Variables

### Backend (`packages/backend/.env`)

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/mydashrx
JWT_SECRET=your-secret-here
PORT=3001
NODE_ENV=development
DASHBOARD_URL=http://localhost:3000

# Communications
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
RESEND_API_KEY=
SENDER_DOMAIN=cartana.life

# File Storage (Cloudflare R2)
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_BUCKET_NAME=

# Google APIs
GOOGLE_PLACES_API_KEY=
GOOGLE_MAPS_API_KEY=

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Optional
SENTRY_DSN=
```

### Frontend (`packages/dashboard/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/auth/login | Login |
| GET | /api/v1/orgs/:orgId/plans | List plans |
| POST | /api/v1/orgs/:orgId/plans | Create plan |
| POST | /api/v1/orgs/:orgId/plans/:planId/optimize | Optimize routes (TSP) |
| PATCH | /api/v1/orgs/:orgId/plans/:planId/distribute | Distribute plan to drivers |
| GET | /api/v1/orgs/:orgId/drivers | List drivers |
| POST | /api/v1/orgs/:orgId/drivers/:driverId/ping | GPS location ping |
| PATCH | /api/v1/routes/:routeId/stops/:stopId/status | Update stop status |
| POST | /api/v1/stops/:stopId/pod | Capture proof of delivery |
| GET | /api/v1/track/:token | Patient tracking (public, no auth) |
| GET | /api/v1/orgs/:orgId/leads | List lead prospects |
| POST | /api/v1/orgs/:orgId/leads/search | Google Places lead search |
| GET | /api/v1/orgs/:orgId/compliance/hipaa | HIPAA compliance summary |
| GET | /api/v1/orgs/:orgId/compliance/michigan | Michigan compliance checklist |
| GET | /api/v1/orgs/:orgId/automation/rules | List automation rules |
| GET | /api/v1/orgs/:orgId/recurring | List recurring deliveries |

## Deployment

See [DEPLOY.md](./DEPLOY.md) for complete deployment steps.

**Quick deploy:**
1. Push to GitHub
2. Render: New Blueprint → connect repo (auto-detects `render.yaml`)
3. Vercel: New Project → root dir: `packages/dashboard`
4. Set env vars on both platforms
5. Run `npm run db:push` via Render shell
6. Run `npm run db:seed` via Render shell

CI/CD auto-deploys on push to `main` via GitHub Actions.

## HIPAA Compliance

MyDashRx is designed for HIPAA compliance:
- All PHI encrypted in transit (TLS) and at rest (PostgreSQL encrypted storage)
- Immutable audit logs for every PHI access
- Role-based access control on every endpoint
- PHI never exposed in URLs, logs, or error messages
- Built-in BAA registry and compliance dashboard
- Michigan pharmacy law compliance (MCL 333.17701, R 338.3162)

**BAAs required before production:** Render, Twilio, Cloudflare R2. See Compliance Center in-app for status tracking.

## Phase Roadmap

| Phase | Status | Scope |
|-------|--------|-------|
| 1 | Complete | Core delivery engine, dispatcher dashboard, patient tracking |
| 2 | Complete | HIPAA compliance portal, Michigan compliance, lead CRM, analytics |
| 3 | Planned | AI dispatch assistant, anomaly detection, weekly intelligence reports |
| 4 | Planned | PMS integrations (QS/1, PioneerRx), voice commands, native mobile apps |

## License

Private — All rights reserved. MyDashRx is proprietary software.
