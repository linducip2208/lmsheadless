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
      // Enforced floor (idea 61): measured 83.9 lines / 88.4 functions /
      // 63.0 branches (round 9). CI fails on regression below these.
      thresholds: {
        lines: 80,
        functions: 85,
        branches: 60,
      },
    },
  },
});
