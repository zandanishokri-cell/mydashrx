import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

// ssl:'require' needed when DATABASE_URL is an external host (Render external URL, local dev with remote DB).
// Internal Render URLs (dpg-*-a.oregon-postgres.render.com without sslmode) also need SSL.
const url = process.env.DATABASE_URL!;
export const client = postgres(url, { max: 10, ssl: 'require' });
export const db = drizzle(client, { schema });
export type DB = typeof db;
