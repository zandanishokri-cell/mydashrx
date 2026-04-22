import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

// ssl:'require' needed when DATABASE_URL is an external host (Render external URL, local dev with remote DB).
// Internal Render URLs (dpg-*-a.oregon-postgres.render.com without sslmode) also need SSL.
const url = process.env.DATABASE_URL!;

// max: 30 connections (was 10). The admin dashboard fires ~20-30 concurrent requests when a user
// navigates through sidebar pages quickly (each page runs 3-10 queries). A pool of 10 meant later
// queries waited past Render's 60s proxy timeout and cascaded into 502 Bad Gateway errors. Render
// Starter Postgres allows ~97 concurrent connections so 30 keeps ~3x headroom.
//
// statement_timeout: 30s server-side kill for runaway queries — prevents a single slow query from
// pinning a connection and starving the pool. Render proxy gives up at 60s, so 30s leaves time to
// return a 503 cleanly instead of causing a 502.
export const client = postgres(url, {
  max: 30,
  ssl: 'require',
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 1800,
  connection: { statement_timeout: 30_000 },
});
export const db = drizzle(client, { schema });
export type DB = typeof db;
