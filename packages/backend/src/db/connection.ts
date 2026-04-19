import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export const client = postgres(process.env.DATABASE_URL!, {
  max: 10,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
export const db = drizzle(client, { schema });
export type DB = typeof db;
