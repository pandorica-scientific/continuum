# 📓 Changelog

✨ Added · 🔧 Changed · 🐛 Fixed · 🔒 Security · ⬆️ Upgrading

## 0.3.9 — 2026-08-19

> The schema settled into one baseline with its rules enforced by tests, the server code given a place for everything, and every file stamped with its licence.

### ✨ Added

- 🧱 One baseline migration replaces fifty-six, and the schema is additive-only from here
- 🧮 `net_worth_component` — every valued thing in one view, with the liabilities-are-negative rule applied once, so a new asset type reaches net worth by adding a UNION branch
- 🔒 A CHECK constraint for all 22 enum columns, generated from the same TypeScript list the screens read, with a test that fails if the two ever disagree
- 💱 A currency table materialised from CLDR, with foreign keys from every one of the fourteen columns that name a currency
- 🧬 An `entity` supertype: one link table can point at any kind of record and still keep a real foreign key at both ends
- 🗂️ Thirteen link tables collapsed into three — `tag_link`, `document_link`, `contact_link`
- ⚙️ One `job` table with lease semantics, replacing the import queue and the calendar sync lease that had each invented their own
- 🆔 UUID primary keys, minted time-ordered so they sort by creation
- 📇 A covering index for every foreign key, held there by a test
- 📜 An SPDX licence header on all 294 source files, kept there by a lint rule
- 🧭 The app version and whether it is running under Docker, at the foot of the sidebar

### 🔧 Changed

- 🌓 The theme belongs to the person, not the browser — it follows you between devices instead of being shared by everyone using the same laptop
- 📐 Money is `*_minor` and always `bigint`, a date is `*_on`, an instant is `*_at` — all four asserted against `information_schema`
- 📁 Every server domain is a directory with an entry point; cross-cutting plumbing moved to `system/`, and a test keeps `src/lib/server` free of loose files
- 🧹 Five unreachable exports deleted and 178 declarations un-exported — a module's surface is now what other modules actually use
- 🏃 CI runs the browser suite in the Playwright image, so no step waits on a package mirror

### 🐛 Fixed

- 🏠 The sidebar stays put and fills the screen at every size; it used to scroll away with the page on a landscape tablet
- 🎨 Pulling past the top or bottom showed white — the browser paints that area from `theme-color`, which was never set
- 🧾 A statement could be filed with no record of what read it: `import_file.proof_class` and `source_method` were NOT NULL in the database and nullable in the schema
- 🔁 Filed transactions were unreachable by any register filter, because the review-state list omitted `filed`
- 💸 `refreshRates` inserted whatever currency code the feed offered, leaking unvalidated codes into the selectable list
- 📄 A document filed against a flat assumed the first link was a person

**⬆️ Upgrading:** ⚠️ **a clean break — 0.3.9 will not start on an 0.3.8 database, and a backup does not carry the data across.** The whole migration chain is replaced by one baseline, so a database that stopped at `0045` fails on boot with `CREATE TABLE "currency"` already existing; and an 0.3.8 backup is a column-by-column `COPY` naming tables and columns this release renamed or removed. Start 0.3.9 on an empty database. This is affordable exactly once, because nothing was running 0.3.8 yet — from this baseline the schema is additive-only, and every release after it upgrades in place.

## 0.3.8 — 2026-08-19

> A reader that works out a statement's layout from the file itself, and files nothing it cannot check against the statement's own arithmetic.

### ✨ Added

- 🏦 Any bank's statement, without being told which bank — ten institutions across four countries, no bank-specific code
- 📑 CAMT.053, MT940, ABO/GPC and OFX/QFX read directly; QIF refused on purpose, because it carries nothing to check
- 📄 PDF tables recovered by two competing assemblers, with the proof engine picking the winner
- 📷 Photographs and scans read from the page image when the text layer cannot be proven — never spliced with it
- 🧮 Every reading proved against the statement's own figures before filing; what cannot be proven is refused
- 🧭 A wizard for a layout that cannot prove itself: name two columns once, and that bank arrives understood after
- ⏳ Imports run in the background, and a reader interrupted by a restart is picked up rather than lost
- 🔎 Provenance on every transaction — method, proof class, checks run — filterable in the register
- 🧪 A 294-file corpus across 24 locales and 20 currencies runs in CI

### 🔧 Changed

- 🔌 The bank adapters are a fast path now, not load-bearing — every one of their statements verified without them
- 🛡️ Uploads are checked before they are parsed: zip bombs and denial-of-service workbooks stopped at the door
- ⚖️ A statement that proves only its endpoints asks once — two offsetting omissions leave exactly that picture
- 📦 A statement is all-or-nothing; a partial import used to strand the rest as a duplicate forever

### 🐛 Fixed

- 🧮 The OFX endpoint check could not fail — it derived the opening balance, turning the test into "closing equals closing"
- ⛓️ A printed running balance that did not follow from the movements was still filed, carrying a record saying so
- 📅 A date could be read as an amount: `01.01.2025` became an opening balance of 1,012,025.00
- ➕ Credits written `+249,00`, and amounts using a typographic minus, were read as "not a figure"
- 🛡️ The archive safety check was skipped on the one path that needed it most — the "map the columns" button
- 📅 A statement with dates in several columns could have the fullest one passed over
- 🔁 Two imports could read the same file at once, surfacing as a raw database error on a clean import
- 🇵🇱 Accent folding did not fold `ł`, so a Polish summary line could be filed as a transaction
- ⚡ The import screen re-read every queued file's contents every 1.5 seconds to show seven small fields
- 💴 A gap in a zero-decimal currency printed as though it had decimals — 100,000 JPY reported as 1000.00
- 🏦 Choosing the right account for your own statement was refused, merging unrelated banks and splitting real accounts
- 🗓️ A statement printing an American date range imported four months out; an ambiguous period now says nothing
- 📷 A statement read from a photograph was recorded as read from text, so the register's filter never matched

## 0.3.7 — 2026-08-17

> A contacts module, and a calendar you can write in that stays in step with iCloud and Google.

### ✨ Added

- 👥 Contacts — people and companies, linked to the tenancies, properties, loans and accounts they touch
- 🔤 Contact search folds diacritics, so `rehor` finds Řehoř and `lukasz` finds Łukasz
- 📅 A writable shared calendar with full recurrence, and edits to one occurrence, this-and-later, or the series
- 🔄 Two-way sync with iCloud, any CalDAV server, and Google Calendar
- 🏷️ Continuum's own events are marked, so a mortgage payment is tellable from "dentist, 3pm"
- ✍️ Moving a loan payment, lease end, renewal notice or document expiry in a connected calendar writes the date back
- 🚨 Error screens that say what happened and what to do, with a reference on a 500 and no stack in the browser
- ⓘ Setup instructions moved behind an info icon, so headings stay short

### 🔧 Changed

- ➕ One quick-add button on every screen, replacing the header's Import statement button
- 📗 Google's setup instructions rewritten from a connection that worked, in the order it worked in

### 🐛 Fixed

- 🆔 The published `.ics` feed numbered UIDs by position, so adding a loan renumbered every later event that day
- 🆔 A lease end and its renewal notice shared one UID, so a subscriber saw only one of them

_The rest came out of connecting real iCloud and Google accounts. Every one was silent: tests, type checker and a code review all passed over them._

- 🚫 Google refused every event — RFC 5545 makes an all-day `DTEND` exclusive, and iCloud had tolerated the difference
- 🔁 Sync rewrote every event, every pass, forever: titles were pushed with a marker but hashed without it
- 📥 Events created in iCloud or Google never arrived, because reconciliation only walked local events
- 🔒 A single rejected write wedged that event for good on a stale ETag
- 🤫 A failed push reported success — refusals that were not conflicts were counted and discarded
- 🍎 No iCloud calendar could be chosen: discovery took the first `href` rather than the principal's own
- 🚫 "Choose a calendar" did nothing on Google; the narrow scope forbids listing, so it creates one instead
- 💱 Approximate exchange rates blamed the internet; a missing past rate and an unknown currency are now told apart
- 📜 A white bar down every scrolling page, and a floating button that jumped as the scrollbar came and went
- ⓘ The info bubble was unreadable and opened off the edge of the screen

_And these came out of a review of the sync engine. None had a test; several would have destroyed data quietly._

- 💥 One conflict wedged an account for good — a NULL into a NOT NULL column rolled back every pass, every minute
- 🗑️ An expired Google sync token deleted a year of events; silence is no longer taken as deletion
- 🗑️ Past mortgage payments were deleted from the household's own calendar, one per loan per month
- 📆 A payment day was rewritten on every pass — a loan paid on the 31st was moved to the 28th by February
- 🗑️ Deleting an event on a phone did nothing, and a Continuum event deliberately deleted came back
- 🚫 No recurring event with an exception ever reached Google — its override ids used a character Google refuses
- 💥 A remote change to a recurring event destroyed its exceptions
- 📆 Weekly events from other calendars lost three of every four occurrences
- 🕐 New events were saved in the server's timezone, walking forward with each edit
- ✂️ "This and following" lost overrides and gave the second half the original occurrence count
- 🔁 Two sync passes could run at once — the lock was taken outside any transaction and excluded nothing
- 🤫 A failed delete was recorded as a success, orphaning the event and making sure nothing tried again
- 📝 A rejected contact form pre-filled the next contact opened, and saving wrote it onto that person's row
- 🔕 Dismissing the harmless exchange-rate warning silenced the serious one for the same currency, for a year
- 🚩 Nothing could clear a sync conflict, so the first one stayed up permanently
- 📜 Sync events carried a timezone declaration RFC 5545 forbids, which a strict client may refuse
- ⚙️ How often calendars are polled could be read but never set — it is a field in Settings now

### ⬆️ Upgrading

- 🗃️ **`tenancy.tenantContact` is gone.** The migration first creates a real contact from each non-empty value — named after the tenant, original text preserved verbatim in the notes — and links it to the tenancy. Nothing is parsed or guessed at, but how to reach a tenant now lives in Contacts.
- 🗃️ **PostgreSQL needs the `unaccent` extension.** Migration `0036` runs it, which requires rights the application user may not have. If the migration stops there, have someone with the rights run this once, then update again:

  ```sql
  create extension if not exists unaccent;
  ```

  The stock `postgres:17-alpine` image in `compose.yaml` needs nothing extra.

- 🗃️ **Migration `0041`** adds one nullable column to `calendar_account`. Nothing is rewritten and no existing data is touched.

## 0.3.6 — 2026-08-16

> A colour pass over both themes, and a run of fixes found by using the thing.

### 🐛 Fixed

- 🏠 Saving anything about a property silently switched you to a different flat — tied timestamps with no tiebreak
- 👥 "Person one" and "person two" could swap between loads, changing whose birth year fed the retirement projection
- 🧩 A panel whose module was switched off could leave a band of empty space at the top of the Overview
- ↕️ The move-up and move-down buttons on a narrow Overview did nothing
- 🧩 Adding a panel dropped you out of Customise mode, and threw away the "not saved" notice with it
- 📊 The cash-flow waterfall stopped at 880 pixels and left the rest of a wider card empty

### ✨ Added

- 🗑️ A photo can be removed, not only replaced — two taps, since it deletes the file
- 📈 The retirement chart has years along the bottom, and marks the year the pot clears the target
- 🧮 A new fixation fills in the half you did not type, solved against the same amortisation the app books interest with

### 🔧 Changed

- 📊 The cash-flow chart is a Sankey that lays out in the pixels it has, dropping columns rather than shrinking type
- 🎨 Both palettes rebuilt and both now meet WCAG AA — ten checks had been failing, one as low as 2.87:1
- 🌈 Each area has its own colour, on its sidebar icon and beside the screen title
- 📥 Import statement appears only on Overview and Money, not on screens where it means nothing
- 📐 Fields in the loan dialogs line up when a label wraps to two lines

## 0.3.5 — 2026-08-16

> The Overview stops being a screen somebody else designed and becomes a board you build — and because the arrangement belongs to your profile, two people sharing an install no longer share a dashboard.

**⬆️ Upgrading:** migration `0034` adds one nullable column to `person`; nothing is rewritten. Nobody's screen changes on upgrade — the default arrangement is the previous Overview exactly, and the board arrives when you press **Customise**. Take a backup before replacing the image.

### ✨ Added

- 🧩 The Overview is a twelve-column board — drag to move, drag the corner to resize, ✕ to remove, a tray to add
- ⬆️ The board has gravity: move a panel away and everything below rises, so no empty band is left in the middle
- 🧩 Thirteen panels, up from the fixed screen's four; panels of a switched-off module are not offered
- 👤 The board follows you, not your browser — stored against your profile, not in Settings or the config export
- 📱 A narrow screen stacks the board into one column and swaps resizing for move up and move down
- 🧭 The sidebar lists seven areas instead of twelve screens, with each area's screens as tabs under the title
- ➕ A quick-add button on every screen
- 🎨 Drawn SVG icons in place of emoji in the navigation — in the bundle, not a font and not a CDN fetch

### 🔧 Changed

- 📊 The cash-flow waterfall scales to fit instead of scrolling sideways below 880 pixels
- ⚡ A panel's data is computed only when that panel is on your board
- ♻️ The retirement projection's inputs moved into one shared module, rather than two copies drifting apart

### 🔒 Security

- 📗 `xlsx` moved to 0.20.3 from SheetJS's own distribution — 0.18.5 carried prototype pollution and a ReDoS
- 📦 npm removed from the shipped image, taking three high-severity advisories and 18MB with it

### 🐛 Fixed

- 🔗 The Overview offered a link to a switched-off Calendar, which led to a 404
- 🔗 Every screen offered Import statement with the Import module switched off
- 💥 A panel that could not load took the whole Overview down with it — and stayed that way, since placement is saved
- 🧩 Switching two panel-owning modules off left a band of empty space at the top of the board
- 📊 The cash-flow waterfall stopped at 880 pixels and left the rest of a wider card empty

## 0.3.4 — 2026-08-15

> A pass over the first-run experience: the setup wizard, what a fresh install starts with, and the controls that had kept their browser defaults.

**⬆️ Upgrading:** migration `0033` retires the shipped starter rules — those nobody ever accepted or corrected are removed, and any that earned a record are kept and relabelled as learned. Take a backup before replacing the image.

### 🐛 Fixed

- 🧙 The setup wizard showed one module with no name, and threw away everything typed when it refused a submission
- 🎨 A file field's "Choose File" button ignored the theme, since the browser draws it itself
- 🔑 Nothing explained why passkeys were missing on a plain-HTTP deployment — the section was hidden without a word

### 🔧 Changed

- 🔐 The Tailscale sidecar runs by default, so a stock install has HTTPS and therefore passkeys; still tailnet-only
- 📋 An install no longer ships 42 starter rules — every rule is earned from a correction someone actually made

## 0.3.3 — 2026-08-15

> A correctness and simplification pass over the paths that move money or credentials: races that only appeared when two requests arrived together, and multi-row changes that now commit as one unit.

**⬆️ Upgrading:** migrations `0027`–`0032` run automatically — repairing legacy fingerprints and transfer claims, adding authentication-concurrency guards, enforcing one smart-meter bill per property, and binding legacy settings to explicit currencies. With more than one lived-in property, `0032` binds the home integration to the oldest; open Home settings once and confirm it. Take a backup before replacing the image.

### 🐛 Fixed

- 🏦 Overlapping or simultaneous imports could create duplicate accounts and transactions
- 🔑 Old fingerprints could disagree with the current parser; the repair preserves categories, splits and tags
- 🔁 Transfer pairing had timing holes, and could overwrite a transaction a person had already filed or split
- 🧾 The transaction register and its totals could disagree beyond one page
- ✂️ Split and tag edits could leave partial or contradictory state
- 💱 Several cross-currency figures mixed raw minor units; each operand now converts at its effective date
- 📈 Broker reports could replay stale holdings or resurrect closed positions
- 💰 Loan actions accepted impossible chronology and inconsistent balances
- 🏠 Property figures and edits could lose data, or duplicate debt between properties
- 🧮 A shared mortgage could report one minor unit more debt than it carries — both halves of a 50/50 split rounded up
- 🏷️ A tag on a transfer leg totalled zero, while the register still showed the chip on that row
- 📉 The month-on-month net-worth delta could vanish on the 1st, or measure only the days since the last restart
- 📈 Backfilling an older broker report recorded no value point
- 💰 Saving a re-fixation destroyed later agreed periods the bank had already committed to
- 🌍 Non-Czech accounts never matched their own IBAN, so own transfers stopped pairing and imports minted duplicates
- ⚡ Filing one transaction scanned the whole ledger; the pass is now bounded to the days around what changed
- 🏖️ One out-of-range retirement assumption stopped the page saving anything, behind one generic line
- ⚙️ Importing a configuration file could be silently undone by an open tab
- 📥 An account chosen for one upload was applied to the next
- 🔌 Smart-meter sync could target the wrong flat, the wrong bill, or a configuration that changed mid-flight
- 🗃️ Documents, bills, tax statements and rule edits used several commits for one action
- 🏖️ Retirement autosave could persist an older request last, or silently ignore another tab
- 🚨 Form and upload failures were hidden behind dialogs or discarded local state
- ♿ Keyboard and assistive-technology users could still reach hidden UI
- 💱 Editing an older payslip could silently change its currency

### 🔒 Security

- 🥇 Initial setup is a single database claim, so concurrent requests cannot create two first administrators
- 🔄 Password changes and deactivation advance an authentication generation, closing in-flight sign-in races
- 🎟️ Enrollment consumption, the active-person check, password creation and session issuance are one transition
- 🚦 Passkey challenges have their own rate budget; login limiting is keyed per account, not per address
- 🚪 Bearer authentication is enforced once at the whole `/api` boundary, so it fails closed for future endpoints

### 🔧 Changed

- ♻️ Coherent writes live in reusable server-domain modules; page actions translate form data instead of orchestrating
- ♻️ Repeated client behaviour shared through upload, action-error, autosave, overlay and loan-scenario primitives
- 🏖️ Retirement assumptions gain contribution-growth and property-growth controls
- 🗃️ A consolidated schema snapshot, plus a regression holding migrations to it column by column

## 0.3.2 — 2026-08-15

> Two rounds of whole-codebase review, and the repairs the second found in the first. The theme is figures that were wrong without saying so.

**⬆️ Upgrading:** migration `0023` rescales stored amounts for currencies without two minor units, and `FINGERPRINT_VERSION` moves to 3 for the same reason — both no-ops for CZK, EUR, USD, PLN and every other two-decimal currency. If you have pointed the smart meter at a bill, you will need to say which line it feeds.

### 🐛 Fixed

- 💥 The cash-flow waterfall could hang the whole server — a synchronous infinite loop on the one Node thread
- 💥 A sixty-byte floor plan could exhaust the heap
- 💥 A failed boot was cached forever, so one unreachable database outlived its own outage
- 🔁 Confirming a transfer could resurrect a rejected one and erase a category — an unparenthesised `or` in raw SQL
- 🔁 Transfers proposed during an import vanished and stayed double-counted
- 💯 Amounts were scaled by a hardcoded hundred in half the app, which only worked while every currency had two decimals
- 📄 One stray quote mark swallowed the rest of a CSV — `NAKUP 27" MONITOR` ate the delimiter after it
- 📄 A wrapped payment note dropped its transaction, split in half between two splitters that disagreed
- 📄 Uploaded PDFs opened as a blank tab, blocked by a `sandbox` token in their own policy
- 💱 An unknown exchange rate was treated as one-to-one — 10,000 EUR counted as 100 CZK, with nothing said
- 💰 A repayment's saved projection disagreed with its preview by one instalment
- 🔤 Rules containing an accent or punctuation could never match — "Rohlík" never matched ROHLIK.CZ
- 💷 An English payslip was read a thousand times too small: `45,231.00` filed as 45.23
- 📅 Five months a year vanished from the salary history, because `\b` is ASCII-only in JavaScript
- 🏦 The Raiffeisenbank parser lost a quarter of its references to fixed offsets
- 🏦 The Česká spořitelna parser invented payment symbols — fifty of sixty on a real statement were dates
- 🏦 A statement merely mentioning another bank was parsed as that bank's, minting an account and blocking re-import
- 🔌 The smart meter reading could be a thousand times out, assuming kWh where Shelly and Tasmota report Wh
- 💾 Hovering the sidebar wrote to the database, via preload on the home page's loader
- 🕐 The month-to-date reading could span two months, and that figure is persisted as money hourly
- 🔌 A meter reset read as a month of nobody being home
- ✂️ The split write path was three separate commits, so a failure left a transaction with no lines
- 🧾 The register's totals hit Postgres's 65,535 bind-parameter ceiling
- 💥 A large page number returned a 500 — `?page=1e21` reached SQL as `OFFSET 5e+22`
- 💾 The read-only API wrote a snapshot on every poll
- 📤 Uploads over 512 KB failed with a bare 413, before any of the app's code ran
- 💾 The backup destination was stored with no validation, though the dump holds every password hash

### 🔒 Security

- 🔑 A passkey assertion could be replayed indefinitely — challenges are now recorded when issued and spent when used
- 🔑 Changing a password did not remove passkeys, so a stolen cookie could outlive the change
- 🚦 Eight bad attempts could lock out the whole household, since Tailscale puts everyone behind one address
- 📎 Uploaded files are served with a content-security policy and `nosniff`, so a scripted SVG is inert

### 🔧 Changed

- 🔌 The meter no longer invents a bill line — which line it feeds is the household's choice, made on the property card
- 🧪 CI runs the end-to-end suite; it existed and nothing executed it
- 🗃️ `person.role` is constrained in the database, and session and credential foreign keys are indexed
- 🧙 The setup wizard writes its people and settings as one transaction

## 0.3.1 — 2026-08-14

> Hardening the accounts work in 0.3.0 — three rounds of review closing the gaps between what the code did and what the README promised.

### 🐛 Fixed

- 🔓 Settings export needed no administrator, so any member could download the file naming the backup path
- 👥 The household roster told members everyone's role, birth year and which accounts had a live enrollment link
- 🎟️ Deactivation left enrollment links live, so whoever held the URL could still set a password
- 🎟️ An expired enrollment link was stamped used on its way to being rejected
- 🔑 A trailing slash in `ORIGIN` broke every passkey, with an error that named nothing
- 🔑 Cloned-authenticator detection never ran, and the rule that pre-empted it would have locked out synced passkeys
- 🗃️ A refused role change or deactivation still committed its transaction
- 🧪 The end-to-end suite's cold build could exceed the web server's sixty-second default and abort the run
- 📖 The README's Tailscale instructions proxied the in-container port rather than the published one
- 👑 An administrator who had never enrolled counted as one, letting the only real one demote themselves
- 💥 A crafted credential id was an uncounted, unrate-limited 500, reachable unauthenticated
- 🎟️ Two enrollment links could be live for one person, so a URL sent to the wrong address kept working
- 🎟️ A link was honoured against an account that had already been enrolled
- 🎟️ A new link could be minted for a closed account, then refused with wording that blamed the URL
- 👥 The sign-in picker listed people who could not sign in, spending the household's shared attempt budget
- 👑 A refusal could name the wrong person as the last administrator
- ⏱️ How long a sign-in failed revealed what kind of account it was, defeating the identical wording
- 📱 The add-person form kept four columns on a phone

### 🔧 Changed

- ⚙️ `PASSWORD_MIN_LENGTH` and `ENROLLMENT_LINK_DAYS` are configurable, with the previous values as defaults
- 🔑 Changing your password now says so, and confirms that other devices were signed out
- ♻️ The two passkey buttons share one ceremony helper, rather than two copies of the same exception list
- 👑 Administrator enforcement on the settings page is applied once, not repeated at the top of each action
- ⚡ A member's settings page no longer fetches the three things only administrators see
- ♻️ Sessions, API tokens and enrollment links share one token-hashing function

## 0.3.0 — 2026-08-14

> Accounts you can actually manage, and a way in that is not a password.

### ✨ Added

- 🔑 Passkeys — Face ID, Touch ID or Windows Hello alongside passwords, which are staying; no lockout risk
- 🎟️ Enrollment links: adding a person produces a one-time link, valid seven days, so they choose their own password
- 🔑 Change your own password from Settings, revoking every other session for that person
- 🚫 Deactivate and reactivate a person — sign-in blocked, history kept, so reactivating is a clean undo
- 👑 An administrator role that means something; the last administrator can be neither deactivated nor demoted
- 🚪 A sign-out control in the sidebar — `/logout` had existed since the first release with nothing linking to it
- 🔐 Optional Tailscale sidecar terminating HTTPS, which is what makes passkeys possible; tailnet-only

### 🔧 Changed

- 🗃️ `person.role` is now the permission field with exactly two values, having been incoherent across four places
- 🗃️ `person.password_hash` is nullable, so a person can exist between being created and choosing a password
- 🧪 The end-to-end suite builds the app before running, instead of serving whatever was last compiled
- 🔑 Passkeys require user verification rather than merely preferring it, since the server already enforced it
- 🚪 Signing in ends whatever session the browser arrived with

### ⬆️ Upgrading from 0.2.x

Existing people carry `role = 'adult'`, which is neither `admin` nor `member`. Migration `0020` turns every such row into an administrator — before 0.3.0 anyone who could sign in could do anything, so this takes no capability away. Demote whoever should be a member afterwards. `docker compose pull && docker compose up -d` is the whole upgrade.

## 0.2.1 — 2026-08-14

> Reachable by name.

### 🔧 Changed

- 🌐 The server sits on plain port 80 by default, so the whole address is `http://continuum.local`
- 📖 The README documents the local-name setup end to end: DHCP reservation, mDNS name, and the matching `ORIGIN`

## 0.2.0 — 2026-08-14

> The ledger grew from watching money to working with it.

### ✨ Added

- 🧾 Transaction register — every row, searchable by text, date, account, category, amount and tag
- ✂️ Splits — one payment divided between categories, balanced live and refusing to save otherwise
- 🏷️ Tags across transactions, split lines, documents, properties and loans, each with a running total
- ⚙️ Rules engine with ANDed conditions, each rule's confidence earned from how its suggestions survived correction
- 🔌 Read-only JSON API behind bearer tokens — integer minor units plus a currency code, never a float
- 📊 Tax statements per person and country, with free labelled lines instead of a hard-coded jurisdiction
- 🔗 Entity links — a document always belongs to something real, through typed join tables

### 🔧 Changed

- 📥 Import review pre-selects the engine's suggested category instead of arriving empty
- 🗃️ The old single-matcher categoriser and the free-text document subject are gone; both migrations are lossless
- 🎨 Base control styling lives once in `app.css` instead of being restated per screen

### 🐛 Fixed

- 💱 Amount filters compare exactly across currencies with different minor-unit scales, without floats
- 🔤 Subjects are case-insensitively unique; existing case-duplicates are merged by migration
- ⚙️ The rules screen no longer presents a rule's starter prior as history

## 0.1.0 — 2026-08-13

> First published version.

- 🧙 Setup wizard and per-person sign-in
- 🏦 Statement import for five banks, with dedup, transfer pairing and correction-learning categorisation
- 📊 Cash-flow waterfall
- 💱 Multi-currency accounts with daily CNB rates
- 🏠 Property with tenancies, floor plans and bills
- 💰 Loans with fixation-period interest verified to the haléř
- 📈 XTB investment imports
- 🏖️ Retirement projection with a payslip-fed salary tracker
- 📄 Documents with shelves and expiry
- 📅 Generated calendar with an ics feed
- 🏡 Home Assistant provider seam
- 💾 Scheduled backups and demo mode
