<!--
Thanks for the patch. Keep one concern per pull request, and say why the change
is right — the diff already shows what it does.

Security fixes do not start here: see SECURITY.md.
-->

## What and why

<!-- One paragraph. What changes for someone using the app, and what problem it solves. -->

Closes #

## How it was verified

<!-- Which tests you added or ran, and anything you checked by hand. "Tests pass" is not verification on its own. -->

- [ ] `npm run lint`
- [ ] `npm run check`
- [ ] `npm test`
- [ ] `npm run build && npm run test:e2e` — required if this touches sign-in, import, splits or API tokens
- [ ] Checked by hand in the running app

## Data safety

- [ ] No real statements, account numbers, balances, names or payslips in the diff, the fixtures, the tests or this description
- [ ] New fixtures under `tests/fixtures/` are synthetic

## Architecture

- [ ] Nothing variable is hard-coded — new constants are facts about a file format or about arithmetic, everything else is derived or a setting
- [ ] New capability goes behind an existing seam (adapter, provider, registry) rather than editing screens
- [ ] Amounts stay integer minor units plus a currency code; no float money, no re-denominated storage

## Migrations

- [ ] No schema change
- [ ] Schema changed: migration generated with `npm run db:generate`, the SQL and snapshot are committed, and it applies cleanly to an existing database
- [ ] This is a breaking change for existing installs — described below

<!-- If breaking: what breaks, and what a household has to do about it. -->

## Docs

- [ ] `CHANGELOG.md` updated for anything a user would notice
- [ ] `README.md` / `ARCHITECTURE.md` updated for a new setting, seam or supported format
- [ ] Not needed
