# Full Code Review Remediation Implementation Plan

**Status:** Completed for `0.3.3` on 2026-08-15. The final verification result
is recorded in the linked specification; every checklist item below is closed.

> **Implementation record:** The checklist preserves the reviewed execution
> sequence; every item is marked complete.

**Goal:** Implement every verified finding from the full code review and remove the targeted duplication that caused those defects.

**Architecture:** Establish four explicit boundaries: atomic domain mutations, one date-aware money converter, concurrency-safe authentication state, and one client action-result primitive. Keep pure financial calculations independently testable and have routes translate input/output rather than orchestrate multi-row state.

**Tech Stack:** TypeScript, Svelte 5, SvelteKit 2, Drizzle ORM, PostgreSQL, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-15-full-review-remediation.md`

## Global Constraints

- Follow every invariant in the remediation specification and `ARCHITECTURE.md`.
- Write and run a failing regression test before each production behavior change.
- Use `db.transaction` for every multi-row financial or authentication mutation.
- Do not introduce a second implementation of money conversion or effective transaction lines.
- Do not create a Git commit.
- Preserve unrelated user changes and keep temporary artifacts in `scratch-workspace/`.

---

### Task 1: Import, migration, CSV, and pairing integrity

**Files:**

- Create: `drizzle/0027_repair_transaction_fingerprints.sql`
- Modify: `src/lib/server/import/csv.ts`
- Modify: `src/lib/server/import/fingerprint.ts`
- Modify: `src/lib/server/import/ingest.ts`
- Modify: `src/lib/server/import/pairing.ts`
- Modify: `src/lib/server/db/schema.ts`
- Test: `tests/unit/csv.test.ts`
- Test: `tests/unit/fingerprint.test.ts`
- Test: `tests/unit/pairing.test.ts`
- Test: `tests/integration/import-integrity.test.ts`

**Interfaces:**

- Produces: `accountKeysMatch(a, b)` with exact identity semantics.
- Produces: transaction-aware `ingestFile` and `pairAndCategorise` accepting a Drizzle database handle.
- Produces: a forward migration that repairs version-3 fingerprints without rerunning 0023.

- [x] **Step 1: Add failing pure regression tests**

```ts
it('keeps an escaped quote and newline inside one CSV record', () => {
	const rows = csvLines('a;"before ""quoted""\nafter";c\nd;e;f');
	expect(rows).toHaveLength(2);
	expect(splitCsvLine(rows[0], ';')).toEqual(['a', 'before "quoted"\nafter', 'c']);
});

it('does not equate the same local number at different Czech banks', () => {
	expect(accountKeysMatch('12345678/0100', '12345678/0300')).toBe(false);
});

it('does not accept a longer unrelated account containing the local digits', () => {
	expect(accountKeysMatch('123456/0100', '99123456/0300')).toBe(false);
});
```

- [x] **Step 2: Run the focused tests and confirm each fails for the reviewed behavior**

Run: `npm test -- --run tests/unit/csv.test.ts tests/unit/pairing.test.ts tests/unit/fingerprint.test.ts`

- [x] **Step 3: Implement the RFC 4180 state machine and exact account identity matching**

Consume doubled quotes while remaining inside quoted mode. Canonicalize local
numbers as `number/bank`; compare local-to-local exactly and local-to-IBAN using
the IBAN bank code plus account-number suffix, never a bare substring.

- [x] **Step 4: Add database-backed failing tests for atomicity, selection validation, and concurrent pairing**

The tests must assert that an injected failure leaves no `import_file` or
partial transactions, a CZK account rejects an EUR statement, and two pairing
transactions cannot claim the same leg.

- [x] **Step 5: Make ingestion and pairing atomic**

Accept `DatabaseHandle` in account resolution, import inserts, categorisation,
tagging, and pairing. Add database constraints/locking so each transaction can
participate in at most one active pair. Keep filesystem storage outside the
database transaction and clean or retain an explicitly orphaned upload after a
rollback.

- [x] **Step 6: Add the forward fingerprint repair migration**

Recompute version-3 hashes from current rescaled economic fields for affected
currencies, preserving deterministic occurrence ordering per original import.
Use a temporary mapping/table so the `(account_id, dedup_fingerprint)` unique
index is never violated mid-update, then set `fingerprint_version = 3`.

- [x] **Step 7: Run import unit and integration tests**

Run: `npm test -- --run tests/unit/csv.test.ts tests/unit/pairing.test.ts tests/unit/fingerprint.test.ts tests/integration/import-integrity.test.ts`

---

### Task 2: Authentication concurrency, throttling, sessions, and API boundary

**Files:**

- Create: `src/lib/server/auth/generation.ts`
- Modify: `src/lib/server/auth/ratelimit.ts`
- Modify: `src/lib/server/auth/index.ts`
- Modify: `src/lib/server/auth/password.ts`
- Modify: `src/lib/server/auth/webauthn/challenge.ts`
- Modify: `src/lib/server/api/respond.ts`
- Modify: `src/hooks.server.ts`
- Modify: `src/routes/setup/+page.server.ts`
- Modify: `src/routes/login/+page.server.ts`
- Modify: passkey option/verify routes under `src/routes/auth/passkey/`
- Modify: API routes under `src/routes/api/v1/`
- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0028_auth_concurrency.sql`
- Test: authentication unit and integration suites under `tests/unit/` and `tests/integration/`

**Interfaces:**

- Produces: two-tier limiter operations for address and account subjects.
- Produces: per-person `authGeneration`, captured by sessions and challenges.
- Produces: route-boundary API bearer enforcement.

- [x] **Step 1: Add failing tests for rotating unknown identities and bounded limiter state**

Submit more than eight failures from one address with distinct unknown IDs and
assert the coarse address budget blocks them. Advance time past the window and
assert stale entries are removed without scanning unbounded attacker-created
subjects.

- [x] **Step 2: Add failing concurrency tests**

Exercise two setup claims, password revocation racing passkey verification, and
two positive counter advances from the same stored counter. Assert one setup
winner, no post-revocation session/credential, and one counter winner.

- [x] **Step 3: Implement atomic setup claim and authentication generation**

Lock or uniquely claim a singleton setup row inside the setup transaction.
Increment `person.authGeneration` during password changes/revocation. Store and
check the generation when creating sessions, passkey credentials, and login
challenges.

- [x] **Step 4: Implement two-tier throttling and challenge bounds**

Check both `address` and `address + known account` budgets. Unknown accounts use
one stable subject. Rate-limit challenge issuance, cap outstanding challenges,
and index `expires_at`.

- [x] **Step 5: Make counter updates conditional and clean invalid sessions**

Update passkey counters with `WHERE counter = expected RETURNING`; create a
session only after a successful update. Delete invalid cookies immediately and
prune expired rows during bounded lifecycle operations.

- [x] **Step 6: Centralize `/api/v1` bearer enforcement**

Authenticate `/api/v1` once in the hook or a required route layout. Remove
endpoint-local guards after tests prove every endpoint remains protected. Parse
the `Bearer` scheme case-insensitively.

- [x] **Step 7: Run all authentication and API tests**

Run: `npm test -- --run tests/unit/*auth* tests/unit/*webauthn* tests/unit/*api* tests/integration/*auth*`

---

### Task 3: Canonical money and foreign-exchange behavior

**Files:**

- Modify: `src/lib/server/fx/table.ts`
- Modify or remove duplicate query logic from `src/lib/server/fx/index.ts`
- Modify: `src/lib/server/cashflow.ts`
- Modify: `src/lib/server/briefing.ts`
- Modify: `src/lib/server/invest/series.ts`
- Modify: `src/lib/server/networth.ts`
- Modify: `src/lib/server/tags.ts`
- Modify: property, retirement, tax, investments, accounts, and tags page servers
- Test: corresponding unit files plus new `tests/unit/money-consumers.test.ts`

**Interfaces:**

- Produces: `RateConverter` loaded once per request.
- Produces: scale-correct `convertOrFace` that preserves major-unit magnitude.
- Produces: currency-aware investment and tax series.

- [x] **Step 1: Add failing converter tests**

```ts
it('returns null before the first known rate', () => {
	expect(convertMinorSync(tableWith2026Eur, 100n, 'EUR', 'CZK', '2020-01-01')).toBeNull();
});

it('preserves major-unit magnitude when a rate is missing', () => {
	expect(convertOrFace(new Map(), 1500n, 'JPY', 'CZK', '2020-01-01')).toBe(150000n);
});
```

- [x] **Step 2: Run converter tests and confirm the future-rate and scale failures**

Run: `npm test -- --run tests/unit/fx.test.ts tests/unit/money.test.ts`

- [x] **Step 3: Implement one converter and remove duplicated rate selection**

Build a `RateConverter` around a preloaded table. The async module may load the
table but must delegate arithmetic and rate selection to the same implementation.

- [x] **Step 4: Add failing consumer tests for mixed currencies and minor digits**

Cover EUR-property/CZK-loan equity and cash flow, foreign rent in retirement,
JPY and KWD investment/tax points, cross-currency briefing totals, JPY split
remainder, historical tag conversion, account donut slices, and a base-currency
change in net-worth history.

- [x] **Step 5: Convert every operand before arithmetic**

Pass currency and effective date through domain functions. Replace monetary
`/ 100`, `* 100`, raw cross-currency sums, and hard-coded `Kč` with `toMajor`,
`fromMajor`, `formatMinor`, `displayCurrency`, and `RateConverter` calls.

- [x] **Step 6: Make tag totals line/date aware and expose split tags**

Return effective transaction date with each tagged line, convert each line
before summing the base total, include split tags in `loadTagsFor`, and wire
split tag editing into the split dialog/action.

- [x] **Step 7: Run all financial-domain tests**

Run: `npm test -- --run tests/unit/fx.test.ts tests/unit/money.test.ts tests/unit/tag-totals.test.ts tests/unit/money-consumers.test.ts tests/unit/invest-series.test.ts tests/unit/networth.test.ts`

---

### Task 4: Atomic domain replacements and loan chronology

**Files:**

- Create: focused mutation modules under `src/lib/server/loans/`, `tax/`, `tags/`, and `documents/`
- Modify: `src/lib/server/invest/ingest.ts`
- Modify: `src/lib/server/tax.ts`
- Modify: `src/lib/server/tags.ts`
- Modify: `src/lib/loans/simulate.ts`
- Modify: loans, documents, and property page-server actions
- Test: loan simulation, tags, tax, documents, and broker ingest tests

**Interfaces:**

- Produces: transactional replacement helpers using an explicit `DatabaseHandle`.
- Produces: `applyFixation` semantics that remove or reject periods beginning on or after the new start.

- [x] **Step 1: Add failing rollback tests for holdings, tags, tax lines, documents, repayment, refixation, and loan creation**

Inject an error after the destructive/intermediate statement and assert the old
state remains intact with no partial new aggregate.

- [x] **Step 2: Add failing future-fixation tests**

Insert periods beginning in 2026 and 2029, apply a replacement beginning in
2027, and assert the 2029 period cannot override the replacement.

- [x] **Step 3: Move each coherent mutation into one domain transaction**

Page actions parse and validate input, then call domain functions. Domain
functions receive `db` or `tx`, lock the owning row where concurrent edits can
conflict, and perform all related deletes/inserts/updates atomically.

- [x] **Step 4: Share tag resolution without a meta-framework**

Extract `resolveTagIds(handle, names)` and a small transactional replacement
callback. Keep transaction, split, loan, and property relation mapping explicit.

- [x] **Step 5: Run the focused domain suites**

Run: `npm test -- --run tests/unit/simulate.test.ts tests/unit/tags.test.ts tests/unit/tax.test.ts tests/unit/invest-ingest.test.ts tests/integration/domain-transactions.test.ts`

---

### Task 5: SvelteKit action handling and state correctness

**Files:**

- Create: `src/lib/actions/result.ts`
- Create: `src/lib/components/UploadDropzone.svelte`
- Modify: import, investments, home, property, retirement, calendar, documents, rules, tax, and transactions Svelte pages/components
- Test: component/unit tests and `tests/e2e/flow.spec.ts`

**Interfaces:**

- Produces: a shared action runner using SvelteKit `deserialize` and `applyAction`.
- Produces: upload/drop-zone component emitting success/failure state.
- Produces: success-only enhanced-form close helper.

- [x] **Step 1: Add failing tests for action failure and retained drafts**

Assert upload summaries appear, failed uploads show their message, split/tax/rule
dialogs remain open on `failure`, and successful actions invalidate and close.

- [x] **Step 2: Implement and adopt the shared action-result runner**

Check network response status, deserialize SvelteKit's action result, apply it,
invalidate only after success, and expose a local network-error result.

- [x] **Step 3: Add failing state-transition tests**

Cover property tab switching with the floor-plan editor open, retirement edit
followed immediately by navigation/reload, calendar day then next month, and
documents query changes through back/forward navigation.

- [x] **Step 4: Key/reset local state at route identity boundaries**

Key the floor-plan editor by property ID, serialize retirement saves at an
absolute route URL, reset absent calendar dates, and derive/synchronize document
inputs from current page data.

- [x] **Step 5: Run component and browser tests**

Run: `npm test -- --run tests/unit/*action* tests/unit/*state*`
Run when PostgreSQL is available: `npm run test:e2e -- tests/e2e/flow.spec.ts`

---

### Task 6: Accessible overlays and targeted UI deduplication

**Files:**

- Modify: `src/lib/components/Modal.svelte`
- Modify: `src/lib/components/Lightbox.svelte`
- Modify: `src/routes/(app)/+layout.svelte`
- Create: `src/lib/components/LoanScenarioPreview.svelte`
- Create: `src/lib/loans/scenario.ts`
- Modify: `src/lib/components/RepayDialog.svelte`
- Modify: `src/lib/components/RefixDialog.svelte`
- Test: overlay and loan scenario component/unit tests

**Interfaces:**

- Produces: one overlay focus lifecycle shared by modal/lightbox/drawer.
- Produces: `decodeScenarioPayload` and reusable loan preview presentation.

- [x] **Step 1: Add failing keyboard interaction tests**

Open each overlay, assert initial focus is inside, Tab cannot reach background
controls, Escape closes, `aria-expanded` reflects drawer state, and focus returns
to the opener.

- [x] **Step 2: Implement the overlay focus lifecycle**

Prefer the native `<dialog>` behavior where compatible; otherwise use one shared
focus action that records the opener, focuses the first control, loops Tab, marks
the background inert, handles Escape, and restores focus.

- [x] **Step 3: Add failing parity tests for both loan dialogs**

Given the same payload, assert both dialogs decode identical terms/periods and
render the same comparison summary/bar inputs before their distinct mutation.

- [x] **Step 4: Extract payload decoding and preview markup/styles**

Keep repayment and refix form-specific inputs local. Move only the shared
simulation decoding, year-bar mapping, comparison text, schedule, and styling.

- [x] **Step 5: Run accessibility and component tests**

Run: `npm test -- --run tests/unit/overlay.test.ts tests/unit/loan-scenario.test.ts`

---

### Task 7: Aggregate performance and route/domain cleanup

**Files:**

- Modify: `src/lib/server/transactions.ts`
- Modify: `src/lib/server/tags.ts`
- Modify: relevant API and page-server loaders
- Test: transaction filtering/aggregate integration tests

**Interfaces:**

- Produces: database-side count and per-currency effective-line totals matching `effectiveLines` semantics.

- [x] **Step 1: Add an integration test with more than one page of split and unsplit transactions**

Assert page rows, total count, category/tag filters, fee handling, and per-currency
totals exactly match the pure effective-line oracle.

- [x] **Step 2: Replace full-ledger materialization with database aggregation**

Use a single canonical SQL effective-line relation or query builder shared by
count/totals/filtering. Do not duplicate split resolution in unrelated loaders.

- [x] **Step 3: Remove residual route orchestration and repeated API guards**

Keep loaders/actions small by calling the domain and authentication boundaries
created in earlier tasks. Do not split files solely to reduce line count.

- [x] **Step 4: Run transaction and API integration suites**

Run: `npm test -- --run tests/unit/transaction-filter.test.ts tests/integration/transaction-register.test.ts tests/unit/api*.test.ts`

---

### Task 8: Whole-repository verification and independent review

**Files:**

- Modify tests or implementation only for defects found by verification/review.

**Interfaces:**

- Consumes every preceding task.
- Produces a clean, uncommitted worktree ready for Robert's review and commit.

- [x] **Step 1: Run the complete unit suite**

Run: `npm test -- --run`

- [x] **Step 2: Run static and production checks**

Run: `npm run lint`
Run: `npm run check`
Run: `npm run build`

- [x] **Step 3: Run database-backed browser tests when the local service is available**

Run: `npm run test:e2e`

- [x] **Step 4: Review every specification requirement against the diff and tests**

Dispatch an independent reviewer with this plan, specification, complete diff,
and test evidence. Fix every Critical or Important issue and re-run its covering
tests.

- [x] **Step 5: Verify repository state**

Run: `git status --short`
Run: `git diff --check`
Confirm that no commit was created and report any environment-limited test.
