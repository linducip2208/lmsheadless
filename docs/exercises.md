# Coding exercises

Static-first model: problem statement, language metadata, examples, submissions
with history, instructor feedback, attempt limits, progress via the course.

## Execution policy

`execution_mode` is `static` for all exercises created through the API.
Live execution requires a deployment-configured, tested sandbox provider;
until one exists the API answers `EXECUTION_UNAVAILABLE` to `execute: true`
instead of running code anywhere privileged. To integrate a sandbox later:

1. Implement the provider call in `POST /exercises/:id/submissions`.
2. Add contract tests with recorded sandbox responses.
3. Document timeouts, language allowlists, and data retention.

Never run arbitrary learner code in Workers, D1-adjacent processes, or the
browser origin with credentials.
