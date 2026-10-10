# SCORM compatibility & security guide

## Supported (SCORM 1.2)

- ZIP upload (≤100MB, ≤500 files), `imsmanifest.xml` parsing, version gate.
- Entry launch URL, per-learner attempts with resume (`location`,
  `suspend_data`), commit of `completion/success/score/total_time`.
- Completion maps back to lesson progress when the package is lesson-attached.
- No package versioning yet: re-uploading the same course package replaces
  stored files (the `package_version` column exists for a future versioning
  scheme; old attempts are not pinned to a version).

## Security boundary

- Zip-slip neutralized (no `..`, no absolute paths, no executables).
- Content served per-request with tenant checks, safe MIME allowlist,
  `nosniff`, and `Content-Security-Policy: sandbox`.
- The student player uses `<iframe sandbox="allow-scripts">` (opaque origin):
  uploaded JS **cannot** reach the app origin, cookies, or tokens. Progress
  syncs through explicit player buttons calling the API with the user session.

## Gaps (documented, not advertised)

- **SCORM 2004**: accepted at import and stored with `version: '2004'`, but the
  sequencing/navigation model is NOT interpreted (`sequencing:
'not-interpreted'`) — only the same 1.2-style launch/track/commit subset
  applies. Full 2004 RTE/sequencing is roadmap, not claimed.
- **Full RTE adapter** (`window.API` bridge): roadmap — current player uses
  manual sync; runtime data model fields beyond the commit subset are not mapped.
- **H5P**: no native runtime and no URL-allowlist enforcement — external
  URLs are stored, never fetched or embedded by the server. Treat `external`
  lessons as plain links; do not paste untrusted URLs expecting sandboxing.
  Native support deferred.

## Testing

`test/growth.test.ts` covers invalid zips, missing manifests, 2004 import
(stored, sequencing not interpreted), launch/resume/commit validation,
completion mapping, tenant isolation on content serving, and traversal
rejection.
