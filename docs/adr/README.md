# Architecture Decision Records

| ID                             | Title                                                                   | Status   |
| ------------------------------ | ----------------------------------------------------------------------- | -------- |
| [001](001-audit-logging.md)    | Every state-changing endpoint writes an audit row                       | Accepted |
| [002](002-minor-units.md)      | Money is stored and computed in integer minor units                     | Accepted |
| [003](003-api-envelope.md)     | Uniform `{success, data, meta}` envelope, no raw bodies                 | Accepted |
| [004](004-opt-in-retention.md) | Growth tables are retained by default; purges are opt-in                | Accepted |
| [005](005-in-worker-cron.md)   | Maintenance runs on the Workers cron trigger, not an external scheduler | Accepted |
