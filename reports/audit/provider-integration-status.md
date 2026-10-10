# Provider integration status (honest labels)

| Provider     | Status                                                                                                                                         | Evidence                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Email        | Configured HTTP-webhook driver real; `log` driver marks `sent` without delivery (labeled in response); NO SMTP driver (docs fixed)             | `growth.ts` queue/send; contract-tested, live delivery BLOCKED |
| Push         | Subscription storage only; zero send code paths                                                                                                | `platform.ts`; NEVER verified as delivery                      |
| Live classes | Jitsi room convention + custom URLs stored; Zoom/Meet require caller-supplied `meeting_url` (400 otherwise); ICS + attendance + reminders real | `live.ts`; vendor APIs NOT implemented                         |
| Payments     | Manual + Midtrans-style HMAC; extension point documented; no Stripe/Xendit/etc.                                                                | `commerce.ts`; live merchant BLOCKED                           |
| AI           | Mock deterministic (tested) + `openai-compatible` BYOK (ships, untested live); quota enforced, no auto-reset; retention purge endpoint new     | `growth.ts`; live provider BLOCKED                             |
| Exercises    | Static/manual only; `execute:true` → 400 always                                                                                                | `growth.ts`; sandbox NOT implemented by design                 |
| SCORM        | 1.2 real; 2004 imported, sequencing not interpreted; no H5P runtime, no URL-allowlist                                                          | `scorm.ts`; docs corrected                                     |
| xAPI         | Local LRS subset real (validate/auth/idempotency/scope/paginate/purge/export)                                                                  | `xapi.ts` + tests                                              |
| Storage      | Local FS real; R2 branch ships inactive (bindings commented); `R2_PUBLIC_BASE_URL` unused                                                      | `storage.ts`, `index.ts`, `wrangler.toml`                      |
| Rate limits  | In-memory real; KV branch ships inactive                                                                                                       | `middleware/common.ts`                                         |
| Cron         | NONE — publish-due, retention purges, quota resets are manual endpoints                                                                        | `index.ts` (fetch only)                                        |

Rule applied: no mock is presented as a live integration anywhere in UI or docs.
