// StrykerJS mutation testing (idea 62): scoped sample on storage.ts
// (magic-byte sniffing + zip-ratio guard). Full-repo runs are CI-future;
// this proves the round-9 guards actually kill mutants.
// Run: npx stryker run (from apps/api). Thresholds: high 90, low 75, break 70.
//
// NOTE (2026-10-23): the vitest test-runner finds no tests in this
// workspace on Windows (path handling in vitest-runner 10), so this config
// uses the command runner (`npm test` per mutant) instead — slower but
// layout-independent. property + fuzz tests in
// test/round9b-properties.test.ts are the fast executable sample.
export default {
  mutate: ['src/storage.ts'],
  testRunner: 'command',
  commandRunner: { command: 'npm test' },
  reporters: ['clear-text', 'html'],
  thresholds: { high: 90, low: 75, break: 70 },
  timeoutMS: 30000,
  concurrency: 4,
  ignorePatterns: ['dist', 'node_modules', 'coverage', '.stryker-tmp'],
  coverageAnalysis: 'off',
};
