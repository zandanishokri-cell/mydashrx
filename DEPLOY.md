# Deployment Guide

## Backend → Render

1. Push code to GitHub (create repo if needed):
   git init && git add . && git commit -m "initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/mydashrx
   git push -u origin main

2. Go to render.com → New → Blueprint
   Connect your GitHub repo → Render will detect render.yaml automatically
   Deploy

3. After deploy, set environment variables in Render dashboard:
   JWT_SECRET=<from master.env>
   DASHBOARD_URL=https://mydashrx.vercel.app (update after Vercel deploy)
   GOOGLE_PLACES_API_KEY=<from master.env>
   RESEND_API_KEY=<from master.env>
   SENDER_DOMAIN=cartana.life
   R2_ACCESS_KEY_ID=<from master.env>
   R2_SECRET_ACCESS_KEY=<from master.env>
   R2_ENDPOINT=<from master.env>
   R2_BUCKET_NAME=dashrx
   TWILIO_ACCOUNT_SID=<from master.env>
   TWILIO_AUTH_TOKEN=<from master.env>
   TWILIO_PHONE_NUMBER=<from master.env>

4. Run database migrations:
   In Render → your backend service → Shell:
   npm run db:push

## Frontend → Vercel

1. Go to vercel.com → New Project
   Import your GitHub repo
   Set Root Directory: packages/dashboard

2. Set environment variable:
   NEXT_PUBLIC_API_URL=https://mydashrx-backend.onrender.com/api/v1

3. Deploy

## Domain Setup (cartana.life)
1. In Vercel: Settings → Domains → Add cartana.life
2. In Namecheap DNS, add CNAME record pointing to Vercel

## After Deploy
- Test: visit https://cartana.life/login
- Create first org + admin user via /api/v1/auth/register
- Run compliance check: POST /api/v1/orgs/:orgId/compliance/checks/run
