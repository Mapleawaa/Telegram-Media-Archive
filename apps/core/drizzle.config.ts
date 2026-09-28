import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/database/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: './.data/archive.db',
  },
  strict: true,
  verbose: true,
});
