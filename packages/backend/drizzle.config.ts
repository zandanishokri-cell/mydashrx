import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!,
    ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false,
  },
} satisfies Config;
