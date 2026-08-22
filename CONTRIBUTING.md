# Contributing to Continuum

Continuum is a self-hosted household finance server: it parses real bank
statements and holds the numbers a household actually lives on. That shapes what
a good contribution looks like — correctness and privacy come before features,
and a wrong number is a bug even when nothing crashes.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you write code

Open an issue first for anything larger than a fix. A new bank format, a new
screen or a schema change is worth a paragraph of agreement before it is worth a
weekend. Small fixes — a wrong label, an off-by-one, a missing test — can go
straight to a pull request.

Security problems do **not** go in issues. Follow [SECURITY.md](SECURITY.md).

## Never commit real financial data

This is the one rule with no exceptions.

- Real statements, exports and payslips used for parser work belong in
  `bank_data_examples_do_not_share/`, which is gitignored. Nothing in there ever
  leaves your machine.
- Committed fixtures under `tests/fixtures/` are synthetic and anonymised —
  invented names, invented account numbers, invented amounts. Keep it that way.
- The same applies to issues and pull requests: redact account numbers,
  balances, names and variable symbols before pasting a statement excerpt. A
  parser bug can almost always be shown with three fabricated rows in the real
  layout.

If you accidentally push real data, say so immediately — a rewrite is easy
early and awkward later.

## Development setup

```sh
docker compose up -d db        # Postgres
cp .env.example .env
npm install
npm run dev
```

The stack is SvelteKit (Svelte 5, TypeScript strict) over PostgreSQL via
Drizzle. Read [ARCHITECTURE.md](ARCHITECTURE.md) before your first change — it
explains the extension seams, and most features are meant to be added by writing
an adapter rather than editing screens.

### Checks

Everything below runs in CI on every pull request, so run it locally first:

```sh
npm run lint       # eslint + prettier --check
npm run check      # svelte-check, TypeScript strict
npm test           # unit + embedded-PostgreSQL integration tests (vitest)
npm run build && npm run test:e2e   # Playwright journey; needs the db running
```

`npm run format` applies Prettier. CI additionally builds the multi-architecture
Docker image, so a change that breaks `docker/Dockerfile` fails the pipeline
even when the tests pass.

### Database changes

Schema lives in `src/lib/server/db/schema/`, split by domain with `index.ts` as
the only import site. After editing it:

```sh
npm run db:generate    # writes a new migration into drizzle/
npm run db:migrate     # applies it locally
```

**The schema is additive-only.** `drizzle/0000_baseline.sql` is the whole schema
as of 0.4.0; everything after it adds. Dropping or renaming a column means
writing the migration that carries the data across, because households are
running the previous release.

Commit the generated SQL and the snapshot together with the schema change.
Migrations are forward-only and run automatically on container start, so a
migration that cannot apply to an existing household's database is a breaking
change — call it out in the pull request. Keep `drizzle/meta/_journal.json` in
sync for a hand-written migration, and run `npx drizzle-kit check`; the
migration-metadata regression also verifies that the current snapshot matches
the TypeScript schema so the next generated migration cannot recreate objects
that already exist.

`db:generate` writes tables, columns, indexes and foreign keys and nothing else.
Triggers, generated columns, CHECK constraints, expression indexes, views and
seed rows have to be written by hand — the appendix at the foot of the baseline
is the worked example, and `tests/integration/baseline-migration.test.ts` is what
notices when one goes missing.

### Conventions the tests enforce

Three rules are checked rather than remembered, so breaking one fails CI rather
than review:

- **Naming.** Money is `*_minor` and always `bigint`; a date is `*_on`; an
  instant is `*_at`. Every foreign key has a covering index, and every enum
  column has a CHECK matching its list in `src/lib/enums.ts`. See
  `tests/integration/schema-invariants.test.ts`.
- **Module boundaries.** Nothing loose in `src/lib/server` — a domain is a
  directory with an `index.ts`, and cross-cutting plumbing lives in `system/`.
  See `tests/unit/module-boundaries.test.ts`.
- **Licence headers.** Every file under `src/` starts with
  `// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0`. An ESLint rule adds
  it with `--fix` and fails without it.

### Cutting a release

Nothing is published from `main`. A version — and `latest` with it — is
published only by a tag, so releasing stays a deliberate act rather than
something a merge does by accident. `latest` names the newest RELEASE, because
that is the tag `compose.yaml` pulls and people run at home; moving it on every
merge meant a `docker compose pull` picked up whatever landed an hour ago:

```sh
# 1. bump the version and write the changelog section, then commit
# 2. tag it and push the tag
git tag v0.3.5
git push origin v0.3.5
```

CI then runs the full suite and, only if it passes, builds `linux/amd64` and
`linux/arm64` and pushes `0.3.5` alongside `latest` to both registries.

Two things fail the build rather than publishing something wrong:

- **The tag must match `package.json`.** `v0.3.5` against a `0.3.4` package is
  one of the two being a mistake, and publishing either would be wrong.
- **Docker Hub must be configured** for a tagged release — `DOCKERHUB_USERNAME`
  and `DOCKERHUB_TOKEN` (an access token, not the account password). A release
  that silently reached only ghcr.io would be worse than one that failed loudly.

Both live in **secrets** here. The username is half of a credential pair, and
keeping it out of logs and out of forked pull requests costs nothing worth
having. One practical effect to expect: GitHub masks it, so the build's
`Publishing:` line reads `***/continuum:0.3.5` rather than naming the account.

The workflow reads `DOCKERHUB_USERNAME` from a secret or a repository variable,
whichever it finds, so moving it later does not break anything. The mechanism is
less obvious than it looks: the `secrets` context cannot be used in a step's
`if:` — the condition does not fail, it simply never matches — so the value is
lifted into the job's `env`, which secrets may be read into and which `if:` can
see. Anything conditional on Docker Hub being configured must go through `env`
for that reason.

The Docker Hub account has nothing to do with the GitHub organisation: images go
to `<DOCKERHUB_USERNAME>/continuum`, and `compose.yaml` has to name the same
place or installs will pull an image CI is no longer updating. If the account
that signs in is ever not the account images live under — a Docker Hub
organisation, say — set `DOCKERHUB_NAMESPACE` as well; it defaults to the
sign-in account.

## The two rules the codebase follows

Both come from [ARCHITECTURE.md](ARCHITECTURE.md), and a review will hold you to
them:

1. **Nothing variable is hard-coded.** A constant is allowed only for a fact
   about a file format or about arithmetic. Anything a bank, a household or
   personal taste could disagree with is derived from data or exposed as a
   setting — day-count conventions per loan, currencies from the FX table,
   module toggles, calendar rules.
2. **Capabilities live behind seams.** Screens talk to interfaces; formats and
   platforms are pluggable implementations. Adding a bank means writing an
   adapter in `src/lib/server/import/adapters/` plus a sniff rule in
   `detect.ts`, never touching the import screen.

### Money

Money is integer minor units plus a currency code, everywhere — in the
database, across the API, through every function. Floats are never used for
amounts, stored amounts are never re-denominated, and only screen-level totals
convert at the day's rate. A patch that introduces a `number` of "korunas" will
be sent back.

### Tests

- Parsers, pairing, categorisation, loan schedules and chart layout are pure
  functions with unit tests — add one with your change.
- A parser must reproduce each statement's own `opening + rows = closing`. The
  acceptance suite enforces this against real files when they are present
  locally, and never in CI.
- Multi-row and concurrent behavior belongs in `tests/integration`, whose
  suites start isolated embedded PostgreSQL instances. Use an injectable
  database handle in the domain mutation so the test can force rollback and
  interleave transactions without driving a page.
- Playwright remains the user-journey boundary for authentication, uploads,
  dialogs and API tokens. Extend it when a visible workflow changes; do not use
  it in place of a focused unit or database regression.

Write the test so that it fails without your change. A test that passes either
way is documentation, not coverage.

## Pull requests

- Branch off `main`, keep one concern per pull request.
- Fill in the [pull request template](.github/PULL_REQUEST_TEMPLATE.md) —
  especially the migration and data-safety boxes.
- Explain the _why_ in the description; the diff already shows the _what_.
- Update `CHANGELOG.md` for anything a user of the app would notice. The
  changelog is written in prose for a household, not in commit subjects.
- Update `README.md` or `ARCHITECTURE.md` when you add a setting, a seam or a
  supported format.

Commit messages: a short imperative subject, a body when the reasoning is not
obvious from the diff. No format is enforced.

## Adding a bank statement format

The most common contribution, so the path is written out:

1. Put the real export in `bank_data_examples_do_not_share/`.
2. Write the adapter in `src/lib/server/import/adapters/`, returning a
   `ParsedStatement`.
3. Register a sniff rule in `src/lib/server/import/detect.ts` — detection must
   be positive evidence (a header, a title, a BIC), never "whatever is left".
4. Add an anonymised fixture under `tests/fixtures/` and a unit test covering
   the awkward rows: negative amounts, foreign currency, a card transaction with
   no counterparty, a date that looks like a symbol.
5. Check reconciliation: opening + rows = closing, to the minor unit.
6. Add the bank to the README table.

Dedup and fingerprinting are handled centrally — prefer the bank's own
reference when the statement carries one, and let `fingerprintVersion` do the
rest.

## License

Continuum is licensed under [PolyForm Noncommercial 1.0.0](LICENSE.md). By
contributing you agree that your contribution is licensed under the same terms,
and that you have the right to submit it. There is no separate CLA.
