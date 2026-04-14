# MyDashRx

AI-powered pharmacy delivery management platform. Replaces Dispatch.spoke for independent pharmacies.

## Quick Start

### Prerequisites
- Node.js 20+
- Docker Desktop (for local PostgreSQL)

### 1. Clone and install
```bash
npm install
```

### 2. Configure environment
```bash
cp packages/backend/.env.example packages/backend/.env
# Edit packages/backend/.env with your values
# Minimum required for local dev:
# DATABASE_URL=postgresql://postgres:password@localhost:5432/mydash_rx
# JWT_SECRET=any-long-random-string-here
```

### 3. Start the database
```bash
docker-compose up -d
```

### 4. Run database migrations
```bash
cd packages/backend
npm run db:push
```

### 5. Seed test data
```bash
npm run db:seed
```

### 6. Start the servers
```bash
# Terminal 1 — Backend API (port 3001)
cd packages/backend && npm run dev

# Terminal 2 — Dashboard (port 3000)
cd packages/dashboard && npm run dev
```

### 7. Open the app
- Dashboard: http://localhost:3000
- Login: `admin@greatercare.com` / `Password123!`
- API health: http://localhost:3001/health

## Architecture

```
mydash-rx/
├── packages/
│   ├── shared/          TypeScript types (shared between backend + dashboard)
│   ├── backend/         Fastify API (Node.js + PostgreSQL + Drizzle ORM)
│   └── dashboard/       Next.js 14 dispatcher dashboard + patient tracking
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/auth/login | Login |
| GET | /api/v1/orgs/:orgId/plans | List plans |
| POST | /api/v1/orgs/:orgId/plans | Create plan |
| POST | /api/v1/orgs/:orgId/plans/:planId/optimize | Optimize routes |
| PATCH | /api/v1/orgs/:orgId/plans/:planId/distribute | Distribute plan |
| GET | /api/v1/orgs/:orgId/drivers | List drivers |
| POST | /api/v1/orgs/:orgId/drivers/:driverId/ping | GPS ping |
| PATCH | /api/v1/routes/:routeId/stops/:stopId/status | Update stop status |
| POST | /api/v1/stops/:stopId/pod | Capture proof of delivery |
| GET | /api/v1/track/:token | Patient tracking (public) |

## Environment Variables

See `.env.example` for all required variables. Critical ones:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWTs (min 32 chars in prod) |
| `GOOGLE_MAPS_API_KEY` | Required for route optimization |
| `TWILIO_ACCOUNT_SID` | Required for SMS notifications |
| `R2_ACCOUNT_ID` | Required for photo storage (Cloudflare R2) |

## Phase Roadmap

- **Phase 1 (current):** Core delivery engine, dispatcher dashboard, patient tracking
- **Phase 2:** Pharmacy compliance portal, Spoke migration tool, controlled substance logging
- **Phase 3:** AI dispatch assistant, anomaly detection, weekly intelligence reports
- **Phase 4:** PMS integrations (QS/1, PioneerRx), voice commands, native apps
