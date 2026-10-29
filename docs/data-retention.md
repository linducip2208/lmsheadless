# Data retention policy

Growth is bounded by policy, never by silent deletion (ADR 004).

| Table                            | Default              | Purge mechanism                                                                           | Notes                                                   |
| -------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `audit_logs`                     | keep forever         | `audit_log_retention_days` (global setting) → daily cron + `POST /system/retention/purge` | Cron run rows (`sys.cron.*`) purge with the same window |
| `notifications`                  | keep forever         | `notification_retention_days` (global setting)                                            | Read rows only; unread never purged                     |
| `email_queue`                    | keep forever         | `email_retention_days` (global setting)                                                   | Terminal rows (`sent`/`failed`) only                    |
| `idempotency_keys`               | 7 days, fixed        | daily cron + manual endpoint                                                              | Replays past 7d re-execute                              |
| `attempt_autosaves`              | superseded by submit | superseded on submit                                                                      | per-attempt drafts                                      |
| `questions` (attempt copies)     | keep forever         | `organizations.settings.quiz_copy_retention_days` (opt-in per org)                        | templates + active attempts never touched               |
| `xapi_statements`                | keep forever         | `organizations.settings.xapi_retention_days` (opt-in per org) + manual endpoint           |                                                         |
| `ai_messages`/`ai_conversations` | 30 days default      | per-org `retention_days` in `ai_configs`                                                  |                                                         |
| `refresh_tokens`                 | pruned on rotation   | reuse chain preserved for detection                                                       |                                                         |

Unset/invalid/non-positive = never purge. All purges are audited with counts.
