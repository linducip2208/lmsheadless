# Multi-organization (tenant model)

- Membership is explicit: `organization_members(organization_id, user_id, role)` unique per pair; a user may belong to many orgs with different roles.
- Every tenant entity carries `organization_id` (or resolves to one: course→org, quiz→org, assignment→org, thread→course→org).
- Guarantees (all tested): a member of org A gets `TENANT_DENIED`/`NOT_FOUND`-class 403s on org B courses, students, grades, attendance, reports, files and certificates. Students see only self; parents only `parent_links` children; teachers only their org's data.
- Files are namespaced by `organization_id` and download-checked per request.
- Notifications fan out per organization; audit logs are filterable per organization.
- `super_admin` is the only cross-tenant role (platform operations).
