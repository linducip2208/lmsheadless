# Architecture

- `apps/api`: Hono routers per domain behind `createApp(env, db)`; `D1Like` interface abstracts D1 vs `node:sqlite`.
- Middleware order: requestId → language → env/db injection → rateLimit → authOptional → route auth.
- Domain helpers (`courseOrg`, `quizOrg`, `canTeach`, `orgRole`) centralize tenant checks.
- Storage: `putObject/getObject` switch on `STORAGE_DRIVER` (`local` fs vs R2 binding).
- Frontends are thin API consumers (no business logic duplicated); Flutter uses the same `/api/v1`.
