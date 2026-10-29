// StrykerJS mutation testing (idea 62): scoped sample on storage.ts
// (magic-byte sniffing + zip-ratio guard). Runs from the REPO ROOT so the
// sandbox includes repo-root migrations/ (API tests resolve migrations via
// a path outside apps/api). Only the 14 tests covering storage.ts run per
// mutant (what related-mode would select); full suite stays in `npm test`.
// Run: npx stryker run (from repo root). Thresholds: high 90, low 75, break 70.
export default {
  mutate: ['apps/api/src/storage.ts'],
  testRunner: 'command',
  commandRunner: {
    command: 'npm --workspace apps/api run test',
  },
  reporters: ['clear-text', 'json'],
  thresholds: { high: 90, low: 75, break: 70 },
  timeoutMS: 120000,
  concurrency: 4,
  ignorePatterns: [
    'dist',
    'node_modules',
    'coverage',
    '.stryker-tmp',
    'apps/web/test-results',
    'test-results',
  ],
  coverageAnalysis: 'off',
};
