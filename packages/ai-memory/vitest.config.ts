import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/{hindsight,honcho,mem0}.test.ts'],
    testTimeout: 30000,
  },
})
