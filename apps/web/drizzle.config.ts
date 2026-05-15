import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/server/bench-db/schema.ts',
  out: './src/server/bench-db/migrations',
  dialect: 'sqlite',
})
