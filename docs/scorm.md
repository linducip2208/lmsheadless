# SCORM compatibility & security guide

## Supported (SCORM 1.2)

- ZIP upload (≤100MB, ≤500 files), `imsmanifest.xml` parsing, version gate.
- Entry launch URL, per-learner attempts with resume (`location`,
  `suspend_data`), commit of `completion/success/score/total_time`.
- The original archive is stored alongside extracted files, so
  `scorm_packages.file_key` and the `files` row always resolve (re-export,
  re-download, storage audits).
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

- **SCORM 2004**: accepted at import and stored with `version: '2004'`.
  Sequencing metadata is parsed (`<sequencing>` node count + control mode,
  see `GET /scorm/packages/:id` → `sequencing: { nodes, enforced }`) and the
  player enforces linear flow when sequencing nodes are present. Full ADL
  choice/jump/rollup sequencing and the RTE `window.API` bridge stay roadmap —
  only the 1.2-style launch/track/commit subset is claimed.
- **Full RTE adapter** (`window.API` bridge): roadmap — current player uses
  manual sync; runtime data model fields beyond the commit subset are not mapped.
- **H5P**: native minimal runtime ships (upload `.h5p` with `h5p.json`
  validation, sandboxed content serving, attempt + score tracking via
  `POST /h5p/attempts` + `/commit`). The full H5P editor/authoring suite stays
  out of scope. External `external`-type lessons remain plain links.

## Testing

`test/growth.test.ts` covers invalid zips, missing manifests, 2004 import
(stored, sequencing metadata recorded), launch/resume/commit validation,
completion mapping, tenant isolation on content serving, and traversal
rejection. `test/round8-h5p-scorm.test.ts` covers H5P upload validation,
listing, attempt + score commit, and 2004 sequencing linear-flow exposure.
