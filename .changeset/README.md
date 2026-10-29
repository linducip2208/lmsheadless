# Changesets

Short-lived markdown files describing user-facing changes. On merge to
`main`, `npx changeset version` consumes them into `CHANGELOG.md` bumps.

Format:

```md
---
'lms-api': patch
---

Fix quiz expiry burning max_attempts.
```

Types: `patch` (fix), `minor` (behavior addition, still backward compatible),
`major` (breaking — requires a `check-breaking` exception note).
