# Accounts tab does nothing after importing a statement — reproduction record

**Status:** did NOT reproduce. Item stays open.
**Date:** 2026-08-20
**Spec:** `docs/superpowers/specs/2026-08-20-v0.3.11-design.md` §1.3

## The report

> after adding statment with transaction, accounts tab cannot be open

and, on being asked what the screen showed:

> button is just not responsive, i pressing it and nothing change

No error screen, no visible change.

## What the report actually refers to

Worth stating, because the plan assumed otherwise: **Accounts is not a sidebar
item.** It is a sub-tab inside the "Money" area (`src/lib/modules/registry.ts:114`),
whose sidebar row links to `/cashflow`. The control that was pressed is the
sub-tab strip rendered by `ScreenHeader.svelte:69`, not the sidebar.

## What was ruled out

1. **A throwing `load`.** SvelteKit renders its error boundary for those, and
   the report says no error screen appeared.
2. **Direct navigation.** `tests/e2e/flow.spec.ts` already imports
   `tests/fixtures/fio.csv` and then does `page.goto('/accounts')`, asserting
   the account and its closing balance. It passes.
3. **Clicking the sub-tab.** A test was written for exactly the reported path —
   import a statement, go to `/cashflow`, click the Accounts tab — capturing
   console errors and page errors throughout. It passes with no console output.
   That test was kept rather than deleted; it is the `clicking the Accounts tab
after an import opens the screen` case in `flow.spec.ts`.
4. **An inert link.** The tabs are plain `<a href>` elements. `registry.ts:183`
   drops any area whose screen list is empty, so `area.screens[0]` is never
   undefined and no rendered link can lack an `href`.
5. **An empty or all-brokerage donut.** `positiveDonutSlices` returns `[]` when
   the total is zero or nothing is positive, so neither an instance with no cash
   accounts nor one with zero balances divides by zero.

## What is still open

The failure is therefore specific to something in Robert's data or environment
that the `fio.csv` fixture does not carry. The `load` at
`src/routes/(app)/accounts/+page.server.ts:25` does four things that only become
reachable once transactions exist, and any of them could behave differently on
real data:

- per-account FX conversion via `loadRateTable()` — a currency with no rate on
  the relevant day
- the `transfer_pair` query and the join fetching both legs, where a leg's
  transaction or account has since been removed
- a brokerage account created by the XTB import sitting alongside bank accounts
- simple volume: a very large transaction table making the load slow rather than
  broken, which reads as an unresponsive tab

## What to capture next

Reproduce on the real instance with the browser devtools open, and capture all
three of these at the moment of the click:

- **Console** — any error or unhandled rejection
- **Network** — whether a request for the navigation is issued at all; if so,
  whether it completes, hangs, or returns a non-200
- **Server log** — whether `load` is entered, and whether it returns

Those three answers select the branch:

- no request issued → the router never started; look at the click handler
- request issued, never completes → `load` is hanging; bisect the four steps
  above, starting with the transfer-pair join
- request completes, nothing changes → rendering or hydration, not `load`

**Do not close this item on a change that merely looks likely to help.**
