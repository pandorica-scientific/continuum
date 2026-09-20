# 📓 Changelog

✨ Added · 🔧 Changed · 🐛 Fixed · 🔒 Security

## 0.11.0 — Unreleased

> A broker gets a record of its own, and a statement's rhythm comes from the period it covers.

### ✨ Added

- 💹 **A broker is a counterparty of its own** — its reports file against a card with a yearly lane, instead of piling up under "Not assigned yet" with nothing to attach to.
- 🧭 **A tax year knows where you lived, and says how it knows** — a return is owed because you were resident somewhere, not because you earned, so a year with no work and no investments still raises the nil return it owes. A filed statement proves residence; failing that it is inferred from where you worked, and failing that it falls back to your citizenship. Nothing carries over from the year before, so leaving a country stops raising its returns instead of doing it forever.
- 🛂 **A person's citizenship is recorded beside their name in Settings** — it is what tax residence falls back to when a year has no filed statement and no work in it, and it is asked for when a person is added. Left blank it contributes nothing rather than being guessed from a name, so a household that ignores it sees exactly what it saw before.
- 🔗 **An account can say which organisation it is held at** — so a portfolio and the broker that issues its paper stay one counterparty rather than two spellings of one.
- 🧾 **An obligation says why it exists, and how to make it go away** — pressing a missing return names the role period that raised it, so ending that period before the year removes the obligation without filing anything.
- 🗂️ **Income & Tax reads a year at a time as well as a career at a time** — the Year dossier puts each year on its own card with what earned on the left and the returns it produced on the right, and the years nothing is missing from fold down to a line.
- 🪜 **A promotion is one action** — the role held closes the day before the new one starts, so no payslip belongs to both and the months before the promotion stay expected.

### 🔧 Changed

- 🏛️ **Income & Tax is one screen instead of two tabs** — employers, brokers and the returns they produce share one axis of years, with the employment record opening under its own span. Employers and Tax years were two screens for one derivation, and neither said that what you earned decides what you owe.
- 💼 **An employer starts with Contract, Annexes and HR rather than one row for all three** — so "is the contract on file" and "has it been amended" stop being the same number. Employers already on the shelf keep the rows they have.
- 📊 **The Statements shelf reads a statement's rhythm from the period it covers** — so a quarterly report draws across its three months instead of having nowhere to go, and a bank's yearly summary stops drawing eleven gaps.

### 🐛 Fixed

- 🔢 **The "missing" figure above Income & Tax counts the returns too** — it read the lanes only, so it could say nothing was missing above a screen listing eight returns that never arrived.
- 📎 **The same file attached twice to one tax statement is filed once** — the upload stored a content hash and never read it, so one Polish form ended up filed under two different names.
- 🏷️ **A tax document moved to another year or country is renamed to match** — dragging a Polish form onto the Polish card left it still titled with the Czech one.
- 💹 **A broker report that files against no account now says so** — it landed where nothing could find it and showed up only as an unplaced count nobody reads.

## 0.10.0 — 2026-09-19

> A year's tax return on its own card, an import queue that sorts itself, and an account that can be closed.

### ✨ Added

- 🗓️ **A tax year is a card of its own, holding everyone** — an annual return is one filing per person per year, not one per employer, so the card is drawn from each employer's country and the years worked there with a row per person.
- 🏷️ **Every document row says what the document already is** — type, months covered, subject and country as quiet chips beside your own tags, and clicking one narrows the list to everything sharing that fact.
- 🌍 **A document can say which country it is from** — a field rather than a slice of its name, so Czech and Austrian paper for the same year files apart.
- 🏦 **Statements draws a band for a loan** — a mortgage statement has a card and a coverage ribbon of its own instead of living under "Not assigned yet".
- 🖱️ **Drag a document onto the card it belongs to** — from the proposals list or any card's own paper, onto any card at all, not just the one guessed.
- 🚪 **Role periods can be recorded and closed from the organisation's card** — including that somebody left, so a former employer stops being expected to send anything.
- ✏️ **A role period's title and start date can be corrected afterward** — recording one without a start date no longer means it stays blank forever.
- 🌐 **The languages scanned paper is read in are a setting** — English, Czech, Polish, German, Spanish and Ukrainian ship in every image, and only what a household needs is on by default because each costs reading time.
- 🔁 **A holding can be told the symbol a feed prices it under** — for a broker ticker a feed calls something else (Tesla on Xetra is "TL0", not "TSLA"), tried at once and on every refresh after.
- 🏦 **A fresh instance knows the euro area's banks** — N26, Wise, bunq, ING, Deutsche Bank, Sparkasse, DKB, Commerzbank, BNP Paribas, Crédit Agricole, Société Générale, Santander, BBVA, CaixaBank, UniCredit, Intesa, ABN AMRO, Rabobank, KBC, Belfius, Erste, Bank of Ireland, AIB, Nordea, OP and PKO, seeded without touching a bank already added or renamed.
- 🖼️ **An account shows its bank's logo** — the files ship in `assets/bank-logos/` with each one's source and terms in `CREDITS.md` beside them, and a bank without one keeps its emoji.
- 📈 **Salary counts a grant in the year it was awarded, vested and unvested alike** — vested parts at the close on each vest day, the rest at the latest close and labelled as an estimate, with an "Equity to vest" tile and one Change line for pay, bonus and equity together.
- ➕ **Adding files one at a time gathers them instead of replacing** — each visit to the picker merges into what is already there, the same file twice counts once, and each has a ✕.
- 📎 **Each paper in a filing says what it is and where it is from** — every picked file carries its own kind and country, so a Czech return, an Austrian employer report and a broker report go up together and are named apart.
- 🧾 **A tax statement's suggested gross follows the currency you file in** — computed per currency, so a year of Czech payslips read in CZK is the sum of what the slips said rather than a round trip through the base currency.
- 📊 **The equity table shows what the whole grant is worth** — a "Grant value" column gives vested plus still-to-vest at the same close, labelled as the estimate it is.
- 🖱️ **Hovering the investments chart reads out that point** — the month, the value, money in and the gain between them, snapped to real points rather than interpolated.
- ↪️ **A filed row can be called an own transfer afterwards** — the register asks "Moved to" or "Came from" by the row's sign, so money moved between two of your own accounts no longer stays counted as spending.
- 👥 **One payee's queued rows sit on one card** — grouped on the destination account number, each row keeping its own picker and Save, with a repeated amount called out because that is what a standing payment looks like.
- 🔍 **The register's search box takes an amount or a range** — `1100` for exactly that much, `100-200` for a band, `>5000` or `<=50` for one side, matched on the amount as printed.
- ⌨️ **The category picker is searched by typing** — case and diacritics are folded so "kavarna" finds "Kavárna", a group name matches everything under it, and typing at a closed picker opens it.
- 🎨 **A queued row says why it is queued, as a colour along its top edge** — green for a suggested category, purple for a transfer to confirm, red where two rules disagree, blue for a row you sent back and yellow where nothing was recognised.
- 🧭 **"Moved to which account?" remembers where the last ones went** — the same destination account number carries its previous answer over, and failing that the most common answer from this account is preselected.
- 🗄️ **An account can be closed, and a mistaken one deleted** — closing keeps every transaction and only takes the balance out of net worth, and deleting is offered only for an account that never held one.
- 🔎 **A row named after a payment method now says where the money went** — an (i) beside "QR Platba" or "okamžitá" shows the account number, the variable symbol and the line as printed.
- 🏦 **Vested shares can be recorded as moved to a broker** — that broker's report counts them from then on, so the same shares are not counted twice and nothing pretends they were sold.

### 🔧 Changed

- 🚌 **Transport is what you buy, not what you own** — Public transport, Taxi & ride-hailing, Car rental and Parking & tolls replace Car loan, Fuel & tolls and Car service, and a household with a car makes a group for it.
- 💰 **"Cash buffer" is now "Money set aside"** — it names the act, money that left the current account without being spent, rather than a thing.
- 🗂️ **An employer's catch-all lane is now "Contract & HR"** — "Changes to pay" undersold the contract, its amendments and a raise or bonus letter.
- 👤 **An organisation's card names whose relationship it is** — "Robert · Research scientist · since 2025", so a household of more than one can tell whose employer a card is.
- 📇 **Income & Tax cards read as employment history** — the job held leads, earlier ones follow newest-first, and a finished employment collapses by default.
- 🏷️ **The transfer buttons say what they decide** — "Own transfer" is now "Internal transfer" and "Not a transfer" is "Not the same", because rejecting is a claim about the match, not about the row.
- 🔢 **The queue is ordered by what is worth answering, not by date** — transfers first, then rows already filled in, then conflicts and rows sent back, then the unrecognised, all ranked before the cut of fifty.
- 🔢 **Thousands are grouped with an apostrophe** — `103'055.29` rather than `103 055.29`, because a space reads as a gap between two numbers and an apostrophe is nobody's decimal mark.
- 📥 **The import queue empties as files land** — it holds only what is still happening plus anything that failed, instead of repeating a finished row that Recent imports already shows.
- 🕰️ **Recent imports lets go of statements after a week** — the row hides and nothing else, so the import, its transactions and its document stay and a re-upload is still caught as a duplicate.
- 📏 **The equity table has room to be read** — the price date moved to one line under the table and the Pending units column went, since "0 / 62" already says it.
- 💶 **The Portfolio tile stops printing the same figure twice** — the "≈" line is hidden when the broker account is already in the household's currency.

### 🐛 Fixed

- 📅 **Any document can say which months it covers** — the Covers fields showed only for a bank statement, so a tax return filed by hand had nowhere to say which year it was for.
- 🧾 **A tax document filed from the Tax screen is dated** — it carried no period, which is the other half of why a year's cell stayed red after the paperwork went in.
- 🎚️ **The confidence floor's slider fill lines up with its thumb** — the track was painted to the raw percentage while the thumb sits where a 5–95 range puts it.
- 🔁 **A transfer you asserted by hand adopts its real other half when the statement arrives** — an opposite, equal leg in the named account within three days becomes the pair, and the hand-written marker comes off.
- 👯 **A proposed transfer is asked about once, not twice** — the leg the money left on is the one kept in the queue.
- 🔀 **A proposed transfer shows what it was matched with** — the counterpart sits under the row with its date, account, amount and how many days apart the two are.
- 🔢 **A ČS payment is no longer named after a bank code** — a payee is never digits alone, so "0308" gives way to the order line naming the shop, and a row stored under the old name is corrected in place, fingerprint included, when its statement is uploaded again.
- 🏷️ **A ČS payment is named by what it was for, not by what kind of payment it was** — "okamžitá" and "úvěru" were the payment's kind, and the line naming the counterparty was one position along.
- ↩️ **"Not spending" can be taken back** — the register carries the same way back out its loan payments have, so a debit wrongly called a transfer no longer stays out of spending for good.
- 🔗 **A matched transfer can no longer be given a category** — filing such a row is refused and the register says it is matched, so one leg of an own transfer cannot show as "Money set aside".
- 🚪 **A transfer to a closed or untracked account can be taken back** — it reads as the one-sided transfer it is, with the same way out a named account has.
- 🏷️ **Filing by hand applies a rule's tags, as filing by itself always did** — a tag is not a verdict, so they now apply whatever category was chosen.
- ↔️ **"Moved to" says "Came from" on money arriving** — the question followed one direction whatever the sign.
- 🔄 **A suggestion that arrives late is shown without a page reload** — the picker follows the rule's suggestion until a person picks, and only then stops listening.
- 📐 **Save and "New category…" stay where they are** — the picker has a fixed width and a long name is truncated rather than pushing the buttons about.
- 📱 **A queued row is laid out on a phone, not left to wrap** — the picker with Save at its end, then "New category…", the destination, and "Not spending" across the bottom.
- 👤 **A salary row says whose pay it is instead of deciding quietly** — it states the remembered person with a way to say "not theirs", and asks only when nothing answers.
- 🧹 **One employer makes one remembered rule** — a trailing run of bare numbers is never part of a name, so "MSD CZECH REPUBLIC S 0138" is learned as the same employer as "MSD CZECH REPUBLIC S".
- 🕰️ **A balance from an old statement says how old it is** — a figure more than a week behind carries its age in amber beside the date.
- 📊 **"Month by month" covers the period the rest of the screen is showing** — it drew a fixed six months whatever the range above it.
- 🧾 **A Revolut statement with a refunded fee is no longer rejected whole** — the fee is signed, so a refund's negative fee was being charged a second time and the balance failed to follow.
- 🔗 **The enrollment link only shows when it means something** — hidden in open mode, where everyone can already sign in and set a password in their own Settings.
- 📐 **The "Add account" row stopped losing fields on a narrower screen** — it wraps onto more lines instead of collapsing Name and Whose toward invisible.
- 🏢 **A new organisation card no longer suggests naming it after a car** — the placeholder fits what the card is.
- 🗂️ **Filing a document for the first time lands it in its lane, not permanently in History** — the lane is guessed whenever exactly one on that card fits.
- 📅 **Saving a document no longer wipes the month a payslip covers** — saving anything but a bank statement read the hidden Covers fields as "clear it".
- ◀️ **"Previous year" no longer refuses to move** — its bound was read off the cells of the year already on screen.
- 🚪 **Switching employer mid-year no longer marks the one you left as missing payslips forever** — a closed role period caps what a monthly lane expects, as its start already did.
- 📅 **A yearly declaration stops being expected once the job is over** — a closed role bounds a yearly lane's last year the same way it bounds a monthly one's.
- 🙈 **An empty monthly or yearly lane no longer draws a blank grid** — a seeded lane stays out of the way until it holds a filing or a gap.
- 💬 **"no rhythm" is gone from a lane with no schedule** — it read as jargon, so a cadence-less lane just shows its name.
- ☑️ **Saving OCR languages no longer unchecks every one of them** — the form reset was reverting each box to its un-hydrated state on submit.
- 📉 **An XTB report's total value is read under its real column label** — "Open position value" parsed as 0 and emptied the portfolio chart and the net-worth sidebar.
- 🏷️ **A holding no feed can price now says so, with a place to type its close** — the same prompt equity grants already had.
- 📈 **Net worth's investments figure moves with the market between broker reports** — each holding's price drift since the report is added on top, all-or-nothing, so a half-priced portfolio never reads as a fall.
- 📉 **The investments line goes dashed after the last broker report, as it always claimed to** — the marked value is appended as its own final point, so a report uploaded this month no longer leaves the tail with nothing to draw.
- 🌱 **"With equity" counts every grant, not only what has vested** — the whole grant is valued at the latest close, with units already moved to the broker left out so nothing is counted twice.

## 0.9.3 — 2026-09-16

> Open mode you can actually close, and a setup wizard that keeps what you typed.

### 🐛 Fixed

- 🔒 **Closing open mode can no longer strand anyone** — it now refuses while someone still has no password, naming them, instead of silently leaving them unable to sign back in.
- 🔑 **A first password, not just a changed one** — anyone with no password yet (open mode, or still pending enrollment) gets a "Set password" form instead of one demanding a current password that was never set.
- ✍️ **The setup wizard stopped erasing names and birth years** — toggling "No password" no longer wipes what had already been typed for each person.
- 🙈 **"Not enrolled yet" only shows when it means something** — hidden while the instance is in open mode, where nobody needs a password.

## 0.9.2 — 2026-09-16

> Shares an employer grants, vesting on their own calendar, priced every day.

### ✨ Added

- 📜 **Restricted stock units, from grant to vest** — a grant is entered once on Salary with its vesting schedule, and each tranche is counted as it vests.
- 📈 **A daily close for every ticker the household owns** — prices come from a public quote feed with no login, and a ticker no feed can price takes a close typed by hand.
- 💼 **Vested shares count in net worth** — at the latest close, in the market's currency, converted like everything else; unvested shares are shown as pending and not counted.
- 💵 **Equity vested beside bonus** — the salary year shows what vested at the close on each vest day, kept out of base pay so a grant never reads as a raise.
- 📉 **The portfolio chart is marked to market after the last report** — a dashed tail values the reported units at each day's close until the next upload.

### 🔧 Changed

- 🎛️ **Price refresh cadence and staleness are settings** — daily and seven days by default, under the `prices` key.

## 0.9.1 — 2026-09-13

> Regions you can actually name and reach, places worth the detour, and a scratch you can take back.

### ✨ Added

- 🪙 **Places worth seeing** — a curated set of places for each country sits under its map as gold coins, each rubbing off to reveal an engraving of the place, printed on that country's own colour. 828 engravings across 71 countries have been drawn so far; a place without one is not offered as a coin, and the row fills in as batches land.
- 👁️ **Seeing a place is recorded on its own** — rubbing a coin records that place and never colours the country, which keeps visits the only answer to where the household has been.
- 🧭 **A trip suggests what is worth seeing there** — the curated places for a trip's destinations are offered beneath its list and become rows only when one is tapped.
- ↩️ **A scratch can be taken back for five seconds** — Undo restores the selected region and removes the manual visit without affecting trip-derived visits.
- 🗿 **Attribution for the artwork and data the map ships** — NOTICE.md records the engravings, typefaces and geographic sources with their licences.
- 🏠 **The demo household arrives with its smart home already connected** — rooms, devices that switch and a month of energy, held in memory rather than reached over the network.

### 🔧 Changed

- 🌏 **A continent coin is scratched away in the shape of each country visited** — Australia clears the share of the Oceania coin it actually covers instead of a fixed dot.
- 📐 **Continent progress is weighted by land area** — and the bar is held back from a hundred per cent until every country on that continent has been visited.
- 🧩 **Far-flung regions are drawn in panels of their own** — Svalbard, the Azores, Madeira and the French overseas régions keep a legible scale instead of shrinking their country into a sliver.
- 🕐 **Time-zone offsets are labelled along the band they mark** — the labels read up the map edge rather than stacking into rows above it.
- 💡 **An idea on the trip board reads as a card somebody could pick up** — a raised ground washed in its stamp's own colour, one surface rather than a panel behind the stamp, no emoji or flag repeating what the stamp already prints, the people who want to go as initials in their own colour, and "Make a trip" as a button rather than a line of text.
- 🍳 **A recipe wears the colour of the shelf it stands on** — each cookbook shelf is given a colour of its own when it is made, and keeps it however the rail is reordered.
- 🧹 **The map's trackers and the idea board say less** — the three captions explaining what a scratch, a zone and a continent count were removed; the figures already say it.

### 🐛 Fixed

- 🗺️ **Country regions now use the correct administrative level** — regional boundaries are dissolved consistently, including for France, Italy, Spain and the United Kingdom.
- ✨ **Scratching a region no longer reloads the whole map** — the country outline and foil state remain stable while the visit is recorded.
- 🔤 **A coin is labelled in a script its reader can place** — 315 places the dataset names only in the local script, Thimphu and Kyiv and Bangkok among them, now show the Latin name the dataset itself carries beside it.
- 🔍 **A region smaller than a fingertip can now be scratched** — Jervis Bay, the District of Columbia, Moscow, Luxor and every atoll of the Maldives are drawn as a disc large enough to reach.
- 🏝️ **Pacific countries are on the right continent** — Kiribati, Palau, Guam, French Polynesia and the Northern Marianas were filed under North America or Asia, so scratching one moved the wrong coin.
- 📊 **A continent counts every country the map can draw** — Oceania read a hundred per cent at seven countries because the rest were in no denominator at all.
- 🇫🇷 **Hyphenated region names wrap on their hyphens** — Provence-Alpes-Côte d'Azur and its neighbours no longer overflow their outline.
- 🕛 **UTC+12:00 no longer sits on top of UTC+11:00** — a band cut in half by the edge of the map keeps its own label.
- 🧹 **A browser that had opened the map before no longer serves stale geodata** — outlines, continents and time zones are all stamped with the build they came from.
- ⚡ **The first Map after a restart opens straight away** — working out which time zone owns each column took seventeen seconds and now takes half of one.
- 🇷🇺 **A region that crosses the antimeridian stays with its country** — Chukotka was measured as 324 degrees from its neighbours and drawn in a panel of its own.
- ✅ **A scratch the server refused is no longer reported as saved** — a rejected scratch, undo or coin says what happened instead of showing a change that the next load undoes.

## 0.9.0 — 2026-09-12

> A map that fills itself in, a cellar that knows what wants drinking, and the passports to get you there.

### ✨ Added

- 🧳 **Trips** — ideas, destinations, members, bookings, documents and derived trip status in one workflow.
- 🗺️ **Visited-country map** — ended trips populate visits automatically; countries, regions, cities, years and time zones are shown on the map.
- 🪙 **Scratchable country map** — countries and regions can be revealed manually, with places of interest shown separately.
- 🛂 **Travel readiness** — passport expiry and issuing country are read from identity documents and combined with visa data; unknown data remains unknown.
- 🍷 **Collections and cellar** — bottlings track owned/open bottles, tastings, notes, scores, drink-by windows and opening suggestions.
- 🍳 **Cookbook** — recipes, ingredients and quantities scale to the number of people eating without inventing missing measurements.
- 🎨 **Stable generated artwork** — trips, recipes and bottles keep the artwork chosen when they were created.

### 🔧 Changed

- 🗂️ **Life modules are independently switchable** — Trips, Cookbook and Collections have separate toggles and navigation.

## Earlier releases

The releases below are retained as a compact history. Detailed implementation notes live in the corresponding commits.

### 📷 0.8.7–0.8.0 — Scanner, documents and Overview

- The scanner gained reliable page-edge detection, curved-edge correction, colour-aware detection, server-side processing, HEIC support and smaller browser bundles.
- Uploads now share one drop, browse and camera control, support multi-page documents, preserve originals, and handle failed or repeated scans safely.
- Identity documents gained structured metadata, country grouping, card artwork, custom document types, masked numbers and improved filing from Inbox.
- Overview became a configurable board with module-aware panels, summary bands, responsive layout, accessible navigation and corrected chart, import and document behaviour.
- Geodata, local-network setup, Docker self-hosting and browser themes were improved; related accessibility and contrast defects were fixed.

### 🗂️ 0.7.9–0.7.0 — Documents, shelves and organisations

- Documents gained shelves, coverage ribbons, organisation and role-period tracking, filing suggestions, review feedback, statement coverage and clearer Inbox workflows.
- Identity and other system shelves became structured views with wallet/list modes, country artwork, expiry states and configurable expected document types.
- The import and document paths gained safer filtering, archive handling, search context and boot checks for incompatible database versions.

### 📄 0.6.2–0.6.0 — Scanning and paper archive

- Paper could be photographed, cropped, flattened, converted to PDF and filed from any file input, with local HTTPS support for phone cameras.
- Scan processing moved toward safer, lower-memory operation with better orientation handling, colour preservation, retry behaviour and error reporting.

### 💼 0.5.7–0.5.0 — Salary and release automation

- Salary supports multiple payslips per month, batch filing, multiple currencies, learned employer wording, corrections, provenance and clearer gross/net/bonus handling.
- Duplicate uploads are detected by file content, existing entries are preserved, and filing feedback is explicit.
- Release automation now synchronises versions, validates changelog sections, prevents accidental downgrades and publishes tags only after the image succeeds.

### 📊 0.4.6–0.4.0 — Salary, tax and visual system

- Salary became a dedicated screen with gross, net and bonus figures, editable source data, household totals, charts and paged history.
- Tax and loan workflows gained clearer calculations, correction paths and stronger validation.
- The interface received the shared design system, responsive charts, accessible controls, consistent fields, theme support and the first major Overview refinements.

### 🧱 0.3.10–0.3.0 — Ledger foundation and integrations

- The database moved to a single generated baseline with UUID keys, enum and foreign-key checks, currency metadata, shared entities, jobs and net-worth components.
- Money, imports, transfers, loans, property, investments, retirement, documents and configuration writes gained transaction boundaries, locking, validation and concurrency fixes.
- Contacts, recurring calendar events, CalDAV, iCloud, Google Calendar and generated household events were added, with conflict handling and safer sync semantics.
- Security and operations improved through central authentication transitions, passkey protections, API boundaries, error references, licensing and source-file metadata.

### 🌱 0.2.1–0.1.0 — Initial ledger

- Initial household finance workflows: accounts, statements, transaction review, categories, rules, transfers, budgets, net worth, property, loans, investments, retirement, documents and tax records.
- Initial Docker Compose deployment, authentication, themes, import readers, calendar foundations and household settings.
