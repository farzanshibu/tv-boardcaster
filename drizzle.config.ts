import { defineConfig } from 'drizzle-kit';

// `bun run db:generate` turns src/db/schema.ts into SQL under ./drizzle.
// The generated files are committed and applied at boot by src/db/client.ts, so a
// deployment never runs drizzle-kit and the schema in git is the schema in the database.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://brandcast:brandcast@localhost:5432/brandcast',
  },
  strict: true,
  verbose: true,
});
