-- The supertype every linkable record registers in.
--
-- Ten of the thirteen link tables were pure fan-out from three connectors —
-- `tag` reached five tables, `document` four, `contact` four — so every new
-- module multiplied them: a vehicle would have cost `document_vehicle`,
-- `vehicle_tag` and `contact_vehicle` before it held a single column of its own.
-- One supertype collapses those ten into three (migration 0050), and both ends
-- of every link keep a real foreign key and a working cascade.
--
-- Three decisions worth stating, because each one is load-bearing.
--
-- 1. `UNIQUE (id, kind)` exists so a concrete table can reference the PAIR. Each
--    table carries a generated `entity_kind` column fixed to its own kind, so a
--    `tag` row can only ever point at an entity registered as a tag. Without it
--    a link table would happily accept an id belonging to a different kind of
--    record, and the resulting row would read as perfectly valid.
--
-- 2. Registration is a BEFORE INSERT trigger, not something callers remember.
--    That is what makes this safe to add to eleven tables at once: no insert
--    path above the database changes, and an insert that "forgot" to register
--    cannot exist. A helper would have been one more thing to omit, and the
--    composite foreign key would then have turned the omission into a failed
--    write at some unrelated call site.
--
-- 3. Deletion works in both directions. Removing the entity cascades to the
--    record; removing the record retires the entity through an AFTER DELETE
--    trigger. Only the first is a foreign key, so without the second the
--    supertype would fill with orphans that a later link could still attach to.
--    The two do not recurse: by the time either trigger runs, the row it would
--    delete is already gone.
--
-- Drizzle models tables, not triggers or generated columns. None of the DDL
-- below can be recreated from `schema.ts`, `db:generate` cannot notice it going
-- missing, and a database built with `drizzle-kit push` would have the tables
-- without the integrity they depend on. Build the schema with migrations.
--
-- Ids stay `text` here. Converting them to `uuid` is its own migration, kept
-- separate so a failure there cannot also unpick the supertype.

CREATE TABLE "entity" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "entity_id_kind_key" ON "entity" USING btree ("id","kind");--> statement-breakpoint
CREATE INDEX "entity_kind_idx" ON "entity" USING btree ("kind");--> statement-breakpoint

-- Drizzle cannot express a CHECK, so the kind stays open to typos without this.
-- The list comes from ENTITY_KINDS in src/lib/enums.ts and is held to it by
-- tests/integration/schema-invariants.test.ts.
ALTER TABLE "entity" ADD CONSTRAINT entity_kind_check CHECK (kind in (
	'person', 'account', 'transaction', 'transaction_split', 'property',
	'tenancy', 'loan', 'document', 'contact', 'tag', 'subject'));--> statement-breakpoint

-- Backfill, carrying each record's own creation time where its table records
-- one. Stamping `now()` across the lot would flatten the only ordering some of
-- these records have.
INSERT INTO entity (id, kind, created_at) SELECT id, 'person', created_at FROM person;--> statement-breakpoint
INSERT INTO entity (id, kind, created_at) SELECT id, 'account', created_at FROM account;--> statement-breakpoint
INSERT INTO entity (id, kind, created_at) SELECT id, 'property', created_at FROM property;--> statement-breakpoint
INSERT INTO entity (id, kind, created_at) SELECT id, 'loan', created_at FROM loan;--> statement-breakpoint
INSERT INTO entity (id, kind, created_at) SELECT id, 'contact', created_at FROM contact;--> statement-breakpoint
INSERT INTO entity (id, kind, created_at) SELECT id, 'tag', created_at FROM tag;--> statement-breakpoint
INSERT INTO entity (id, kind, created_at) SELECT id, 'subject', created_at FROM subject;--> statement-breakpoint
INSERT INTO entity (id, kind) SELECT id, 'transaction' FROM transaction;--> statement-breakpoint
INSERT INTO entity (id, kind) SELECT id, 'transaction_split' FROM transaction_split;--> statement-breakpoint
INSERT INTO entity (id, kind) SELECT id, 'tenancy' FROM tenancy;--> statement-breakpoint
INSERT INTO entity (id, kind) SELECT id, 'document' FROM document;--> statement-breakpoint

-- One generated column, one composite foreign key and two triggers per kind.
-- Written as a loop because eleven copies of the same four statements is eleven
-- chances for one of them to differ by accident.
DO $outer$
DECLARE
	t text;
	has_created_at boolean;
BEGIN
	FOREACH t IN ARRAY ARRAY[
		'person', 'account', 'transaction', 'transaction_split', 'property',
		'tenancy', 'loan', 'document', 'contact', 'tag', 'subject'
	]
	LOOP
		EXECUTE format(
			'ALTER TABLE %I ADD COLUMN entity_kind text GENERATED ALWAYS AS (%L) STORED', t, t);

		EXECUTE format(
			'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (id, entity_kind)
				REFERENCES entity (id, kind) ON DELETE CASCADE',
			t, t || '_entity_fk');

		-- A table that records its own creation time hands it to the entity, so
		-- the two never disagree. The demo seed inserts rows dated years back;
		-- stamping now() here would have given those records an entity younger
		-- than the record itself, which is the divergence that makes a shared
		-- audit column worth having in the first place.
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = t AND column_name = 'created_at'
		) INTO has_created_at;

		IF has_created_at THEN
			EXECUTE format($f$
				CREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql AS $b$
				BEGIN
					INSERT INTO entity (id, kind, created_at)
						VALUES (NEW.id, %L, COALESCE(NEW.created_at, now()))
						ON CONFLICT (id) DO NOTHING;
					RETURN NEW;
				END $b$;
			$f$, t || '_register_entity', t);
		ELSE
			EXECUTE format($f$
				CREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql AS $b$
				BEGIN
					INSERT INTO entity (id, kind) VALUES (NEW.id, %L)
						ON CONFLICT (id) DO NOTHING;
					RETURN NEW;
				END $b$;
			$f$, t || '_register_entity', t);
		END IF;
		EXECUTE format(
			'CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION %I()',
			t || '_register_entity_trg', t, t || '_register_entity');

		EXECUTE format($f$
			CREATE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql AS $b$
			BEGIN
				DELETE FROM entity WHERE id = OLD.id;
				RETURN OLD;
			END $b$;
		$f$, t || '_retire_entity');
		EXECUTE format(
			'CREATE TRIGGER %I AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION %I()',
			t || '_retire_entity_trg', t, t || '_retire_entity');
	END LOOP;
END $outer$;
