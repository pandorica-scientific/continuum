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
npm test           # unit tests (vitest)
npm run build && npm run test:e2e   # Playwright journey; needs the db running
```

`npm run format` applies Prettier. CI additionally builds the multi-architecture
Docker image, so a change that breaks `docker/Dockerfile` fails the pipeline
even when the tests pass.

### Database changes

Schema lives in `src/lib/server/db/schema.ts`. After editing it:

```sh
npm run db:generate    # writes a new migration into drizzle/
npm run db:migrate     # applies it locally
```

Commit the generated SQL and the snapshot together with the schema change.
Migrations are forward-only and run automatically on container start, so a
migration that cannot apply to an existing household's database is a breaking
change — call it out in the pull request.

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
- Auth, import, splits and the API tokens are covered end to end only by the
  Playwright journey. If you touch those paths, extend it.

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
