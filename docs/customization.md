# Customization

## Safe extension points

- **Branding**: organization settings (no code). **Content**: categories, subjects, custom `settings` keys.
- **Permissions**: `ROLE_PERMISSIONS` in `apps/api/src/permissions.ts` + `role_permissions` seeds; UI matrix renders automatically.
- **Reports**: add a query in `routes/ops.ts` following the completion/attendance pattern (org check → role gate → aggregate → `ok()`), then a card in `admin/src/pages/reports.ts`.
- **Notifications**: extend `notification_preferences` defaults + fan-out call sites.
- **New portal**: copy `apps/student` (smallest), set `orgKey`/theme/manifest/`sw.js` VERSION, add workspace + proxy port.

## Conventions

- New tables → new migration file (never edit applied ones); `ALTER` goes through `applyColumnPatches`.
- New endpoints → OpenAPI list + test + docs page row.
- New UI strings → `i18n.ts` dictionaries (en + id), never inline copy.
- Colors via Tabler utilities + `--tblr-primary` branding var; dark mode comes free from `data-bs-theme`.
