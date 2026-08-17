# Shared calendar, two-way sync, and contacts

Status: approved design, not yet implemented. Target v0.3.7.

The calendar today is a publisher, not a calendar. `LedgerEvent`
(`src/lib/server/calendar.ts`) is a pure value object with no id and no table:
every event is recomputed from loans, tenancies and documents on each request,
and `/ics/[token]` re-renders the whole feed per fetch. Nothing can be authored
by hand, nothing is shared, and nothing comes back.

This design makes the calendar writable and shared across the household, syncs
it two-way with Google Calendar and iCloud, and adds a contacts module that
replaces the free-text `tenancy.tenantContact` field.

It is the largest release in the project's history. Essentially all of the risk
is in the sync half, and the design below is shaped primarily around containing
it: the transfer unit is chosen so provider differences stay inside adapters,
and the merge logic is a pure function so the dangerous part is exhaustively
testable without a network.

## What is preserved

The ledger remains the source of truth for everything it derives. Generated
events stay derived — recomputed from loan, tenancy and document rows, never
materialised into a table. That is the property the correctness anchors depend
on, and it survives here intact: what gets stored is the _mapping_ between an
event and its remote counterpart, never the event itself.

The existing `CALENDAR_RULES` toggles, the `/ics/[token]` feed and the
`HomeProvider` registry pattern are all kept and extended rather than replaced.

## Scope

In scope:

- A shared household calendar: any member may create, edit and delete any
  event; each event records its author.
- Recurring events with RRULE, including per-occurrence exceptions (moved and
  cancelled).
- Two-way sync with iCloud (CalDAV) and Google Calendar, both behind one
  provider seam.
- Write-back from remote edits into the ledger rows that generated an event,
  where a binding exists.
- Module markers: generated events carry the owning module's emoji and a
  ` · Continuum` source tag; authored events may carry an optional category.
- A contacts module: name, photo, organisation, job title, phone, email,
  address, notes, category, and links to tenancies, properties, loans and
  accounts.

Out of scope, decided deliberately:

- **CardDAV contact sync.** Contacts are local. The vCard field split
  (`organisation` / `job_title` rather than one "work" string) is chosen so
  adding it later is a mapping exercise, not a migration.
- **Per-person or private calendars.** One shared household calendar. Private
  events would put a visibility check on every read _and write_ path; yuvomi
  shipped a real vulnerability here, where `PUT`/`DELETE` loaded rows by id
  alone and a guessed id edited someone else's private event.
- **Google push notifications (webhooks).** They need a publicly reachable
  HTTPS endpoint, which a self-hosted household usually does not have. Polling
  only.
- **Event colours.** Google exposes 11 fixed `colorId` values; CalDAV has no
  standard equivalent and Apple uses a proprietary property. Lossy and
  provider-specific. The emoji marker is the portable signal.
- **Exotic recurrence authoring.** The editor offers the patterns households
  actually use. A more exotic RRULE authored by a remote client round-trips
  correctly; we just do not offer to build one.
- **Fixing transaction search.** Contact search folds diacritics (see below);
  the existing `ilike` transaction search is a separate, known gap and is not
  touched here.

## Schema

Ten new tables and one dropped column: five for the calendar, one for contacts,
and four contact link tables.

```
calendar_event                          -- authored events only
  id           text primary key
  title        text not null
  notes        text
  category     text                     -- null, or a key from the category registry
  all_day      boolean not null
  starts_at    timestamptz not null
  ends_at      timestamptz not null
  tz           text not null            -- IANA zone, e.g. 'Europe/Prague'
  rrule        text                     -- null = single event
  created_by   text → person(id)
  created_at   timestamptz not null default now()
  updated_at   timestamptz not null     -- the merge clock
  deleted_at   timestamptz              -- tombstone
```

`tz` alongside `timestamptz` is not redundant. RRULE expansion is
timezone-dependent: "every Tuesday at 09:00" must stay 09:00 local across the
March and October DST transitions, and a series expanded purely in UTC drifts by
an hour for half the year. The zone the event was authored in is what makes
expansion correct.

```
calendar_event_exception
  id             text primary key
  event_id       text → calendar_event(id) on delete cascade
  recurrence_id  text not null          -- the ORIGINAL occurrence start
  cancelled      boolean not null default false
  title          text                   -- null = inherit from the series
  starts_at      timestamptz            -- null = inherit
  ends_at        timestamptz            -- null = inherit
  notes          text                   -- null = inherit
  unique (event_id, recurrence_id)
```

`recurrence_id` is the occurrence's _original_ start, never where it was moved
to. That is what RFC 5545 keys on and what both Google and CalDAV expect.
Storing the moved-to time is the bug that makes a rescheduled occurrence
resurrect itself on the next pass.

```
calendar_account
  id             text primary key
  provider       text not null          -- 'icloud' | 'google'
  label          text not null
  remote_cal_id  text
  credential     text not null          -- app password / OAuth refresh token
  cursor         text                   -- syncToken | sync-token | ctag
  last_sync_at   timestamptz
  last_error     text
  created_at     timestamptz not null default now()
```

A dedicated table rather than a `settings` key. Home Assistant config lives in
`settings` today, and `config-file.ts` keeps secrets out of the config export
via a whitelist. Calendar credentials should be excluded by construction, not by
remembering to maintain a list.

```
calendar_sync_link
  local_key    text not null            -- event uuid, or a gen: key
  account_id   text → calendar_account(id) on delete cascade
  remote_id    text not null
  remote_etag  text
  pushed_hash  text                     -- what we last sent → the merge base
  seen_hash    text                     -- remote content we last accepted
  suppressed_at timestamptz             -- generated event deleted remotely
  deleted_at   timestamptz              -- tombstone
  primary key (local_key, account_id)
```

```
calendar_conflict
  id           text primary key
  local_key    text not null
  account_id   text → calendar_account(id) on delete cascade
  detected_at  timestamptz not null default now()
  ours         jsonb not null
  theirs       jsonb not null
  resolution   text not null            -- 'local-won' | 'remote-won' | 'wrote-back'
```

```
contact
  id            text primary key
  name          text not null
  photo         text                    -- stored upload name, served via /files/[name]
  organisation  text                    -- work place
  job_title     text
  phone         text
  email         text
  address       text
  notes         text
  category      text
  created_at    timestamptz not null default now()
  updated_at    timestamptz not null
```

Link tables follow the existing `document_person` / `document_property`
convention — one explicit table per pair, composite primary key, cascade delete:
`contact_tenancy`, `contact_property`, `contact_loan`, `contact_account`. More
tables than a polymorphic design, but real foreign keys and typed end to end,
which is how document links already work.

`tenancy.tenant_contact` is dropped. The migration creates a contact per
non-empty value — `name` from `tenant_name`, the free text into `notes` — links
it to the tenancy, then drops the column. Same shape as
`0033_drop_seeded_rules`: a real data migration with conservative predicates
rather than a silent truncation.

## Event identity

Two-way sync requires stable identity on both sides. Authored events use their
UUID. Generated events get a deterministic key derived from what produced them:

```
gen:loanPayments:{loanId}:{2026-09}
gen:expiry:document:{documentId}
gen:propertyDates:tenancy:{tenancyId}:end
```

This also fixes an existing latent bug. `buildIcs` (`calendar.ts:228`) emits
UIDs as `${day}-${i}@continuum-ledger` — index-based within the generated array,
so adding a loan changes the UID of every later event on that day and
subscribers see delete-and-recreate. Cosmetic churn in a read-only feed; fatal
under two-way sync. The deterministic key replaces it in both places.

We supply the remote id on both providers: Google accepts a client-supplied `id`
on insert (base32hex, 5–1024 chars), and CalDAV lets us name the resource
`{uid}.ics` and set `UID:`. The remote id is therefore a deterministic encoding
of the local key, which makes `calendar_sync_link` a cache rather than the
source of truth — losing it triggers a rebuild, not a duplicate of every event
on someone's phone.

## Markers

Generated events render as `{emoji} {label} · Continuum`, where the emoji comes
from the module that owns the event. The mapping is not new data: `MODULES` in
`src/lib/modules/registry.ts` already carries an emoji per module, and the
origin binding (below) already identifies the owning module — `loan` → Loans
💳, `tenancy` → Property 🏢, `document` → Documents 🗂️. Rules with no binding
(import reminder, quarterly report) map from the rule key.

Deriving from the binding rather than the rule key matters for the `expiry`
rule, which spans leases, fixations, passports and policies and therefore has no
single owning module. Per-event derivation gives each the correct marker instead
of one blurred bucket.

Markers are composed at the edge, never stored. `LedgerEvent.label` stays clean;
decoration happens when rendering to ICS, Google and CalDAV. Storing decorated
text would make it permanent and would corrupt the content hash the merge
depends on. A single setting turns markers off, defaulting on.

The ` · Continuum` tag earns a second job: if `calendar_sync_link` is ever lost,
a full reconcile can recognise our own events on the remote rather than
duplicating them.

Authored events may carry an optional category, which supplies an emoji through
the same rendering path. They do not carry the source tag — that tag means
exactly "the ledger wrote this".

The authored-event categories are a small fixed registry declared alongside
`MODULES` in `src/lib/modules/registry.ts`, so both kinds of marker resolve
through one lookup: `{ key, label, emoji }`, seeded with household, money,
travel, health, admin and social. It is a registry rather than free-text emoji
so the marker keeps a reliable meaning, and rendering never has to validate
arbitrary user input on its way into a `SUMMARY` field.

## The provider seam

Modelled on `HomeProvider` (`src/lib/server/home/provider.ts`), including the
self-describing `ProviderField[]` so the Settings connect form renders itself
and no screen learns anything about Google or CalDAV.

```ts
export interface CalendarProvider {
	id: string;
	label: string;
	probe(): Promise<{ ok: boolean; detail: string }>;
	listCalendars(): Promise<RemoteCalendar[]>;
	pull(cursor: string | null): Promise<PullResult>;
	push(ops: PushOp[]): Promise<PushResult[]>;
}
```

**The unit of transfer is a whole series**, not an event. This is the decision
everything else depends on, because it is exactly where the providers disagree:

- CalDAV puts a recurring event and all its exceptions in _one_ resource — a
  single `.ics` containing the master `VEVENT` plus one `VEVENT` per
  `RECURRENCE-ID`.
- Google models each exception as a _separate_ event resource, tied back by
  `recurringEventId` + `originalStartTime`.

Syncing individual occurrences means understanding both models in the engine.
Making the unit "a series and all its exceptions, atomic" maps one-to-one onto
CalDAV and turns Google's fan-out into the Google adapter's private problem.

```ts
export interface EventSeries {
	uid: string;
	title: string;
	notes: string | null;
	category: string | null;
	allDay: boolean;
	startsAt: string;
	endsAt: string;
	tz: string;
	rrule: string | null;
	exceptions: SeriesException[];
	updatedAt: string;
}
```

`pull(cursor)` returns `{ changes, cursor, reset }`. The cursor is opaque.
`reset: true` means "this cursor is worthless, do a full reconcile" and covers
three distinct provider events uniformly: Google's `410 Gone` on an expired
`syncToken`, an invalidated CalDAV RFC 6578 sync-token, and a server with no
`sync-collection` support at all (where the adapter falls back to ctag-then-ETag
diffing). Putting it in the return type is what stops it becoming an unhandled
exception in a background job.

## The sync engine

A pass for one account: **pull → reconcile → merge → push → commit.**

Pull comes first. Pushing first overwrites remote changes not yet fetched — a
conflict that was never fetched cannot be detected. The cost is a local edit
landing mid-pass, handled by re-checking `updated_at` at push time and deferring
that event to the next pass.

**The merge is a pure function.** Given `(base, local, remote)` it returns an
outcome, with no network, no database and no clock. `base` is `pushed_hash`.

| local vs base | remote vs base | outcome                |
| ------------- | -------------- | ---------------------- |
| same          | same           | nothing                |
| changed       | same           | push local             |
| same          | changed        | apply remote           |
| changed       | changed        | conflict → rule below  |
| same          | deleted        | apply deletion locally |
| changed       | deleted        | conflict               |
| deleted       | same           | push deletion          |
| deleted       | deleted        | drop the link          |

**Hashing must normalise.** Strip the emoji prefix and ` · Continuum` suffix,
normalise line endings and iCalendar line folding, and drop provider-added
fields — Google returns `etag`, `updated`, `iCalUID` and its own sequence
numbers on everything it hands back. Missing this makes every event compare as
changed on every pass: the engine pushes, the remote echoes, and it pushes
again. That loop is the most common way this class of feature fails, and it
fails quietly, as rate-limit exhaustion rather than an error.

**Conflict rule.** Authored events: last-writer-wins on `updated_at` versus the
remote's modification time; the discarded version is written to
`calendar_conflict` and surfaced as a briefing item. Generated events: the
ledger wins, except a _pure date move_ — the remote series differing from what
we pushed in start/end only, everything else equal after normalisation — which
triggers write-back. Any other edit is re-asserted from ledger data.

**Deleting a generated event is honoured, not overruled.** If someone deletes
the ČS payment from their phone and the ledger re-creates it next pass, the app
is arguing with its user. Instead `suppressed_at` is set on the link: the event
stops being pushed to that account, and Continuum's own calendar shows it greyed
with "hidden from synced calendars". Visible state, reversible from the app.

**Crash safety.** The cursor advances last, inside the same transaction that
applies the pull, so a pass that dies halfway re-fetches rather than skips.
Pushes are idempotent because we own the remote id: a repeated create is a
conditional PUT and a `412` means "already there", not an error. One
transaction-scoped advisory lock per account prevents overlapping passes — the
same technique transfer pairing already uses. A failing account records
`last_error` and backs off exponentially without blocking the other.

**Scheduling.** Poll on a configurable interval, default 15 minutes, plus a
"sync now" action and a debounced push after local writes.

**Generated-event horizon.** Loan payments push as individual dated events over
a rolling `[today − 90d, today + 365d]` window rather than one RRULE series: the
amount is part of the title and changes per fixation period, and the payment day
clamps to month length, so no single RRULE describes them honestly. Events
falling off the trailing edge are left in place — deleting someone's history
from their own calendar is not ours to do.

## Write-back and origin bindings

Each generated event declares an origin binding:

```ts
interface OriginBinding {
	table: 'loan' | 'tenancy' | 'document';
	rowId: string;
	field: string; // 'paymentDay' | 'endDate' | 'renewalNoticeDate' | 'expiresOn'
}
```

A pure date move on a bound event writes that field, in one transaction, with
the change recorded in `calendar_conflict` as `wrote-back`. Events with no
binding — the import reminder and the quarterly XTB report are schedule rules
with no row behind them — are re-asserted. Amounts and labels are never written
back: dragging a date is a fact about scheduling; editing "24 310 Kč" in a title
is not a fact about the amortisation schedule.

`loan.paymentDay` has a consequence worth stating explicitly in the UI.
It is a day-of-month integer, so moving _September's_ payment from the 15th to
the 20th can only be expressed as "the payment day is now the 20th" — every
month moves, not just the one that was dragged. Decision: apply it, and raise a
briefing item saying so in those terms. `tenancy.end_date`,
`tenancy.renewal_notice_date` and `document.expires_on` are single dates on
single rows and are unambiguous.

## Contacts

A new module: one entry in `src/lib/modules/registry.ts` (📇 Contacts) plus a
nav item; the Settings toggle then appears on its own, which is the contract the
registry already promises. Route `/contacts` with a list and a detail view,
photo upload through `saveUpload`, and links out to the tenancies, properties,
loans and accounts a contact is attached to.

Two details that are easy to get wrong:

- **Photo replacement must call `removeUpload`** on the previous `storedName`,
  or every re-upload orphans a file on the data volume permanently.
- **`.svg` is in the upload allowlist** (`files.ts:62`). It is inert inside an
  `<img>`, which is how an avatar renders, but `/files/[name]` also serves it
  directly and a navigated SVG can execute script. Either exclude SVG for
  avatars or confirm the existing CSP covers the direct-navigation case before
  shipping.

**Contact search folds diacritics** — Postgres `unaccent` with an expression
index, scoped to `contact`. An address book that cannot find Řehoř unless you
type the háček is broken on arrival for this household. The existing `ilike`
transaction search has the same defect and is explicitly out of scope; the point
is not to ship a _new_ search with it.

## UI surfaces

The calendar screen gains event creation, editing, deletion and a detail panel,
plus two components carrying real complexity:

- **An RRULE editor.** Daily; weekly on chosen weekdays; monthly by date;
  monthly by weekday position; yearly — each with an end condition. Stores the
  RFC 5545 string.
- **"This event / this and following / all events".** The middle option is not
  an exception: it truncates the original series with `UNTIL` at the split point
  and creates a new series from there. Modelling it as an exception
  desynchronises immediately, because the remote will disagree about which
  occurrences the original series still owns.

Settings gains a Calendar accounts panel — connect, choose the remote calendar,
sync now, last sync time, last error, disconnect — rendered from
`ProviderField[]` exactly as the Home Assistant form is, plus the emoji-marker
toggle. The existing `CALENDAR_RULES` switches stay where they are.

### The Google setup cost

iCloud needs one app-specific password pasted into a form.

Google costs nothing in money. The Calendar API is free, with a quota of
1,000,000 requests/day and no billing account required beneath it. This design
polls at 15-minute intervals — roughly 100–200 requests/day per account, about
0.02% of the quota. (Google has announced that exceeding quota will incur
charges later in 2026, with 90 days' notice; at three orders of magnitude below
the limit this does not affect us.)

The cost is setup. Each household creates their own Google Cloud project,
enables the Calendar API, configures an OAuth consent screen, creates OAuth 2.0
credentials, and pastes the client ID and secret into Settings — because Google
will not verify a self-hosted app on behalf of every user who installs it.

**The publishing status is a trap and the setup guide must lead with it.**
Calendar scopes are classified sensitive. With the consent screen left at
`Testing`, Google expires every refresh token after exactly 7 days: sync works
for a week, then stops silently, and keeps stopping every week. Setting the
publishing status to `In production` makes refresh token lifetime indefinite and
does **not** require verification.

Remaining in production while unverified costs only an "unverified app" warning
screen before the consent dialog (click through once per person via Advanced),
and a 100-user lifetime cap on the project — irrelevant for a household using
its own project. Full verification exists to remove the warning for apps
distributed to strangers and is explicitly out of scope: the household is both
the developer and the only user.

If the household is on Google Workspace, setting the consent screen user type to
`Internal` removes the warning, the user cap and the 7-day rule entirely.

Note that Home Assistant's Google Calendar integration requires the identical
setup, so a household already running the Home Assistant provider may have a
Cloud project to reuse — enable the API and add a second OAuth client.

None of this is a reason to drop Google, but the Google path needs a real setup
guide in `docs/`, and iCloud is the one most people will finish connecting.
That, not the protocol difficulty, is why iCloud comes first in the build
order — a wrong click in the Google setup produces a failure that only appears
a week later.

## Briefing and documentation

Two new sources appended to `SOURCES` in `src/lib/server/briefing.ts`:
discarded edits from `calendar_conflict` (including write-backs), and an account
that has failed to sync for several consecutive passes. Both are exactly the
kind of thing that must not fail silently.

`ARCHITECTURE.md` gains a calendar-provider row in the seam table and
correctness anchors for the three invariants this release lives or dies by:
deterministic identity on both sides, the merge as a pure function, and
no-duplicates / no-resurrection.

## Testing

- **The merge function**, table-driven across all eight rows plus the
  recurrence-exception variants. Pure, fast, exhaustive.
- **A fake in-memory `CalendarProvider`** for engine tests: create, edit and
  delete on both sides; conflicts; cursor reset; crash-and-resume.
- **Recorded Google and CalDAV payloads as fixtures**, following the pattern the
  bank adapters already use against real statements.
- **A convergence test** over randomised interleavings of local and remote
  edits, asserting the two invariants that matter: no duplicates, and nothing
  deleted ever resurrects.
- **Write-back tests** per binding, including the `loan.paymentDay` fan-out.
- **E2E**: create a recurring event, edit one occurrence, sync against the fake
  provider, confirm the exception survives a round trip.

## Build order

1. Contacts — fully independent, ships value immediately, no sync risk.
2. `calendar_event` + exceptions + the writable calendar UI, with RRULE.
3. Deterministic keys and the `buildIcs` UID fix.
4. The merge function and the fake provider — the engine, proven with no network.
5. iCloud CalDAV adapter.
6. Google adapter behind the same seam.
7. Write-back and origin bindings.
8. Briefing sources, docs, ARCHITECTURE.

If the release needs to be cut, the clean line is after step 5: contacts,
writable calendar and iCloud in v0.3.7, Google in v0.3.8 behind the same seam.
The design does not change; only how much lands at once.

## Risks

- **The push loop.** Insufficient hash normalisation causes silent, endless
  pushing. Mitigated by normalising in one place and asserting idempotence in
  the convergence test (a second pass over unchanged state must issue zero
  writes).
- **Recurrence exceptions.** The most likely source of duplicates and
  resurrection, and the two providers model them differently. Mitigated by the
  series-as-unit boundary and by testing exceptions explicitly rather than as a
  variant of the simple case.
- **Write-back into ledger data.** A calendar client becomes a write path into
  mortgage and lease data. Mitigated by restricting it to date fields on bound
  rows, recording every write-back, and announcing the `paymentDay` fan-out.
- **Scope.** Nine tables, two protocols, RRULE with exceptions, bidirectional
  write-back and a new module in one release. The build order above exists so
  the cut line is known in advance rather than discovered late.
