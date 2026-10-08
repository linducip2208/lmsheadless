import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: [
        'test/**',
        'src/dev.ts',
        'src/index.ts',
        'src/seed.ts',
        'src/migrate.ts',
        'src/audit.ts',
        'src/types.ts',
      ],
    },
  },
});
