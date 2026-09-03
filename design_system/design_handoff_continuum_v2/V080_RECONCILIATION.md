# Reconciliation with v0.8.0-shelves

The first handoff was authored against `main` @ 0.7.9. The prototype and README are now reconciled with branch `v0.8.0-shelves` @ 0.8.0. What changed:

| Handoff assumed (0.7.9) | v0.8.0 has | Handoff now |
| --- | --- | --- |
| Rail: Inbox · Shelves (0.7.6 order) · Subjects · Organisations · Tags | Inbox · Shelves · Everything · Tags; subjects and organisations are cards on their shelf | Rail matches v0.8.0; seeded shelves IDs · Statements · Income & Tax 🏛️ · Health · Inventory · Property · Vehicles (Household → Inventory; Family and Tenancy gone) |
| Shelf banner (blurb + 3 stats + "Answers ·") | ScreenHeader (emoji mark, label, question as caption) + SummaryBand from `shelfTiles(engine)` | Banner dropped; header + band used |
| Inbox as review cards with proposal strips | Queue engine: preview left, three-step decision (shelf → card → lane) right, rule proposal pre-answers | Rebuilt as the queue |
| Counterparty cards (Income & Tax only) | Dossier engine for every non-fixed template: organisation, person (timeline), subject (kit / obligations), property (obligations); lanes monthly / yearly / every-N / once (slots) / none (history); pinned document; collapse with finding | Rebuilt as the dossier; fixtures for all five dossier shelves |
| New primitives IconTile, MetricTile changes, Switch | `SummaryBand`, `ControlRow`, `tiles.ts`, `MetricTile` from the frame refactor | README § *Mapping onto the v0.8.0 screen frame* — keep the frame, restyle the primitives; IconTile and Switch still new |
| ui-guidelines at 0.7.9 | Tokens finalised (AA contrast: indigo/brand inks lifted), type ramp, geometry scale, `design/no-raw-*` lint rules | `app.v2.css` adds tokens only; ink values untouched; new radii aliased to the scale; `--shadow-card`/`--shadow-hero` to be allow-listed |

Unchanged from the first handoff: shell, Overview board, all Money/Assets/Retirement/Home/Calendar/Contacts screens, Settings, Sign-in, light-theme rework.
