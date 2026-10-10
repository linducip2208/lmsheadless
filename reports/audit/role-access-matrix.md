# Role × capability matrix (commit fe6a8ec + tree)

Enforcement is server-side in every row (`requireAuth` + inline role/org
checks in `apps/api/src/routes/*`). Frontend menus are convenience only.

| Capability                                    | super_admin | org_admin   | teacher                                         | staff         | student                | parent                     |
| --------------------------------------------- | ----------- | ----------- | ----------------------------------------------- | ------------- | ---------------------- | -------------------------- |
| First-run setup / settings                    | yes         | no          | no                                              | no            | no                     | no                         |
| Users: create / list roster / view other      | yes         | create+list | list+view                                       | list+view     | self only              | self only                  |
| Courses: create/edit/publish/delete           | yes         | yes         | create/edit (publish gated by approval setting) | create/edit   | no                     | no                         |
| Enrollments: self / others / approve          | yes         | yes         | others+approve                                  | others        | self (or via purchase) | no                         |
| Quizzes/assignments: author / attempt / grade | yes         | yes         | author+grade                                    | author        | attempt                | no                         |
| Grades/certs of others                        | yes         | yes         | yes (own org)                                   | yes (own org) | no (403, tested)       | linked child only (tested) |
| Attendance record                             | yes         | yes         | yes                                             | yes           | read own               | read linked child          |
| Commerce: confirm/refund/payouts/affiliates   | yes         | yes         | no (403 tested)                                 | read revenue  | buy                    | no                         |
| Certificates issue/revoke                     | yes         | yes         | yes                                             | no            | no                     | no                         |
| AI config / purge                             | yes         | yes         | ask+jobs                                        | ask           | ask (enrolled scope)   | no                         |
| xAPI purge/export                             | yes         | yes         | no                                              | export only   | own only               | no                         |
| Notifications prefs                           | own         | own         | own (enforced on fan-out)                       | own           | own                    | own                        |

Negative evidence (all in `apps/api/test/`): `security.test.ts` (cross-org,
cross-student, parent-link, escalation), `security-fixes.test.ts` (cert/grade/
roster oracles closed), `coverage-gaps.test.ts` (teacher refund 403, student
commissions/affiliates/payouts/reports 403), `roles.spec.ts` E2E (student-B vs
student-A 403, unlinked parent exclusion).
