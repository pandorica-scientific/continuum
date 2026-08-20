CREATE TABLE "bank" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"emoji" text DEFAULT '🏦' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_group" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"color_token" text NOT NULL,
	"role" text DEFAULT 'expense' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Seeded here as well as on boot, because the foreign key below is added in
-- this same migration: an instance that already holds categories would fail the
-- constraint against an empty table. Kept in step with src/lib/categories.ts,
-- which reseeds idempotently on every boot.
INSERT INTO "category_group" ("key", "label", "color_token", "role", "sort") VALUES
	('income',        'Income',            '--series-income',        'income',  0),
	('taxes',         'Taxes & fees',      '--series-taxes',         'expense', 1),
	('bills',         'Bills & utilities', '--series-bills',         'expense', 2),
	('subscriptions', 'Subscriptions',     '--series-subscriptions', 'expense', 3),
	('health',        'Health & care',     '--series-health',        'expense', 4),
	('transport',     'Transport',         '--series-transport',     'expense', 5),
	('living',        'Food & lifestyle',  '--series-living',        'expense', 6),
	('housing',       'Housing',           '--series-housing',       'expense', 7),
	('savings',       'Saved & invested',  '--series-savings',       'savings', 8)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
-- Any group an existing category names that the seed does not cover. Adopting
-- it is the only way to attach the key without discarding what the category
-- said about itself; it takes the last reserve token and can be recoloured.
INSERT INTO "category_group" ("key", "label", "color_token", "role", "sort")
SELECT DISTINCT "group_key", "group_key", '--series-r10', 'expense', 99 FROM "category"
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "bank" ("key", "label", "emoji") VALUES
	('fio', 'Fio banka', '🏦'),
	('revolut', 'Revolut', '💠'),
	('mbank', 'mBank', '🅜'),
	('rb', 'Raiffeisenbank', '🟡'),
	('cs', 'Česká spořitelna', '🔵'),
	('other', 'Other', '💼')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_group_key_category_group_key_fk" FOREIGN KEY ("group_key") REFERENCES "public"."category_group"("key") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
-- drizzle-kit models neither CHECK constraints nor the index a foreign key
-- wants, so both are carried by hand exactly as the baseline carries its own.
ALTER TABLE category_group ADD CONSTRAINT category_group_role_check
	CHECK (role in ('income', 'expense', 'savings'));
--> statement-breakpoint
CREATE INDEX "category_group_key_idx" ON "category" USING btree ("group_key");
