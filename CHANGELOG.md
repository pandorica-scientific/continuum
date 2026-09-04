# 📓 Changelog

✨ Added · 🔧 Changed · 🐛 Fixed · 🔒 Security · ⬆️ Upgrading

## 0.8.1 — 2026-09-03

> The same app, in a warmer skin that says which screen you are on before you read a word.

### ✨ Added

- 🎨 **Every area has a colour, and wears it** — a hue tile before each screen title, panel head and nav row, so the shape of a screen is recognisable before any of it is read
- 📐 **Three layouts from one markup** — a 264px sidebar on a monitor, a 76px icon rail on a tablet, and a bottom bar on a phone in place of the ☰ drawer
- 💰 **Net worth is the one lit surface in the product** — a gradient panel with white type in both themes, where it used to be a card among cards
- 📊 **Rules group by category and open closed** — a header row carries the count, the average trust and how often the group was overridden, so "is anything filing wrongly" is answered without opening one
- 🎚️ **The confidence floor can be moved** — it has been a stored setting with nothing able to change it since rules existed
- 🔎 **Transactions opens on four chips and a search box** — the eleven-field filter grid is one click away instead of the first thing on the screen
- 📈 **One chart engine behind the salary and tax screens** — bars and lines, its own axis for each, round steps, gaps at null points, a hover readout and a series named at the end of its own line; the two screens each owned a copy of that arrangement and had already drifted on bar width and readout placement
- 🔥 **Hovering a Sankey block lights its whole route** in both directions and dims the rest, with a slow flame on the lit bands

### 🔧 Changed

- ⚙️ **Settings shows one section at a time** behind a nav of nine, where it was ten stacked sections and a scroll position
- 🃏 **A card in the flow is raised** by one quiet shadow, and sits a step brighter than the page — the border alone could not hold an edge on light paper
- 🔤 **Headline figures are set in the sans**, tightened and tabular; every figure in a table, every date and every ID stays mono
- 🌗 **The light theme puts white cards on darker paper**, with washes remixed at 11–16% so an area's colour survives a bright screen
- 🥧 **The cash-split chart is a pie again** — its hole held the total, which now sits in the panel header at four times the size
- 🚪 **Sign-in is two columns above 900px**, with what is true about the instance beside the form
- 📐 **Two chart geometry modules folded into one engine** — `salary-chart-geometry.ts` and `tax-chart-geometry.ts` keep what a bar means and hand the pixels to `charts/line.ts`, which is tested once instead of twice
- 🧹 **Nineteen exports narrowed to the file that uses them** and six dead declarations removed; `npm run scan:unused` went from 117 names to 98, and every one still listed is a type naming an exported function's own signature
- 📸 **The README's screenshots are the new UI**, in both themes
- 🎚️ **One switch component**, where the same track, knob and thirty lines of CSS were written out three times across Settings and Calendar
- 🎨 **A register row leads with its category's colour** — an 8×22 bar down the left, so a month of spending is scannable before a word of it is read
- 🏷️ **A transaction's category is a chip in its own hue**, beside the merchant rather than a grey word three columns to the right
- 🏦 **Accounts is two columns of cards** — one card per account with its emoji tile, share bar and display balance, beside the pie and the transfers; statements moved behind the pencil, where they no longer push the next account off the screen
- 📅 **A month in the register opens from a 34px tile**, teal when it is the one you are reading, in place of a 9px chevron nobody could aim at
- 📉 **A loan draws its whole term as one band** — what is behind you, the rate you are on, and the years past the last date anybody has agreed a rate for, hatched
- 🎚️ **The confidence floor is the design's slider** — an 8px track filling yellow to green, with the value beside it
- 🎯 **Retirement puts the assumptions beside the picture they change** — a 380px column of controls against the chart and the table, with the gauge leading the verdict
- 🏠 **Property opens on the flat itself** — its shape and its bills, with the valuation history and what it cost to buy below them rather than in the way
- 🥧 **The holdings chart is a pie**, its count in the panel header
- 📊 **A chart's keys are ruled off from its plot**, with the footnote at the end of that row where it fits — the design draws the legend as a caption on the picture, not as another row of the panel
- 🟡 **The effective-rate line is yellow**, the colour a rate wears everywhere else on the Tax screen
- ➕ **The quick-add button is 36px at rest** and grows to full size under the pointer or while its menu is open — at full size it sat over the last row of a table and the corner of the Documents rail
- 📶 **The net-worth pill fills with its own month** — green or red across as much of the pill as this month is of the biggest month on record, growing from nothing on arrival, so a good month is visible before the figure is read

### 🐛 Fixed

- 🗂️ **The Documents header counts the archive** instead of printing `[object Object] documents` — the count was a database row array passed whole
- 🔧 **A dossier's `once` slot fits its own box** — the ribbon's 28px centred cell was winning over the slot's own layout, so the name sat centred and the date fell out below it
- 🙈 **A section hidden by an attribute is actually hidden** — `.section` sets `display: flex`, which beat `[hidden]`'s own `display: none`
- 🟢 **The green pill clears AA on light paper again** — the ink is darkened rather than the tint lightened, per the rule the palette already states
- 📏 **A `once` slot stays inside its own lane** — `.cell` pins a ribbon square to 28px and won at equal specificity, so a named two-line slot hung out of its lane and the next lane's rule was drawn across it

### ⬆️ Upgrading

- No migration. This release changes no table, column or enum; the 0.8.0 database runs it unchanged.
- One lint rule moved: `design/no-raw-shadow` now allows `--shadow-card` and `--shadow-hero` beside `--shadow-float` and `--shadow-raise`. A fork carrying its own elevation values will still fail the build, which is the point.

## 0.8.0 — 2026-09-02

> Every shelf is a question, and the screen answers it.

### ✨ Added

- 🗂️ **A shelf is one question, one unit and one template** — its name is the screen title, its question is the caption, and three figures beneath answer that question
- 🧩 **A household makes its own shelves from seven templates** — a Boat shelf drawing obligations is as good as a shipped one, where before it got a plain list and nothing else
- 🚗 **Cards on Health, Inventory, Property and Vehicles** — one per person, item, address or vehicle, each with lanes for what falls due and a history for what does not
- 🧾 **Slots for the paper a thing is expected to have** — a receipt, a warranty and a manual are drawn whether or not anything is in them, because the missing manual is the finding
- 🔁 **A lane can expect paper every two years** — one cell two columns wide, so a technical inspection is not read as a yearly one with every other year missing
- 📥 **The Inbox files paper in three steps** — shelf, then card, then lane, each narrowing the next, with a card made on the way past when the shelf has not got one yet
- 📊 **Every screen draws its figures with one summary band** — Tax, Salary and six others had their own, at three different sizes

### 🔧 Changed

- 🔧 **Household is Inventory**, and Family's certificates now live on IDs while Tenancy's leases live on the address they concern
- 📋 **The list with its filters is a view every shelf opens on request**, not what a shelf is
- 🎚️ **The Documents rail holds Inbox, the shelves and Everything** — a subject and an organisation are cards on their own shelf, which is where they are made, renamed and archived
- 🔗 **A document is offered only what belongs on its shelf** — a car's policy is offered the cars, not the boiler and not the tax office
- 🚏 **A document is in a lane because somebody put it there** — a rule proposes and a person confirms, because two lanes on one card can both match a payslip

### ⬆️ Upgrading

- There is no upgrade path from 0.7.x. This release ships a fresh baseline and starts on an empty database; nobody is running it yet, and that window closes here.

## 0.7.9 — 2026-09-01

> A guess you can see is worth more than a filing you cannot.

### ✨ Added

- 🔎 **The lanes propose which organisation an unfiled document belongs to** — shown above the cards with File it and Not this one, never applied silently, because a wrong link looks exactly like a right one and nobody re-reads it
- 🤝 **A lane remembers whether its proposals were taken** — and once corrections outnumber acceptances it stops proposing, so a rule nobody is watching stops doing damage on its own
- 🙅 **Two organisations claiming the same document proposes neither** — guessing between two employers is worse than asking, and a document nobody claimed stays in plain sight

### ⬆️ Upgrading

- 🗄️ **Two columns on `lane`, which an instance migrated by hand runs once after a backup** — they hold what happened rather than a tuned weight, so starting them at zero is correct and not a loss

```sql
alter table lane add column if not exists accepted_count integer not null default 0;
alter table lane add column if not exists corrected_count integer not null default 0;
```

## 0.7.8 — 2026-09-01

> A shelf that counts from when the paperwork started arriving, not from the first piece of it you kept.

### ✨ Added

- 🗂️ **Income & Tax opens as counterparty cards** — one per employer, authority or insurer, each holding lanes of month or year cells, so the payslip that never arrived is visible as the gap it is
- 📐 **A lane counts from the engagement rather than from the paper** — an employment that began in January with no slip until June shows five gaps, which is the whole reason role periods are recorded
- 🧩 **Each organisation is created with the lanes its kind expects** — three for an employer, two for an authority, none for a kind with no rhythm of its own, and all of them yours to edit afterwards
- 📄 **A period holding several documents opens a list rather than guessing which one you meant** — the same list the Statements ribbon opens, now one component instead of two

### ⬆️ Upgrading

- 🗄️ **One new table, which an instance migrated by hand runs once after a backup** — existing organisations get no lanes from it and can be given them from the rail

```sql
create table if not exists lane (
  id uuid primary key,
  organisation_id uuid not null references organisation(id) on delete cascade,
  person_id uuid references person(id) on delete cascade,
  label text not null,
  cadence text not null,
  conditions jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  constraint lane_cadence_check check (cadence in ('monthly','yearly','none'))
);
create index if not exists lane_organisation_idx on lane (organisation_id);
create index if not exists lane_person_idx on lane (person_id);
```

## 0.7.7 — 2026-09-01

> An employer that is a record rather than a name printed on a payslip.

### ✨ Added

- 🏛️ **An organisation is a record you create once and file against** — an employer, the tax office, an insurer, in a third section of the Documents rail beside Shelves and Subjects
- 🧑‍💼 **A person's dealings with one are role periods, and a promotion is a second period rather than an edit** — so the archive keeps knowing when the paperwork actually started arriving, which is what a missing year is counted from
- 📎 **Any document can be filed against an organisation** — the picker offers them wherever it offers a person or a flat, and search finds them by name
- 🧾 **The demo ships an employer with a promotion behind it and a tax office with neither role nor start date** — the two cases a single-period fixture never shows

### ⬆️ Upgrading

- 🗄️ **Two new tables, which an instance migrated by hand runs once after a backup** — an organisation is registered in the entity supertype like every other record, which is what lets a document be filed against one with no new link table

```sql
create table if not exists organisation (
  id uuid primary key,
  name text not null,
  kind text not null default 'other',
  emoji text not null default '🏛️',
  notes text,
  created_at timestamptz not null default now(),
  constraint organisation_kind_check check (kind in ('employer','authority','insurer','other'))
);
create unique index if not exists organisation_name_ci_idx on organisation (lower(name));

create table if not exists engagement (
  id uuid primary key,
  person_id uuid not null references person(id) on delete cascade,
  organisation_id uuid not null references organisation(id) on delete cascade,
  role text,
  starts_on date,
  ends_on date,
  document_id uuid references document(id) on delete set null,
  constraint engagement_period_order_check
    check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists engagement_organisation_idx on engagement (organisation_id);
create index if not exists engagement_person_idx on engagement (person_id);
create index if not exists engagement_document_idx on engagement (document_id);
```

- 🔗 **The entity registration is what makes filing work, and it is not in the statement above** — a fresh install gets it from the baseline's `DO` block, and an existing one needs the generated column, the composite foreign key and the two triggers for `organisation` as `drizzle/0000_baseline.sql` writes them

```sql
ALTER TABLE organisation ADD COLUMN entity_kind text GENERATED ALWAYS AS ('organisation') STORED;
ALTER TABLE organisation ADD CONSTRAINT organisation_entity_fk
  FOREIGN KEY (id, entity_kind) REFERENCES entity (id, kind) ON DELETE CASCADE;

CREATE FUNCTION organisation_register_entity() RETURNS trigger LANGUAGE plpgsql AS $b$
BEGIN
  INSERT INTO entity (id, kind, created_at)
    VALUES (NEW.id, 'organisation', COALESCE(NEW.created_at, now()))
    ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $b$;
CREATE TRIGGER organisation_register_entity_trg BEFORE INSERT ON organisation
  FOR EACH ROW EXECUTE FUNCTION organisation_register_entity();

CREATE FUNCTION organisation_retire_entity() RETURNS trigger LANGUAGE plpgsql AS $b$
BEGIN
  DELETE FROM entity WHERE id = OLD.id;
  RETURN OLD;
END $b$;
CREATE TRIGGER organisation_retire_entity_trg AFTER DELETE ON organisation
  FOR EACH ROW EXECUTE FUNCTION organisation_retire_entity();
```

## 0.7.6 — 2026-09-01

> A shelf that can only show you what it holds cannot show you what is missing.

### ✨ Added

- 🧾 **Statements opens as a coverage ribbon** — one band per account across twelve months, so a month that never arrived is visible as the gap it is instead of being invisible in a list of ninety-six statements
- 📅 **A filed statement now records which months it covers** — taken from the period the file states, or from the movements the import just wrote where it states none, so a quarterly statement draws as one band three months wide
- 📤 **Clicking a gap opens the Import with the account and month already chosen** — an accepted import writes the ledger rows and dates the document in one go, so the month closes without anybody typing a date
- ✍️ **A statement the reader refused can say which months it covers** — set _Covers_ in the inspector and link it to its account, and a scan that could not be read still counts towards coverage
- 🪧 **Every shelf opens with a banner saying what it is for** — the paragraph is why you would open the shelf, and the three figures beside it answer the question that shelf exists to answer

### 🔧 Changed

- 🪪 **An identity document turns amber six months before it expires, not sixty days** — replacing a passport takes half a year, and the window now belongs to the kind of paper rather than to the app, so a household can change it
- 🎨 **A figure in a banner only takes a colour when it is a task** — `0 gaps` is the state the archive is for, and a red nought is an alarm about nothing
- 🗂️ **A fresh install's shelves are ordered by how often they are opened, and two are renamed** — Identity is now **IDs** and Finance is now **Income & Tax**, which is what that shelf has always held
- 🧾 **Income & Tax offers the papers a tax return is assembled from** — payslips, tax documents, confirmations, correspondence and contracts, and no longer Invoice, because an invoice is almost always about a thing that has a shelf of its own

### ⬆️ Upgrading

- 🗄️ **Two new columns and three constraints, which an instance migrated by hand runs once after a backup** — the first statement holds the schema, the second dates the statements already filed so the ribbon can draw the archive that exists

```sql
alter table document add column if not exists period_end_on date;
alter table document_type add column if not exists reminder_days integer;
update document_type set reminder_days = 180 where key = 'id_document';

alter table document add constraint document_period_end_last_of_month
  check (period_end_on is null or period_end_on = (date_trunc('month', period_end_on) + interval '1 month - 1 day')::date);
alter table document add constraint document_period_order_check
  check (period_end_on is null or (period_on is not null and period_end_on >= period_on));
```

- 🏷️ **An existing instance keeps the shelf names and order it already has** — a label is the household's, never the app's, so nothing is renamed underneath anybody; the statement below is the same change for a database that would like it

```sql
update shelf set label = 'IDs' where key = 'identity' and label = 'Identity';
update shelf set label = 'Income & Tax' where key = 'finance' and label = 'Finance';
update shelf set sort_order = v.ord from (values
  ('inbox', 0), ('identity', 10), ('statements', 20), ('finance', 30), ('household', 40),
  ('family', 50), ('health', 60), ('property', 70), ('tenancy', 80), ('vehicles', 90)
) as v(key, ord) where shelf.key = v.key;
```

- 📆 **Statements imported before this release have no period, so the ribbon cannot place them** — this dates them from the movements each one wrote, snapped to whole months because that is what the columns mean

```sql
update document d
set period_on = coalesce(d.period_on, date_trunc('month', t.first_day)::date),
    period_end_on = coalesce(
      d.period_end_on,
      (date_trunc('month', t.last_day) + interval '1 month - 1 day')::date
    )
from (
  select f.document_id, min(x.booked_on) as first_day, max(x.booked_on) as last_day
  from import_file f
  join "transaction" x on x.import_file_id = f.id
  where f.document_id is not null
  group by f.document_id
) t
where d.id = t.document_id and d.type = 'bank_statement';
```

## 0.7.5 — 2026-08-31

> Software that promises your data never leaves your machine has to let you read what it does with it.

### 🔧 Changed

- ⚖️ **Continuum is licensed under the GNU AGPL v3 instead of PolyForm Noncommercial** — it is open source in the OSI sense now, free to run, study, modify and share for any purpose including a commercial one, on the single condition that a modified version other people use offers them its own source under the same terms

## 0.7.4 — 2026-08-31

> A shelf that knows what it holds can show it as the thing it is.

### ✨ Added

- 🪪 **The Identity shelf opens as a wallet rather than as a list** — one card per document, sectioned by whose it is with anything nobody is named on last, and `Wallet`/`List` in the toolbar switches between them with the choice written into the address
- 🎨 **Thirty countries of card artwork, in four kinds** — a card face is drawn art and never the scan, because seven photographs of seven cards on white A4 look identical at card size, which is the failure a wallet exists to avoid, and a country nobody has drawn yet still gets a card
- 👤 **Each wallet section is the person's own tag, in the colour they carry everywhere else** — the same hue as on Salary and Tax, because a colour that changes from screen to screen is decoration rather than a tag
- 🇪🇺 **A card from a member state carries the code inside the Union's ring** — twelve stars and `CZ` in the middle, the way an EU passport, licence and number plate already write it, with everywhere else keeping the plain two letters beside its flag
- 🔢 **A document can carry as many numbers as it actually has** — a residence permit with a card number beside a personal number, each named by whoever typed it, added a row at a time under the issuer and gone again when the row is cleared
- 🧾 **An identity document can say what is on its face** — kind, country, number, issued on and issuer, all optional and all typed by hand, with the number shown only in the inspector and masked until it is clicked
- ➕ **A household names its own kinds of paper** — the shelf's type dialog gains a field for one the app never shipped, and it behaves like any other afterwards: filed, filtered, grouped, offered by a shelf; the seventeen built in stay, because the salary tracker reads `payslip`, an import writes `bank_statement` and the wallet reads `id_document`, and a type nothing is filed as can be removed again
- 🏷️ **Each shelf carries its own list of the types it usually holds, and the household edits it** — the tag beside a shelf in the rail opens it, on a system shelf as much as any other, and it shortens the picker without ever refusing a document: any type can still be filed anywhere
- 📇 **Every shelf a fresh install ships now records what it is for** — what it expects, what organises it and how it draws, in one place the empty state, the type filter and the inbox review all read from

### 🐛 Fixed

- 📷 **Documents can be scanned and photographed again** — every upload on the screen offered a file browser and nothing else, because the capture buttons are decided from what an upload says it accepts and these four said nothing; a phone can now scan straight into Add document, Attach file and Replace file, and the list the picker offers is the same one the server will actually store
- 📥 **Filing from Inbox review actually files** — the screen said "Inbox is clear" while the document sat exactly where it started, because the queue advanced before the browser had sent the form and unmounted the form it was sending; the shelf and type carried forward now survive the filing too, which is what `kept` was always meant to mean
- 🗂️ **A document opened from the Inbox offers to file itself** — the same edit form, one press away, rather than a trip back through Everything to reach Review inbox
- 📚 **Revealing archived subjects while editing the rail no longer changes what the list shows** — the link wrote the same `archived=1` the centre column reads, so bringing a sold car's row back to rename it unhid its paper everywhere and pressing Done did not undo it; it is a state of the rail's edit mode now, and `Include archived subjects` above the list is still the control for the list
- 🖼️ **The inspector's preview keeps its height instead of being squeezed** — the panel is a column bounded by the viewport, so on a short screen the preview gave up its space first and a photograph became an 87-pixel sliver that read as a failed load; the sections scroll now, as they were always meant to

### 🔧 Changed

- 📂 **A shelf's list is grouped the way that shelf is read** — Finance by year because payslips and tax papers are looked up by the year they concern, the Inbox by type because nothing in it is linked yet, and the control still says otherwise whenever you want it to
- 🔤 **A shelf's type filter offers what the shelf expects first** — opening Identity's starts at Identity document rather than at whatever happens to be most numerous, and every type on the shelf is still there
- 🗂️ **Filing from the inspector behaves as filing from review does** — the shelf shortens the type list and fills in its first there too, so "File it" on an Inbox document is the same act done in a different place rather than a second, plainer form
- 🗃️ **Inbox review offers the shelf's own types rather than all seventeen** — picking Identity leaves four in the list with the first already chosen, and `Show all types…` opens the rest for the document that does not fit
- 💡 **Picking a shelf during inbox review proposes that shelf's type** — marked `suggested` rather than `kept`, cleared the moment the field is touched, and never overwriting an answer somebody already gave
- 🔍 **A search shows the list on every shelf** — a match is explained by the line it was found in, and a card face has nowhere to put one

### ⬆️ Upgrading

- 🗄️ **One new table, and an instance migrated by hand runs this once after a backup** — it holds what an identity document says on its face and nothing else reads it

```sql
create table if not exists document_identity (
  document_id uuid primary key references document(id) on delete cascade,
  kind text not null default 'other',
  country text,
  number text,
  issued_on date,
  issuer text,
  constraint document_identity_kind_check
    check (kind in ('passport','id_card','driving_licence','residence_permit','other')),
  constraint document_identity_country_check
    check (country is null or country ~ '^[A-Z]{2}$')
);

create table if not exists document_type (
  key text primary key,
  label text not null,
  builtin boolean not null default false,
  sort_order integer not null default 0
);
insert into document_type (key, label, builtin, sort_order)
select type, initcap(replace(type, '_', ' ')), true, 0 from (
  select unnest(array['contract','invoice','receipt','payslip','bank_statement',
    'broker_report','insurance_policy','claim','id_document','certificate',
    'medical_record','tax_document','technical_plan','correspondence','warranty',
    'manual','other']) as type) t
on conflict (key) do nothing;
alter table document drop constraint if exists document_type_check;
alter table document add constraint document_type_document_type_key_fk
  foreign key (type) references document_type(key) on delete restrict;

create table if not exists shelf_type (
  shelf_id uuid not null references shelf(id) on delete cascade,
  type text not null,
  ordinal integer not null,
  primary key (shelf_id, type),
  constraint shelf_type_type_document_type_key_fk
    foreign key (type) references document_type(key) on delete cascade
);
create index if not exists shelf_type_type_idx on shelf_type(type);

create table if not exists document_identity_number (
  document_id uuid not null references document_identity(document_id) on delete cascade,
  ordinal integer not null,
  label text not null,
  value text not null,
  primary key (document_id, ordinal)
);
```

- 🛑 **The boot check now asks for `document_identity_number.document_id`** — the column it probed before belongs to the release before this one, so an instance that pulled the image without running the statement above is refused at start with the reason rather than failing later at somebody's passport

## 0.7.3 — 2026-08-30

> Where a passport goes should not be a decision each household makes twice.

### 🔧 Changed

- 🗄️ **Eight of the ten shelves a fresh install ships cannot be deleted** — Identity, Family, Health and Household join Inbox, Statements, Finance and Property, not because anything files into them by name but because a documents product whose answer to "where does the passport go" can be removed has no answer, while Tenancy and Vehicles stay removable since not every household rents or drives
- 🐘 **`compose.yaml` pins PostgreSQL 18.6 rather than 17** — what is served now matches what the test suite has been exercising, and the pin is exact so a database major never changes underneath an instance that only meant to pull an app release

### ⬆️ Upgrading

- ⚠️ **A database major version is not something `docker compose pull` can change** — Postgres refuses to start on a data directory written by 17, so an existing instance either keeps `image: postgres:17-alpine` in its own copy of the file or moves its data across deliberately; [docs/install.md](docs/install.md#upgrading) has both routes
- 📁 **`PGDATA` is now named in the file rather than left to the image** — the official Postgres image moved its own default at 18, from `/var/lib/postgresql/data` to `/var/lib/postgresql/18/docker`, and a volume still mounted at the old path would have held nothing while the database wrote to the container's writable layer, losing everything the next time the container was replaced without failing or logging anything; anyone running the database by hand should add `-e PGDATA=/var/lib/postgresql/data` to match
- 🔒 **An existing instance should fix its four new system shelves** — a fresh install gets them from the seed, and the statement below is the same change for a database that already has the rows

```sql
update shelf set system = true
where key in ('identity', 'family', 'health', 'household');
```

## 0.7.2 — 2026-08-30

> Money put aside was never money spent, and a band that names something leads to what is behind it.

### ✨ Added

- 🧱 **Five more panels, bringing the board to eighteen** — Paper says what is unfiled and what lapses soon, Statements which accounts have gone quiet against their own import rhythm, Salary the last month each person was paid for, Debts what is still owed and when each rate stops being settled, and "Month against its average" the latest complete month's spending beside what the twelve before it usually cost
- 🎛️ **A new board starts by asking rather than guessing** — the first Overview anybody opens is empty with every panel their modules allow laid out above it, each saying in one line what it draws, and "Use the suggested board" is there for anyone who would rather not decide
- 🖱️ **Every band that names something opens what is behind it** — an income source, the trunk, a group and a category each lead to the register already narrowed to those transactions and that period, the two halves of a mortgage payment lead to the lines they became, and the residual — the cash kept, or what was drawn from reserves — is arithmetic on the rest and deliberately leads nowhere
- 💡 **Resting on a block lights everything flowing through it** — the bands touching it come forward while the rest recede, so a flow can be followed across four columns by looking rather than by tracing, and the same lighting comes up on the keyboard because each band that leads to rows is a link
- 📅 **Twelve months, and a way to walk back through them** — the period control gains a trailing-year window and a single month can be stepped backwards and forwards to the ends of the record, with the window written into the address so the back button and a shared link both mean what they said
- 📊 **Every figure says what it did against the window before** — the four totals and each group in the breakdown carry a percentage against the same window one step back, offered only where the record actually reaches that far
- 💳 **A bank debit can be recorded as the loan payment it was** — pick the loan from the transaction row and, where the bank stated it, the interest part; a ✕ on the chip takes it back, and a credit, a transfer between your own accounts, a currency the loan is not in, or a debit already recorded is refused with the reason
- 🏦 **A mortgage instalment is split into interest and principal** — only the interest is money the household will not see again, so the principal is drawn as saved rather than spent, taken from what the bank stated or worked out from the loan's own schedule and left whole where no rate is on record
- 📬 **Two more things the briefing knows to raise** — paper sitting unfiled in the Inbox, and documents whose contents could not be read, which is the quietest failure there is because searching inside them simply finds nothing
- 📋 **The briefing offers everything it found** — the strip still shows four cards, and a button beneath them says how many more there are and opens them, where anything past the fourth used to be dropped before it reached the screen

### 🔧 Changed

- 💰 **Money put aside is counted as saved rather than as cash kept** — the chart carries four totals now, In, Out, Saved and Kept, every savings group is a stage the money passes through like rent or food, and "Kept" is only the cash none of them took
- 📉 **A month that spent more than it earned says where the money came from** — the shortfall enters on the left as "From reserves" and the trunk reads "Income + reserves", rather than the chart reporting a negative amount of savings
- 💸 **Taking money back out of savings counts as money coming in** — a savings group a window took more out of than it put into enters on the left in its own colour, because that drawdown is what paid for the spending, rather than being counted again as money saved
- 🔗 **Every panel with a screen behind it says "Open →" in its header** — three panels used to put a link at the foot of their body and the other ten offered none at all, so the way through sat somewhere different on every panel that had one
- 🎨 **Panel headings and briefing cards carry an icon rather than an emoji** — both now draw from the one set the rest of the app already uses, and emoji stay on the rows that carry one of their own: accounts, shelves and subjects, each of which a household can change
- 🗂️ **A briefing card opens the record it is about** — the lease opens its flat, the fixation opens the loan's own card, the document opens beside the list, and the "about" line names every kind of record paper can be filed against instead of only people and flats
- 📆 **The Overview says which month it is reporting on** — a household that imports July's statement in the second week of August was told it was looking at August, so the caption names the newest month there is data for
- 🏷️ **"Saved each month" is now "Kept each month"** — its bars were always the cash left over once everything had gone out, saving included, and only the title said otherwise
- 🔎 **The register can be narrowed to a whole category group** — arriving from a stage of the chart shows a chip saying which group with a ✕ to clear it, and `/api/v1/transactions` takes the same `group` parameter
- 📡 **The cash-flow API answers for a trailing year and reports the window before** — `period=12m` and `anchor=YYYY-MM` are windows it will now draw, `previous` carries the same totals one window back, and `kept` means the cash left after saving with the amount put aside reported separately as `saved`

### 🐛 Fixed

- 💾 **Savings finally draw as their own band** — the last block on the chart was labelled "Saved & invested" while holding whatever the expense groups had not taken, and the savings categories listed beneath it hung off a node that did not exist, so they were named under the chart and never drawn in it
- 🧮 **A renamed income group stops being counted as spending** — the overspend warning excluded income and savings by the names they ship with, which stopped being true the moment groups became rows a household can rename, recolour or add to
- 🧯 **One briefing source failing no longer empties the whole strip** — a single query that threw took every card with it, leaving exactly the screen a household with nothing to do sees, so nothing about it looked wrong
- 🌍 **A loan's fixation pill names the right month** — the date the fixation ends was read in local time, so anywhere behind UTC the pill printed the month before the one it actually runs to
- 🖼️ **The cash-flow chart's tooltip lost its drop shadow** — a plate lifted off the page above a diagram on which nothing else is
- 📅 **A band and the list it opens now count the same month** — the chart has always summed a card payment on the day the money moved and the register filed it under the day the bank booked it, so a payment straddling a month end was in one month's band and missing from the list that band opened
- 🏦 **A mortgage payment is two lines in the register too** — the chart drew only the interest under Housing and the principal under savings while the list behind either band still held the whole instalment under the category it was filed with, so a band naming 35 000 opened a list adding up to 50 000
- 🏷️ **Two names at the foot of the cash-flow chart stop landing on top of each other** — a name whose row ran past the bottom edge was pulled back inside on its own with nothing then re-checking the name above it, which the two new bands of a split mortgage payment were enough to make visible

### ⬆️ Upgrading

- 🆕 **Everyone is asked once which panels they want** — a person who has never customised their Overview now meets the picker over an empty board instead of the four panels that used to be chosen for them, and "Use the suggested board" puts those four back in one press
- 🔢 **A dashboard reading `/api/v1/cashflow` should re-read `in` as well as `kept`** — `kept` used to mean everything the expense groups did not take, savings included, and now means the cash left after saving, while `in` has grown to include money drawn back out of a savings group
- 📡 **A dashboard reading `/api/v1/transactions` should re-read what a window selects** — `from`, `to` and `month` now pick rows by the day the money moved, the value date where the bank printed one, while each row still reports `bookedAt` and only that
- 🗂️ **One category appears that nobody added** — "Loan principal" is seeded into Saved & invested on the next start, because the half of a recorded loan payment that is not a cost has to have a name both the chart and the register can file it under
- ✅ **Nothing that has to be run** — no schema change and no migration in this release, and the one statement below is a performance index a fresh install already creates
- ⚡ **An existing instance can add the index the register now reads by** — its date bounds are measured on the value date where the bank printed one, which is an expression the booking-date index cannot serve, so a large ledger opens a month faster with this and is correct either way

```sql
-- CONCURRENTLY so the build does not hold up writes to the ledger; it cannot
-- run inside a transaction block, so send it on its own.
create index concurrently if not exists "transaction_effective_on_idx"
	on "transaction" (coalesce("value_on", "booked_on"));
```

## 0.7.1 — 2026-08-29

> The paper was already filed against the record; only the screens had not been told.

### ✨ Added

- 📎 **Every record that can hold paper now shows it** — a flat, a tenancy, a loan, an account, a contact, a transaction, a tax statement and the portfolio each carry the same documents card listing what is filed against them, with a picker for attaching paper already on a shelf on the flat, tenancy, loan, account, contact and transaction cards, and an **Add a document** button that opens capture with the record and its shelf already chosen on the flat, tenancy, loan and contact ones
- 📈 **A broker report is kept rather than read and thrown away** — the portfolio upload was the only one in the product that retained no file, so "where did this figure come from" had nothing to go back to; it is filed on Statements now, linked to the brokerage account, tagged with the broker and the year, and the same bytes uploaded a second time are recognised rather than filed again
- 🗂️ **Subjects are edited in the rail, the way shelves are** — the car, the dog and the household had an archive column since 0.7.0 and nothing in the application that could write it, so **SUBJECTS** now renames a subject, gives it a new emoji, adds one, archives one and brings one back, and only the household refuses to be archived because it is the one subject every document may belong to
- 💸 **A payslip links to the bank credit it was paid by** — the slip stating the gross and the credit stating the net were merged into one salary entry and still had nothing on screen leading from either to the other
- 📄 **The demo ships the paper it talks about** — every document the seed files is now a real generated PDF, with the lease on its tenancy, receipts carrying a variable symbol, a broker report, a restricted identity card and an archived subject, so the viewer, search-by-contents and the restricted rule all have something to show on a fresh install

### 🔧 Changed

- 🔒 **Restricted hides the paper and nothing else** — a salary month keeps its gross and net and loses only the paperclip, and a tax statement keeps what it declared and loses the attachment, because a module's own figures were never the document's and hiding them would answer a question nobody asked
- 📅 **The record owns the deadline** — a lease dated exactly as its tenancy ends, or a re-fixation letter dated as its loan's fixation ends, reminded twice for one date; the record's reminder now stands alone, while a document dated differently is not a duplicate of anything and still reminds on its own
- 🗄️ **Four system shelves instead of two** — Finance and Property join Inbox and Statements as shelves that can be renamed and given a new emoji but never deleted, because payslips, tax attachments and bills are filed into them by key and deleting one broke the next upload
- 🗑️ **Deleting a document takes exactly what only that document was holding** — a payslip takes the month's salary entry with it and the bank credit behind it is re-recorded on its own, a bill or a receipt leaves its transaction untouched, and a bank statement behind an accepted import is refused outright
- 🔍 **The About filter and search know every kind of record** — a document can be filed against nine kinds and the screens offering them each carried their own hand-written list of four, so paper about a tenancy, a loan or a contact could not be found under the name you were shown

### 🐛 Fixed

- 🔗 **Saving a document in the inspector keeps every link it was shown** — the panel offered people, flats and subjects and replaced the whole set with what it had offered, so opening a receipt and pressing Save threw away the payment it evidenced
- 🙈 **A restricted document's name stops appearing on the screens that list it** — the property card, the salary month, the tax attachments and their picker, a transaction's receipts and the Tags view each read the archive their own way and none of them applied the rule, so paper absent from Documents was legible from every one of them
- 🛡️ **The shelves the code files into cannot be deleted** — Finance and Property were ordinary rows a household could remove, which left the next payslip or bill with nowhere to go
- 💥 **Deleting a payslip stops answering with an error** — the month's salary hung off the document by a key that set itself to null, so the delete either left the pay counted with nothing on screen behind it or collided with the index keeping one entry per month and returned a 500
- 📥 **Deleting a bank statement no longer takes the import's only original with it** — the two rows shared a file with nothing keying one to the other; the import now carries the document's id, and the delete is refused rather than quietly removing the evidence behind every row that import wrote
- 🔎 **Every filed document is fingerprinted and queued for reading, whoever filed it** — statements, tax attachments, bills and payslips are written by four different paths and only some of them hashed the bytes or asked for the text, so search-by-contents could not see paper the household had certainly filed
- 💼 **The About picker offers every account rather than only brokerage ones** — it read a hand-written list that happened to be filtered that way, so a bank statement could not be filed against the account it came from
- 🧹 **Capture stops reading form fields nothing posts into** — four per-kind lists were read on every upload and no screen had ever written to them, and none of them could have carried a tenancy or a loan even if one had
- 🏷️ **The Tags view lists the loans a tag is on** — a tagged loan counted towards the headline number and then appeared on nothing, and the delete confirmation now counts everything it would untag, the transactions and split lines with no card of their own included

### ⬆️ Upgrading

- 🆕 **Fresh install and demo only** — the documents baseline was rewritten rather than migrated, so this release is for a new instance; 0.7.0 shipped without an upgrade script and this one does not add one either
- 🛑 **An instance that was upgraded by pulling the image refuses to serve** — the migrator has nothing new to apply to a database built before this release, so the app now checks the schema at boot and stops with the reason rather than starting and failing hours later at the first statement import
- 🛠️ **An instance migrated by hand runs this once, after a backup** — it drops the three columns that left the schema (two on `document`, one on `tax_statement`), keys each import to the statement it read, promotes the two shelves, and leaves the list of allowed document types and the extraction queue to be re-applied from the baseline

```sql
alter table document drop column if exists amount_minor, drop column if exists currency;
alter table tax_statement drop column if exists document_id;
alter table import_file add column if not exists document_id uuid references document(id) on delete restrict;
create index if not exists import_file_document_idx on import_file(document_id);
-- check first: select stored_name, count(*) from document where stored_name is not null group by 1 having count(*) > 1;
update import_file f set document_id = d.id from document d
  where d.stored_name = f.stored_name and d.type = 'bank_statement' and f.document_id is null;
update shelf set system = true where key in ('finance','property');
-- then re-run the enum CHECK for document.type (see baseline) and queue extraction for documents with stored_name and no document_text row.
```

## 0.7.0 — 2026-08-28

> A shelf is where a thing lives, not a word the code agreed on once.

### ✨ Added

- 🗂️ **Shelves are yours to name, reorder and invent** — the ten places a document could live were a list in the source code, so adding "Vehicles" was a migration and renaming one was a rename in three files that could disagree; they are rows now, edited straight in the rail behind a pencil, and deleting one always moves the paper first
- 🔎 **Search reads what is inside a document, not only its name** — a scanned invoice is now findable by the variable symbol printed on page two, matched through a trigram index because an identifier is not a word any text search would recognise
- 📄 **Filed documents are read in the background** — a PDF gives up its text layer page by page, a scanned page is recognised instead, and a plain-text file is sliced; a mixed contract with one signed page is handled correctly in both directions rather than being decided by the file it happens to be
- 🔒 **A document can be restricted to admins** — and "restricted" means absent rather than locked: no row, no count, no search hint, no calendar event, no file, and a member's shelf reads 26 where an admin's reads 27
- 🏷️ **A document says what KIND of paper it is, separately from where it is filed** — the salary tracker used to look on the payslips shelf, so renaming that shelf would quietly unhook a feature; it reads the type now, and the shelf is free to move
- 📬 **An Inbox, and a review flow built for it** — capture asks nothing at all beyond the file, several files at once each become their own document, and filing is a separate pass at email-triage speed where shelf and type carry over between documents
- 📝 **A note, in your own words, on any document** — ranked above its contents in search, because the phrase you would think to type is rarely the one printed on the page
- 🗄️ **A subject can be archived** — a sold car's paperwork stops crowding every list without anything being deleted, and its long-passed expiry stops being painted red
- 🔖 **Tags moved in beside the paper, and each keeps one colour everywhere** — the colour comes from the tag's own name, so nothing has to be stored or agreed; adding one offers the tags you already have, which is what stops `renovation` and `renovations` both existing
- 📥 **A backlog import for the paper already on disk** — `scripts/import-documents.mjs` walks a directory, files by a mapping table you edit, recognises what it has already seen by its bytes, and sends everything unmapped to the Inbox rather than guessing

### 🔧 Changed

- 🔗 **A document's file is served through the document, not through its filename** — `/files/[name]` knew only a name, so a member holding one could open a restricted document; both routes resolve the row first now and answer 404 rather than 403, because a 403 confirms the thing exists
- ⚙️ **One CPU slot, shared by statement imports and text extraction** — two queues would have let an import and an OCR run at once, which is exactly the situation the queue exists to prevent on a box whose web server has to stay responsive
- 📚 **The Documents screen is a list of collapsible groups rather than columns** — a document appeared once per person it was about, so the same contract could be read three times and counted three times; it appears once now, each group says how many need attention and when the next date falls, and grouping is a separate control from sorting
- 📅 **Three expiry verbs instead of four, and the colour stops repeating the word** — `ends` meant exactly what `expires` means, and four near-synonyms is a question nobody can answer; the hue now says whether a deadline has fired, while `renews`, `expires` and `due` carry the kind
- 🏷️ **Tags left the Money area for the Documents rail** — a tag cuts across paper and payments alike, and the household reaches for it from the paper far more often; `/tags` still lands where it went

### 🐛 Fixed

- 🚗 **An expiry that passed on an archived subject is history, not an alarm** — a sold car's lapsed insurance was painted red on every visit, which is how a person learns to ignore red
- 🔢 **A document nobody may see is not counted** — the rail's numbers are computed after the visibility rule rather than before it, so a count can no longer tell a member that something exists

## 0.6.2 — 2026-08-27

> Photographing a page is something you do with the device in your hand, not the one on your desk.

### 🔧 Changed

- 📷 **The camera and scan buttons are offered to phones and tablets rather than to a mouse** — `capture="environment"` is ignored by desktop browsers, so on a computer the photo button opened the same file picker that clicking the field already opens, and the scanner would have opened a webcam, which is a poor way to photograph a page and never what it was built for; a photo dropped or browsed there still becomes a cropped, flattened PDF, so the desktop route to a scan is the one it was always going to be — take the picture on your phone, put the file here
- 🖐️ **A tablet keeps them with a keyboard attached** — the question is whether a finger is available at all rather than which pointer happens to be primary, because an iPad on a Magic Keyboard and a Surface under its type cover both answer "a trackpad" and are both still tablets with a rear camera; a touchscreen laptop keeps a button it does not need, which is the cheaper of the two mistakes

## 0.6.1 — 2026-08-27

> A register you can read is one whose rows are not all shouting at once.

### ✨ Added

- 🪄 **A transaction can start a rule** — "Make a rule" carries the counterparty and what the row is filed as into the rule editor, which until now opened blank and asked you to retype what you had just been looking at
- 📈 **The cash-flow history has an axis, and answers when you rest on it** — every month on record now reads against a labelled scale rather than only against the bar beside it, and hovering one gives what came in, what went out, what was kept and what share of the month that was

### 🔧 Changed

- 📒 **The register is a table of months rather than a run of cards** — a month collapses to what it earned and spent, opens into its transactions, and a transaction opens into everything you can do to it, so reading the ledger no longer costs the price of editing it
- 🔢 **The months and the transactions inside one page separately** — walking the record by month and walking a single month's rows are different movements, and neither moves the other
- 📅 **The tax table opens with every year collapsed** — the newest year used to open itself, so the table never showed the shape it exists for, every year against every other, until something was collapsed first

### 🐛 Fixed

- 📱 **The Salary and Tax summary figures line up on a phone** — the first and last figures pull to the row's outer edges, which spreads them across a wide row and leaves them ragged the moment they stack into one column
- 📏 **The Salary and Tax charts stop printing their axis values over one another** — the geometry is a fixed viewBox, so a narrower card is a shorter chart, and on a phone eight values shared about a hundred pixels; the plot scrolls sideways now, as the tables beside it do
- 📐 **A gridline is labelled with the figure it actually sits on** — the axis rounded each label on its own until they merely differed from one another, which printed `0 · 653k · 1M · 2M · 3M` for five even steps of 653 000: two units on one scale, and a top line overstating itself by a sixth; every label now shares the step its largest value takes and carries the precision that keeps it nearer its own gridline than its neighbour's
- 🏷️ **"Base" and "Bonus" stop overlapping in the Salary table's heading** — both columns had a floor of zero, so the table's scroll width was the only thing holding them open and it left each about 35px, narrower than the word printed in it

## 0.6.0 — 2026-08-26

> Paper is the part of a household ledger that never arrives as a file.

### ✨ Added

- 📷 **Photograph a page and get a scan, not a snapshot** — the page is found in the frame, cropped out of it, flattened from whatever angle it was shot at and written as a black-and-white A4 PDF, which is both legible and about thirty times smaller than the photograph it came from
- 🖼️ **A dropped photo goes through the same pipeline as a captured one** — a picture of a bill someone sent you produces the same document as holding the page under a camera, because the alternative was filing a crooked snapshot of a desk
- ⧉ **Two capture buttons, because a photograph and a scan are different jobs** — one keeps the picture as it came off the camera, the other crops and flattens it into a PDF, and which appear is decided by what the field already accepts
- 📄 **Several pages become one document** — keep them one after another, reorder them, name the file, and the order of the tiles is the order of the pages
- 🎛️ **Black and white, grayscale, colour, or the photograph untouched** — chosen before the page is kept, with the original there as the recovery when the edges come out wrong
- 📱 **Every file input in the product now takes a drop, a click or a photo** — one control, everywhere paper is filed
- 🔒 **HTTPS on the local network without an account or a domain name** — `--profile lan-tls` issues a certificate from a local authority so the camera works from a phone, at the cost of one warning to accept per device

### 🔧 Changed

- 🔍 **Uploading a file is one control rather than a browser default** — drag, click and camera in a single line the height of every other control on the form, with the accepted formats on hover
- 📦 **Installing is one file and one command** — the Tailscale sidecar's configuration now travels inside `compose.yaml` instead of beside it
- 🏗️ **The image is compiled once and installed twice** — the arm64 build no longer runs the bundler under emulation, where the scan engine had made it heavy enough to crash QEMU outright

### 🔒 Security

- 🔐 **Nothing is written to disk before the finished PDF** — the whole pipeline runs in the browser, so no page, no frame and no half-processed image ever reaches the server or a temporary directory

### ⬆️ Upgrading

- 🎥 **The in-app viewfinder needs HTTPS** — browsers refuse camera access on a plain-HTTP address, so the scan button opens your phone's own camera app instead and processes the photo identically; [two routes to a certificate](docs/install.md#https) are in the Compose file and neither needs a domain name

## 0.5.7 — 2026-08-25

> Two payslips in a month is what 0.5.5 was for; the same payslip twice never was.

### 🐛 Fixed

- 🧬 **The same payslip file uploaded again is recognised rather than filed a second time** — a month may hold two slips since 0.5.5, which removed the only key that had been catching a re-upload, so the same file made a second document, a second statement and a month reporting double pay; the file's own bytes identify it, never its figures, because two jobs paying alike in one month are a real arrangement and must not be merged
- 📥 **Filing a run of payslips lists back the ones already on the shelf** — dropping the same folder in twice filed every slip again without a word, and the same file chosen twice in one go became two statements before it ever reached the shelf
- ✅ **A filed payslip says so with the form gone, not still standing** — the dialog stayed open with its fields full and Add still under them, so the only way to learn whether the slip had landed was to press Add again, on the one screen where a second press files a second payslip; what is left is the news, Done, and Add another

## 0.5.6 — 2026-08-25

> A month can hold two payslips as of 0.5.5, and nothing on screen said so.

### 🐛 Fixed

- 📐 **The tax statement's controls line up along one row again** — "Gross income · from 12 payslips" wraps to two lines where "Whose" and "Year" take one, which pushed the last field a whole line below the four beside it

### 🔧 Changed

- 🔢 **A month holding more than one payslip says which row is which** — "1 of 2" on each, because two rows carrying the same month are what two jobs look like AND what a mistaken re-upload looks like, and unmarked they read as a duplicate
- 💬 **Filing a slip against a month that already had one says so, and stays open to be read** — an upload stopped replacing what was there in 0.5.5, which is right and was invisible

## 0.5.5 — 2026-08-25

> A month can be worked at two jobs, a year of payslips can be filed in one go, and the wordings now cover the languages a household is likely to be paid in.

### ✨ Added

- 👔 **A month can hold more than one payslip** — it held exactly one, so a second employer's slip for the same month replaced the first and a month worked twice reported half its pay; the year rows add a month's statements together, and each slip keeps its own figures, its own currency and its own file
- 📚 **A run of payslips can be filed at once** — "Add several" reads each slip for its month, its figures and its currency and files them one by one, listing back by name every file it could not read with confidence, because nobody checks twelve slips in a dialog
- 🌍 **German, French, Italian, Polish, Dutch and Portuguese wordings** — for gross, for net, for a bonus, for the employer-cost lines that must never be read as gross, and for month names, so the first slip from a new employer reads itself rather than waiting to be taught

### 🔧 Changed

- 🗑️ **Uploading a payslip never deletes one already filed** — a re-upload replaced the month's slip, which cannot survive a month having two; an upload only ever adds, and removing a slip is the ⋯ menu's job
- 🔑 **A correction names the statement it is correcting** — "the entry for August" stopped being a question with an answer once August could hold two

## 0.5.4 — 2026-08-25

> Measured again over a longer run of payslips: five payroll layouts across four years, 33 of 35 months read without a correction.

### 🐛 Fixed

- 🗓️ **A two-digit year is a date** — "Periódo de liquidación 01/01/23" matched no pattern at all, so a whole layout filed no month; it is ranked below every form that states its year in full, because a slip carries the date the job started as well as the month being paid
- 📆 **Each way of writing a date is tried across the whole slip before the next is** — trying them line by line reached an employment start date near the top of the page and answered with it, while the period the same slip printed further down went unread
- 🔻 **A figure named by the wording UNDERNEATH it is read** — some payrolls rule the page and print the heading below its own figure, which is the same table read upside down
- 🔢 **An exact wording beats a loose one whichever pass found it** — the column pass sat behind the line-at-a-time one, and a loose match on a line of IBAN digits is still a match, so five payslips were read as 1,00 while the heading printed directly under the real figure went unlooked at
- ⋯ **Dot leaders are not part of a wording** — a payslip that rules its page with dots left every label unable to end at its keyword, so the tight test could never fire on it

## 0.5.3 — 2026-08-25

> Measured against a real run of payslips: three payroll layouts over three years, of which the reader could read two.

### 🐛 Fixed

- 📊 **A payslip printed as a table is read** — some payrolls put the headings on one row and the figures on the next, where a line-at-a-time reading sees only "40:00 405 750 279 091", three numbers labelled by other numbers; a figure is now labelled by the heading standing over its column, which is what made a whole layout unreadable
- 📅 **The month is the one the slip calls its period, not the one it was processed in** — "Period:October 2025 Processed: 07.11.2025" was read as November, filing three months of pay against the wrong month; an explicit period wins, then a month named in words, then a bare date
- 🇪🇸 **Spanish payslips are read** — they name no "gross" and no "net", so the withholding base and the amount actually transferred are what the reader looks for, and a day-month-year pay date is now a date it recognises

### 🔧 Changed

- 🔎 **A heading over a column is consulted only where the label beside the figure found nothing** — the text on the same line is the tighter evidence, and a column heading must not be able to outrank it

## 0.5.2 — 2026-08-25

> The reader already learned which line was gross — except it never really did, because what it remembered could not match the next month's slip.

### 🐛 Fixed

- 🧠 **A corrected wording is remembered in a form that can match next month** — a joined table row carries the neighbouring column into the label, so what was learned in January read "…189 294 income tax base" and February's slip never printed it again; every wording learned before this release was dead the moment it was stored, which is why a year of hand corrections taught the reader nothing
- 🎯 **The wording learned is the one that names the figure, not that one plus the column beside it** — learning took the last label on the row, which pointed at the wrong column the moment the two figures differed
- 👔 **Two employers in one year no longer wipe each other's wordings** — one slot per person meant each correction erased the other payroll's, so alternating between them relearned the same two labels forever and neither was ever there when its own slip arrived

### ✨ Added

- 💱 **The reader remembers which currency a person's payslips are in** — plenty of slips print no currency anywhere on the page, so the field had to be answered by hand every month for a job that had not changed; a currency you state, on an upload or as a correction, is remembered for the next one
- 🗣️ **A remembered currency says it is remembered** — "read from the slip" is a fact printed on the paper and "what was stated last time" is a guess about an employer, and the dialog no longer says the second in the words of the first

### 🔧 Changed

- 📄 **A currency printed on the slip always beats the remembered one** — a job can change, and what is on this month's paper is the better authority
- 🗂️ **A person carries up to six learned wordings per figure, newest first** — a payslip layout is a property of the employer, not of the person, and a household member holds more than one job over a working life

## 0.5.1 — 2026-08-25

> A payslip has a currency of its own, and the app had been reading it off the household's settings instead.

### 🐛 Fixed

- 💱 **A payslip is filed in the currency it is printed in, not the household's base** — the two are different questions, and on a household reporting in euro every Czech payslip was stored as 135 887 EUR, which every conversion downstream then multiplied by the euro rate
- ✏️ **A month's figures are corrected in that month's own currency** — a correction was parsed as the base currency whatever the month was filed in, so fixing one koruna figure stored a euro one
- 📐 **Base pay can be corrected** — it is gross with the award taken out and was read-only for that reason, which left the one figure a person actually knows as the one they could not touch; saving it writes gross and leaves the award alone
- 🧾 **A payslip row shows the figures the slip printed, in the currency it printed them in** — every row was restated into the household's currency, so a Czech slip's 135 887 Kč was read back as a euro amount that appears nowhere on the paper the row links to; the year rows and the summary band stay converted, because comparing years cannot be asked across currencies

### ✨ Added

- 🪟 **An uploaded file opens over the screen that linked to it** — a new browser tab took the whole app away to show one PDF, and coming back was a tab switch rather than the Escape key; cmd-click, right-click and the Download and Open-in-tab buttons all still open a tab for anyone who wants one
- 🔎 **The upload dialog reads the slip's currency and asks when the slip does not say** — the field is required and starts empty, because a default nobody looked at is how this went wrong in the first place
- 🔄 **A month already filed can have its currency corrected from its ⋯ menu** — a relabel and never a conversion, for the months filed before this release and for slips whose file is gone
- 🎨 **Each person has one colour across the whole app** — assigned over the household rather than per screen, so the same tag means the same person on Salary and on Tax

### 🔧 Changed

- 🏷️ **The payslip row shows whose month it is instead of the word "slip"** — every row in that table is a slip, so the word said nothing the paperclip does not, and each figure now carries its own currency symbol the way a tax statement's does

## 0.5.0 — 2026-08-24

> Nothing here changes what the product does — it changes what the build says, which had grown long enough that nobody was reading it.

### 🐛 Fixed

- ♿ **A panel's drag surface is a group rather than a bare div** — a div carrying a pointer handler is nothing at all to a screen reader, and the board's panels are moved by dragging their body

### 🔧 Changed

- ⬆️ **CI runs its actions on the Node 24 runtime** — every action in the workflow still ran on the Node 20 one GitHub has deprecated, so each run ended in a notice nobody was going to act on
- 🔇 **A prop read once to seed a form now says so** — twenty-seven `state_referenced_locally` warnings crossed every image build, each one a deliberate snapshot the compiler had no way to tell from an oversight, and `untrack` states the intent where the build used to guess at it
- 🐳 **Every release names the image that carries it and how to update a running server** — the notes stopped at what changed and left the reader to work out which tag to pull, so both registries and the two-line `docker compose pull` upgrade are now rendered from a template and appended to the changelog section
- 🏷️ **The tag and the GitHub release are cut only once the image is published** — the old order created both first, so a build that failed afterwards left a tag and a release standing in front of an image nobody could pull, and a pushed tag is not something to take back

## 0.4.6 — 2026-08-24

> A payslip states two figures, and the reader had only ever been told about one of them.

### 🐛 Fixed

- 💰 **A payslip's gross and net are read and stored as two separate figures** — the reader ranked net wordings and everything downstream filed what it found as gross, so the salary history and the tax prefill both reported net pay as gross
- 📊 **The reader takes the amount printed next to a wording, not the last one on the line** — a real payslip is a table whose cells arrive joined, so every column to the right of "Hrubá mzda" kept a label containing it and the tax column was read as the gross
- 🎁 **A bonus is no longer summed out of a whole table row** — the same joined-row problem made one 65 251 award read as 367 766, larger than the gross it was supposedly part of
- 🧾 **The tax statement's gross-income prefill reads real gross** — it summed the same net-shaped figure, understating every year by the tax and insurance withheld and firing the divergence note on correctly-entered statements
- 🔤 **A bonus assembled from more than one line on the slip can now be learned** — the learner required a single line to equal the stated total, so the promise to remember the wording silently failed on exactly the months worth correcting
- 📄 **A bonus correction reads that month's payslip, not any document filed against that person** — with no shelf filter it could read a tax statement while hunting for a bonus line, or learn January's wording for August
- 📐 **The charts' rotated axis titles sit on the band they name** — both were pinned at percentages that missed the money panel's centre and the rate strip's, and would have drifted further the moment a band moved
- 🔇 **The startup backfill says which slips it refused and why** — it counted a slip as re-read and then dropped it in silence, so a run could report four read while filing two

### ✨ Added

- 🧮 **The Salary screen has the Tax screen's shape** — a summary band, a person filter, the chart, then a table of years that opens into the payslips it read them from, in place of one repeated block per person
- 👥 **A household view** — "Both" adds every person's years together, merging the totals rather than averaging the averages, which would weight a person paid for two months the same as one paid for twelve
- 🔍 **The upload dialog reads the slip as soon as you choose it** — gross, net, bonus and the month are filled in for checking before anything is written, and a prefilled figure is not mistaken for a decision you made
- ➕ **Quick-add offers a payslip and a tax statement** — both open their form on arrival

### 🔧 Changed

- 🏦 **Every payslip figure lives on the salary entry, and the document is just the stored file** — the two-source merge that let a net figure be read as gross is gone rather than repaired
- 🔁 **Payslips already uploaded are re-read from their stored files at first boot** — a slip whose file is gone is filed as net, which is what the old reader preferred, rather than guessed at
- ✏️ **Every figure on the Salary screen is labelled and editable** — the amount had no caller in the interface at all, so a misread figure could never be corrected from the screen that owned it
- 🗑️ **A payslip can be deleted or replaced from the Salary screen** — delete removes the month it evidenced and names what is going first; re-uploading a slip for a month updates it in place instead of leaving two
- 🚫 **The reader no longer falls back to the largest amount on the slip** — pointed at gross it would reliably find total employment cost, and a figure the form asks about once beats a confident wrong one
- 📋 **Adding a payslip is a dialog, like filing a tax statement** — it holds its own draft, so a refusal stays on screen with the figures still in the fields
- 📈 **A bonus is drawn at the foot of a salary bar with the base above it** — the other way round, a bonus that changed size each year moved the base's boundary for a reason that had nothing to do with the base
- 🔢 **Both money tables put their All row on top and page their years** — five to a page by default, switchable to 25 or 50, with the lifetime total and the bar's scale still taken over the whole record so neither changes as you page
- 🔤 **A household with one rule is told it has one rule** — the count read "1 rules"
- 📜 **The Rules list pages too** — a household that has filed for a while grows dozens of them, and every one was on a single screen; the most-overridden stay on the first page, which are the ones worth looking at
- 🧹 **A tax year's attachments keep detach and delete behind one ⋯ menu** — a bare ⇥ and a bare 🗑 sat beside a caption claiming delete had moved behind that menu

## 0.4.5 — 2026-08-24

> Bumping the version is now what cuts the release, because remembering to push a tag afterwards is not a plan.

### 🔧 Changed

- 🏷️ **A version bump landing on main cuts its own tag, release and image** — 0.4.3 and 0.4.4 both shipped without one, because the image job only ever ran on a tag somebody had to remember to push
- 📝 **The release notes are the changelog section for that version** — written once, and a version that has no section is refused rather than released blank
- ⛔ **A version that goes backwards is refused** — a revert restoring an older `package.json` would otherwise cut a tag whose image takes `latest`, downgrading everyone who pulls it
- 🔒 **One script owns every file that names a version** — `npm run version:sync` writes package-lock and the install docs from package.json, a pre-commit hook runs it and re-stages what it changed, and CI runs the same script in reporting mode
- 🔢 **package-lock had quietly read 0.4.1 for three releases** — npm only rewrites it when a dependency changes, so a bump touching package.json alone left it behind and nothing read it back

## 0.4.4 — 2026-08-24

> Salary leaves the Retirement screen it never belonged on, and arrives beside the tax it is paid on.

### ✨ Added

- 💼 **Salary is its own screen under Money** — it sat inside Retirement beside a projection that never read it, and "what did I earn" is a question about money rather than about retiring
- 📊 **One chart, three ways to read it** — the average month, the year added up, and the year-on-year change, sharing the Tax screen's geometry so moving between the two tabs teaches nothing new
- 🎁 **A payslip's bonus is read off the slip and drawn apart from the base** — `prémie`, `odměna`, a thirteenth salary or an English performance bonus, summed when a slip lists several, and a correction teaches the wording for next month
- 📉 **Change is drawn twice, base and total** — a one-off bonus moves the total up one year and down the next, which reads as a raise followed by a pay cut when neither happened

### 🔧 Changed

- ⚠️ **A year with fewer than twelve months is marked rather than annualised** — an annual total over three months is a partial year, not a small one, and beside a full year it reads as a collapse
- 📏 **A chart axis no longer prints the same label on two gridlines** — thousands were rounded whole, which is right in a table cell and silently destroys a scale where the range is narrow

## 0.4.3 — 2026-08-23

> A year's filing is several pieces of paper, not one — and the Tax screen is rebuilt around the year rather than around whoever filed.

### 🐛 Fixed

- 💾 **Backups restore now, and every backup taken before this one never could** — the dump named each table's generated `entity_kind` column in its `COPY` headers while `COPY … TO STDOUT` leaves it out of the rows, so every header was one column wider than the data beneath it and PostgreSQL refused the load outright

### ✨ Added

- 📎 **A tax statement holds as many documents as the year actually produced** — the statement itself, the employer's annual income confirmation and the broker's earnings report are three files, and the screen took one
- 🏷️ **Each attachment says what it is** — a kind picked when it is uploaded names the document on the Tax shelf and tags it, so every broker report across every year is one filter away
- 🗂️ **A document can be detached from a statement without being destroyed** — `⇥` removes the connection and leaves the paperwork filed against the person, while the bin deletes the document and its file behind a second tap

### 🔧 Changed

- 📅 **The Tax screen groups by year instead of by person and country** — a household that has filed in four jurisdictions over eight years saw one year in three separate places, so "what did 2024 cost me" was a question the layout could not answer
- 📈 **One chart replaces six** — each bar's full height is that year's gross with the tax hatched at its foot, a second mode draws the effective rate per jurisdiction, and both convert at each year's closing rate rather than at today's
- ⚠️ **A filing far smaller than the rest of the record is flagged rather than left to pass unremarked** — under five per cent of the median, which catches a part-year filing or a units error without naming a currency or an amount
- 🎨 **Four measured pastel fills carry the jurisdictions** — dark clears the palette's colour-vision floor at 9.7, and light cannot at any value, which is recorded beside the tokens along with what was tried

### ⬆️ Upgrading

- 🗄️ **The schema change is folded into the baseline, so a fresh install needs nothing** — a running instance is rebuilt instead: take a backup on this version, drop the database, boot, restore, then register the tax statements as entities and carry their old single `document_id` into `document_link`

## 0.4.2 — 2026-08-23

> A server that gave up on a database it was designed to wait for.

### 🐛 Fixed

- 🔁 **A database that is not ready yet no longer kills the app** — the start-up hook let the boot failure escape, which is fatal to the process, so the retry already built into the boot path never got the chance to run

## 0.4.1 — 2026-08-22

> One defect that only ever showed on somebody else's machine, and the removal of the tests that could not tell you about it.

### 🐛 Fixed

- 📏 **A name on the cash-flow diagram is never cut in half, on any machine** — the engine guessed each name's width from its character count, and any face wider than Inter beats that guess, so names are now measured in the faces they are actually drawn in, the diagram is laid out again when the real face arrives, and a name that still cannot be drawn whole is left out rather than cut

### 🔧 Changed

- 🧪 **The browser suite is gone, and with it the browser from CI** — two hundred and ten Playwright tests mostly proved that a machine with its database in the next room finishes a write before the next click, which is not true of a machine with its database in the next container, and what stays is the 1 542 unit and embedded-PostgreSQL tests over the parsers, the domain modules, the schema and the arithmetic
- 🧪 **The private-corpus and live-CalDAV suites are gone too** — they skipped themselves in CI for want of files and credentials that are on one laptop, while the committed 355-file synthetic corpus still holds every parser to each statement's own arithmetic
- 📏 **The pixel baseline is gone** — fourteen full-page screenshots guarded the geometry sweep 0.4.0 was built on, and what was left was 2.6 MB of PNGs recaptured on every deliberate change, on macOS only, where CI could never run them

## 0.4.0 — 2026-08-22

> A minor release rather than the eleventh patch of 0.3: salary reads the ledger, a property's value is a series, realised gains carry tax, the category tree belongs to the household rather than to the source code, an instance can be run with no credentials at all, and the chart palette and the interface's sizing were measured rather than chosen.

### ✨ Added

- 🗂️ Category groups are data, not code — add, rename, recolour and delete them, from the review queue where the need is felt or from Settings
- ❤️ **Health & care** and **Subscriptions** groups; Pharmacy, Doctor & dentist and Reimbursements categories, and Internet and Phone split apart
- 🎨 A chart palette generated in OKLCH and validated for separation under normal, protanopic and deuteranopic vision — nine group colours plus ten reserve, each with its own light and dark value
- 🔁 One-sided transfers: money moved to an account whose statements you never import stops counting as spending
- 🧾 Receipts on transactions — attach a file to the payment it evidences, filed in Documents under Receipts
- 🏦 Add a bank the list does not have, instead of filing the account under "Other"
- ✏️ Loans can be edited, including which properties secure a mortgage and in what share
- 🏠 Estimated value and money-in are editable on a property; the figures derived from loans are not, and say where they come from
- 📅 A lease can have no end date, and adding a tenant now files them in Contacts, reusing their record when the name matches
- 🚪 Open mode — an administrator can drop credentials for the whole instance, confirmed with their own password; the setup wizard can start one that way too
- 🔑 The setup wizard asks for the password twice; a typo in the only password on a fresh instance used to lock its owner out immediately
- 📏 Narrow-viewport tests across fourteen screens, for overflow and clipped text — the widths where the reported truncation actually happened
- 🧾 **Every accepted statement is filed in Documents**, on its own Statements shelf, tagged with the bank, the account and the year — the file was always kept, but nothing ever surfaced it
- 💼 **Salary history reads the ledger** — a salary credit you have already categorised becomes salary history, net from the bank and gross from a payslip, both on the same month rather than averaged into a figure that is neither
- 📈 **A property's value is a series, not a number** — enter what it was worth in past years and see the line, and recording what it cost to buy computes money-in instead of asking you to reconstruct it
- ⚖️ **Tax on realised investment gains**, at a rate you set, with a holding-period exemption that matches the Czech three-year time test and is off by default because it applies nowhere else
- 🖱️ **Categories can be dragged into the order you want**, or moved with the arrow keys, and a catch-all — "Everything else", "Other income" — stays last whatever else is added
- ✏️ **Accounts are editable**: name, bank, type, and the account numbers statements are matched against, which were recorded and learned but never shown
- 👤 **An account can belong to someone** — everything was joint by omission, because nothing ever set an owner
- 🎛️ Loans gained rate regime, interest accrual, day count and deductibility to their edit — described the loan, so changing one re-derives the schedule without touching a recorded fixation period
- ✕ The import queue and the recent-import list can be cleared, and a finished job leaves on its own after ten minutes
- 📐 A geometry scale — radius, spacing and one control height — enforced by a lint rule, so a raw value beside a token cannot drift back in
- 🗑️ **A tag can be deleted** — everything carrying it is untagged by the delete itself and any rule that applied it stops applying it, with the confirmation saying how much of each before it is taken
- 🗑️ **A document can be deleted** — there was no way to unfile a mistyped name, a receipt attached to the wrong row or a duplicate scan, and removing one now takes its links, its tags and the stored file with it
- 🧾 **A tax statement can bring its own paperwork** — rather than pointing at a Tax-shelf document somebody had to create first on another screen, the statement takes the file itself and commits the two together, under a name derived from the year and country so the shelf and the statement cannot disagree

### 🔧 Changed

- 🧪 **The browser suite is gone, and with it the browser from CI** — two hundred and ten Playwright tests mostly proved that a machine with its database in the next room finishes a write before the next click, which is not true of a machine with its database in the next container, and what stays is the 1 542 unit and embedded-PostgreSQL tests over the parsers, the domain modules, the schema and the arithmetic
- 🧪 **The private-corpus and live-CalDAV suites are gone too** — they skipped themselves in CI for want of files and credentials that are on one laptop, while the committed 355-file synthetic corpus still holds every parser to each statement's own arithmetic
- 📏 **The pixel baseline is gone** — fourteen full-page screenshots guarded the geometry sweep this release is built on, and what was left was 2.6 MB of PNGs recaptured on every deliberate change, on macOS only, where CI could never run them
- 🌐 **`ORIGIN` no longer decides whether a form is accepted** — the check compares what the browser sent against the host it sent it to, so sign-in works at every address the server answers on and `ORIGIN` is optional, governing only passkeys
- 🗂️ **Documents is its own sidebar row**, after Calendar, and Settings is the gear beside the wordmark — sharing an "Admin" row put paperwork you open often behind the same click as configuration you open rarely
- 🚪 The open-instance warning moved from every screen to Settings and the sign-in page — where somebody who did not expect it actually meets it, before they are inside
- 🗑️ Deleting a category counts what depends on it first: an unused one goes without a question, and one with history asks in a dialog naming how many transactions and rules are filed under it
- 💧 One definition for form controls, replacing the recipe copied into twenty-seven stylesheets — where its padding had already drifted
- 📆 The money screens show the newest month that holds data, and name it — statements arrive after a month ends, so "this month" was routinely empty
- 🔑 Passkeys are offered based on the address you are browsing, not the one in `ORIGIN` — and where they are absent, the screen names the address that works
- 🔠 Twenty-two font sizes became a nine-step ramp — half a pixel is not a size anyone chose, and 12 / 12.5 / 13 / 13.5px side by side is what "different fonts" looks like
- 🖱️ Buttons show they were pressed, show when they are disabled, and show keyboard focus — none of which existed
- 🧮 Every screen reads the category groups from the database, so a group a household adds appears in the charts and filters without a deploy
- 📎 **Receipts moved behind one button per transaction** — a file input and its chips under every row cost a line each on a page that is nothing but rows, so the paperclip carries the count and the dialog behind it holds the attachments
- 🔟 **The register shows 10, 25 or 50 rows a page** — ten by default, chosen beside the running total, and held in the URL like every other part of the view so a narrowed register stays shareable at the size it was read in
- 🟥 **A negative amount is red** — it was the same near-white as the merchant beside it, so only the minus sign said which way the money went, and the sign is the first thing a scanning eye drops
- 💰 **A transaction's amount sits under its date**, at the size of the line beside it, with weight and colour still carrying the sign — at the old display size it was the loudest thing on a screen made of hundreds of them
- 🗑️ **Removing a receipt deletes the document, not just the link** — unlinking left the file on the Documents shelf with no route back to the row it came from, so it asks twice, because a receipt filed against something else goes from there too
- ✏️ **The pencil on an account sits beside its name** — the row is a three-column grid and held four children, so the button was pushed onto a second grid row at the bottom of the card
- 📄 **A document's name wraps rather than truncating** — half of "Fio · 1234567890/2010 · July 2026" identifies nothing
- 🏷️ **A transaction's state is a pill, at the end of its row** — it reads in the palette every other state in Continuum uses and sits under the paperclip where the row's own facts belong, rather than being plain grey text ahead of the controls
- 🔗 **Category, Save, Split and the paperclip sit at one gap**, as the strip of controls they are, rather than spread at the gap between separate things
- 💱 **A tax statement's currency is chosen, not typed** — the field was free text, so a display symbol, a misspelling or a currency nothing can convert all went in as if they were codes, and "Kč" once did

### 🐛 Fixed

- 📈 **XTB imports failed on any report containing a dividend, a withholding tax or a closed position** — operations were written before the positions they reference, against a foreign key that is not deferrable
- 🧾 An import failure was rendered twice; it is now shown once, and can be dismissed
- 🏷️ "File" on a transaction did nothing visible — it meant _file under a category_, is now called Save, is disabled until one is chosen, and shows its refusal beside the row that caused it
- 📊 "Saved each month" had no scale and no readout; hovering a bar now shows the month and the amount
- 📊 "Every month on record" labelled years on a three-month history; it labels months until there are two years of it
- 📱 Settings scrolled sideways on a phone, and the calendar feed token — which the text beside it tells you to copy — was cut off
- 🔑 "Add a passkey" reads "Add another" once you have one; passkeys are per-device and the button stays on purpose
- 🇨🇿 The Czech interest-deductibility claim is gone from Loans, where there is no jurisdiction concept and the tax statements carry the real figures
- 💳 **A Revolut export could not be imported at all** — Revolut writes every pocket into one file and each keeps its own running balance, so a three-row Savings pocket was checked against a Current account's chain and refused, where read as one statement per pocket the same 1 798-row file proves on every row
- 🏦 **Fio's "Pohyby na účtu" export is refused by name** — it prints no balances at all, so nothing in it can show whether every row is there, and instead of a mapping screen no answer could satisfy it now says which export to download
- 💾 **Retirement assumptions never saved** — the page issued a UUIDv7 and the check accepted only versions 1–5, so every autosave was refused with "The save writer is invalid" and no assumption had ever been stored
- ⬇️ **"Choose a category…" opened off the bottom of the page** — a native select's popup is placed by the browser, and the replacement measures the room it has and opens upwards when there is more above
- 🔀 **Ribbons crossed on the cash-flow diagram** — its ordering pass read the positions of the previous column before anything had been placed there, so every column fell back to ordering by size alone and a real household year drew 57 crossings where it now draws none
- 🏷️ **Every name sits level with the middle of the band it names**, in every column — a block's outgoing ribbons cover its height exactly, so each column now writes into a channel of its own that no ribbon is allowed into, rather than moving the fault by placing the name above the band
- 📎 **A name that cannot stay level with its band is joined to it by a leader line** — four small incomes stacked at the foot of a column have bands thinner than their own names and have to be spread apart to be read at all
- 🔠 **Nothing is left unnamed to save room** — a crowded column shrinks its own type until every name fits, rather than naming the largest few and leaving the rest to hover
- 〰️ Ribbons hold their line as they leave a block and turn once, rather than starting to curve immediately: a dozen parallel bands used to smear into one another
- 🏷️ Cash flow showed a negative "Kept" in green
- 📏 The salary-history row carried controls of five different heights; the setup wizard's repeat-password box fell onto a line of its own; the mapping wizard's columns did not line up; "0.0" on the retirement chart sat on top of the year beneath it
- ➕ Adding a property or a loan immediately reopened the form for the next one
- 🔵 The line on "Value against money in" ended in a dot that read as a defect
- 📏 **Every field is one height, and the boxes in a row line up** — a text input, a select and a file field measured 34, 36 and 42 pixels at the same nominal size, so one line box and one floor now apply to every input, select, textarea and button, with the file field's button styled to live inside that height rather than set it
- 🧾 **The itemised lines on a tax statement line up with the fields under them** — the two boxes split 1.4 to 1 with their own gap while the section below split evenly, so they share the same two columns now and the remove button rides in the amount's column
- ⚖️ **The tax rate on investment gains could not be saved** — the years field is disabled until the exemption is switched on and a disabled field is not posted at all, so the field now follows the checkbox as it is clicked and an unposted threshold keeps what was already stored
- 🏷️ **A transaction filed before review had no state at all** — `filed` is one of the four states the schema allows and the register named three, so the names and colours now live beside the states themselves, where a fifth one cannot compile without them
- 🔢 **The threshold went blank the moment it saved** — a successful submit reset the form, and a reset empties any field whose value the framework set as a property rather than an attribute, so the figure was stored correctly but the box that should have shown it was empty
- 📈 **The years under "Value against money in" did not line up with the rules they name** — they were spread evenly across the axis while the rules stand where each year actually begins, and both now come from the same point in the series

### ⬆️ Upgrading

- **The version jumps from 0.3.10 to 0.4.0** — there is no 0.3.11, the work outgrew a patch number while it was being written, and nothing about the upgrade differs because of it
- ⚠️ **Start 0.4.0 on an empty database** — the schema lives in one baseline file that folds six new tables, columns and constraints into it, and the migrator records that baseline as already applied, so an 0.3.10 database is left without any of them and the app fails against its own schema
- **`ORIGIN` changed meaning and is now optional** — it no longer decides whether a form submission is accepted, which is checked against the address your browser actually used, and it is set only to enable passkeys at the one HTTPS address they bind to
- The chart colours change, because the palette that shipped before failed measurable separation in both themes — housing and living were indistinguishable to a deuteranopic reader, and in the light theme transport and bills were effectively one colour

## 0.3.10 — 2026-08-19

> There is no 0.3.9. Its tag was cut against a commit whose CI could not run, tags are immutable here, and nothing had been published under it — so the number was left behind rather than moved.

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

**⬆️ Upgrading:** ⚠️ **a clean break — 0.3.10 will not start on an 0.3.8 database, and a backup does not carry the data across.** The whole migration chain is replaced by one baseline, so a database that stopped at `0045` fails on boot with `CREATE TABLE "currency"` already existing; and an 0.3.8 backup is a column-by-column `COPY` naming tables and columns this release renamed or removed. Start 0.3.10 on an empty database. This is affordable exactly once, because nothing was running 0.3.8 yet — from this baseline the schema is additive-only, and every release after it upgrades in place.

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
