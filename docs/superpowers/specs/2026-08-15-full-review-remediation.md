# Full Code Review Remediation Specification

**Status:** Completed for release `0.3.3` on 2026-08-15. The original scope and
the independent follow-up findings are implemented; no confirmed Critical or
High-severity correctness/data-integrity blocker remained in the final review.

## Goal

Remove every verified correctness, security, accessibility, performance, and
targeted duplication issue from the 2026-08-15 full code review without
changing the product's intended financial semantics.

## Global invariants

- Money is stored as integer minor units paired with an explicit currency.
- Major/minor conversion always goes through `$lib/money`; monetary code never
  assumes two minor digits.
- Foreign-exchange conversion uses the newest rate on or before the effective
  date. A missing historical rate never uses a future rate.
- Multi-row financial writes are atomic. A failed request preserves the
  previously committed state and remains safely retryable.
- Only an exact, country-aware account identity is hard evidence for automatic
  transfer pairing. Ambiguous evidence always requires review.
- Authentication state transitions remain valid under concurrent requests.
- SvelteKit action failures stay visible and never close or discard a draft.
- Shared interaction primitives own repeated action, upload, modal, tag, and
  loan-preview behavior; route components retain only domain-specific inputs.
- No Git commit is created by this remediation.

## Required behavior

### Import and migrations

1. Existing transactions rescaled by migration 0023 receive fingerprints that
   match the current parser representation and `fingerprint_version = 3`.
   Installations where 0023 already ran must receive the repair through a new
   forward migration.
2. A statement import either commits its import record, transactions, closing
   balance, counters, and deterministic post-processing state together, or
   commits none of them.
3. An explicitly selected account must match the statement currency. When the
   statement supplies bank/account identity, conflicting selections are
   rejected.
4. CSV records remain intact when one quoted field contains both RFC 4180
   escaped quotes and newlines.
5. Czech local account matching retains the bank code. Substring collisions and
   equal account numbers at different banks cannot auto-pair.
6. Concurrent pairing cannot place one transaction in multiple live pairs.

### Authentication and API

1. Exactly one request may claim initial setup and create the initial
   administrator.
2. Login limiting combines per-account and per-address budgets; rotating
   unknown identifiers cannot trigger unbounded Argon2 work or limiter growth.
3. Password changes invalidate in-flight authentication ceremonies through a
   per-person authentication generation checked when sessions or passkeys are
   created.
4. Positive passkey counters advance with compare-and-swap semantics.
5. Public passkey challenge issuance is rate-limited, bounded, and indexed by
   expiry.
6. `/api/v1` bearer authentication is enforced once at the route boundary and
   fails closed for newly added endpoints. Authentication schemes are parsed
   case-insensitively.
7. Invalid session cookies are cleared, and expired session rows have a cleanup
   path.

### Money and financial projections

1. One preloaded converter implements synchronous conversion. It returns
   `null` before the first known rate and preserves major-unit magnitude for the
   explicitly labelled missing-rate fallback.
2. Property equity, loan allocation, rental cash flow, retirement rent/salary,
   briefing totals, tax series, investment series, split remainders, tag totals,
   and account charts respect each value's currency and minor-digit scale.
3. Tag converted totals use each effective transaction line's effective date.
4. Net-worth month delta compares against the earliest current-month snapshot
   after converting that snapshot's currency at its date.
5. Adding an earlier loan fixation supersedes conflicting later periods in both
   simulation and persisted state.
6. The account donut denominator is the sum of the positive slices it renders;
   signed net cash remains a separate metric.

### UI, actions, and accessibility

1. Action requests deserialize and apply SvelteKit action results. Success
   invalidates data; failures remain visible and preserve local drafts.
2. Import, investment, property image, floor-plan, and home-device requests use
   the shared action behavior.
3. Split, tax, and rule dialogs close only on successful actions.
4. Switching property tabs cannot reuse or save another property's floor-plan
   draft.
5. Retirement autosave serializes requests, uses a stable URL, reports failure,
   and flushes a committed change before navigation/unmount where possible.
6. Calendar selection resets when its day is absent from the new month.
7. Document query/prefill state follows same-route navigation and history.
8. Modal, lightbox, and mobile drawer move focus into the overlay, contain it,
   restore it, expose state to assistive technology, and support Escape.

### Focused simplification and performance

1. Loan repayment and refix dialogs share payload decoding, comparison bars,
   preview markup, and styles without hiding their distinct form inputs.
2. Tag name resolution and transactional relation replacement are shared while
   relation-specific database operations remain explicit.
3. Upload/drop handling and action-result presentation are shared.
4. Transaction register count and per-currency totals do not materialize every
   matching ledger row in application memory.
5. Page-server actions delegate coherent multi-row mutations to domain
   functions instead of duplicating transaction orchestration.

## Verification result

- Regression work used red/green cycles, including embedded-PostgreSQL tests
  for rollback, upgrades and deliberate concurrency interleavings.
- `npx vitest run`: 66 files, 527 tests passed.
- `npm run test:e2e`: 59 Playwright tests passed against PostgreSQL.
- `npm run lint`, `npm run build`, `npx drizzle-kit check` and
  `git diff --check` passed; `npm run check` reported zero errors and 19
  non-blocking Svelte initial-state capture warnings.
- The consolidated `drizzle/meta/0032_snapshot.json` makes a fresh
  `drizzle-kit generate` report no schema changes.
- Independent reviews covered the initial implementation and its follow-up
  repairs. The worktree was deliberately left uncommitted for maintainer review.
