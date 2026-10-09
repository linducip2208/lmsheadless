# SCORM compatibility & security guide

## Supported (SCORM 1.2)

- ZIP upload (≤100MB, ≤500 files), `imsmanifest.xml` parsing, version gate.
- Entry launch URL, per-learner attempts with resume (`location`,
  `suspend_data`), commit of `completion/success/score/total_time`.
- Completion maps back to lesson progress when the package is lesson-attached.
- Package versioning (re-uploads create new versions; old attempts keep
  pointing at their version).

## Security boundary

- Zip-slip neutralized (no `..`, no absolute paths, no executables).
- Content served per-request with tenant checks, safe MIME allowlist,
  `nosniff`, and `Content-Security-Policy: sandbox`.
- The student player uses `<iframe sandbox="allow-scripts">` (opaque origin):
  uploaded JS **cannot** reach the app origin, cookies, or tokens. Progress
  syncs through explicit player buttons calling the API with the user session.

## Gaps (documented, not advertised)

- **SCORM 2004**: rejected at import with `UNSUPPORTED_VERSION`. Sequencing/
  navigation model not implemented.
- **Full RTE adapter** (`window.API` bridge): roadmap — current player uses
  manual sync; runtime data model fields beyond the commit subset are not mapped.
- **H5P**: no native runtime; safe-embed extension point is
  `content_type: 'external'` + URL allowlist validation. Native support deferred.

## Testing

`test/growth.test.ts` covers invalid zips, missing manifests, 2004 rejection,
launch/resume/commit validation, completion mapping, tenant isolation on
content serving, and traversal rejection.
