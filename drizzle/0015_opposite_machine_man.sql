CREATE TABLE "document_account" (
	"document_id" text NOT NULL,
	"account_id" text NOT NULL,
	CONSTRAINT "document_account_document_id_account_id_pk" PRIMARY KEY("document_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "document_person" (
	"document_id" text NOT NULL,
	"person_id" text NOT NULL,
	CONSTRAINT "document_person_document_id_person_id_pk" PRIMARY KEY("document_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "document_property" (
	"document_id" text NOT NULL,
	"property_id" text NOT NULL,
	CONSTRAINT "document_property_document_id_property_id_pk" PRIMARY KEY("document_id","property_id")
);
--> statement-breakpoint
CREATE TABLE "document_subject" (
	"document_id" text NOT NULL,
	"subject_id" text NOT NULL,
	CONSTRAINT "document_subject_document_id_subject_id_pk" PRIMARY KEY("document_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "document_tag" (
	"document_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "document_tag_document_id_tag_id_pk" PRIMARY KEY("document_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "loan_tag" (
	"loan_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "loan_tag_loan_id_tag_id_pk" PRIMARY KEY("loan_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "property_tag" (
	"property_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "property_tag_property_id_tag_id_pk" PRIMARY KEY("property_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '🏠' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "document_account" ADD CONSTRAINT "document_account_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_account" ADD CONSTRAINT "document_account_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_person" ADD CONSTRAINT "document_person_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_person" ADD CONSTRAINT "document_person_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_property" ADD CONSTRAINT "document_property_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_property" ADD CONSTRAINT "document_property_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_subject" ADD CONSTRAINT "document_subject_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_subject" ADD CONSTRAINT "document_subject_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tag" ADD CONSTRAINT "document_tag_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_tag" ADD CONSTRAINT "document_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_tag" ADD CONSTRAINT "loan_tag_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_tag" ADD CONSTRAINT "loan_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_tag" ADD CONSTRAINT "property_tag_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_tag" ADD CONSTRAINT "property_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
--> statement-breakpoint
-- One place for a document to always belong: the household.
INSERT INTO "subject" (id, name, emoji) VALUES (gen_random_uuid()::text, 'Household', '🏠');
--> statement-breakpoint
-- 1. Subjects naming a person.
INSERT INTO "document_person" (document_id, person_id)
SELECT d.id, p.id FROM "document" d
JOIN "person" p ON lower(trim(d.subject)) = lower(trim(p.name))
WHERE d.subject <> '';
--> statement-breakpoint
-- 2. Subjects naming a flat.
INSERT INTO "document_property" (document_id, property_id)
SELECT d.id, pr.id FROM "document" d
JOIN "property" pr ON lower(trim(d.subject)) = lower(trim(pr.name))
WHERE d.subject <> ''
  AND NOT EXISTS (SELECT 1 FROM "document_person" dp WHERE dp.document_id = d.id);
--> statement-breakpoint
-- 3. Subjects naming a brokerage account.
INSERT INTO "document_account" (document_id, account_id)
SELECT d.id, a.id FROM "document" d
JOIN "account" a ON a.kind = 'brokerage' AND lower(trim(d.subject)) = lower(trim(a.name))
WHERE d.subject <> ''
  AND NOT EXISTS (SELECT 1 FROM "document_person" dp WHERE dp.document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM "document_property" dr WHERE dr.document_id = d.id);
--> statement-breakpoint
-- 4. Everything else becomes a subject record, one per distinct name.
INSERT INTO "subject" (id, name, emoji)
SELECT gen_random_uuid()::text, trim(d.subject), '📁'
FROM "document" d
WHERE d.subject <> ''
  AND NOT EXISTS (SELECT 1 FROM "document_person" dp WHERE dp.document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM "document_property" dr WHERE dr.document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM "document_account" da WHERE da.document_id = d.id)
GROUP BY trim(d.subject)
ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint
INSERT INTO "document_subject" (document_id, subject_id)
SELECT d.id, s.id FROM "document" d
JOIN "subject" s ON s.name = trim(d.subject)
WHERE d.subject <> ''
  AND NOT EXISTS (SELECT 1 FROM "document_person" dp WHERE dp.document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM "document_property" dr WHERE dr.document_id = d.id)
  AND NOT EXISTS (SELECT 1 FROM "document_account" da WHERE da.document_id = d.id);
--> statement-breakpoint
-- Empty subjects belong to the household.
INSERT INTO "document_subject" (document_id, subject_id)
SELECT d.id, s.id FROM "document" d, "subject" s
WHERE d.subject = '' AND s.name = 'Household';
--> statement-breakpoint
-- Old jsonb tags become real tag rows, same normalisation as normaliseTagName.
INSERT INTO "tag" (id, name, normalised_name)
SELECT gen_random_uuid()::text, t.name, lower(regexp_replace(trim(t.name), '\s+', ' ', 'g'))
FROM (SELECT DISTINCT jsonb_array_elements_text(tags) AS name FROM "document") t
WHERE trim(t.name) <> ''
ON CONFLICT (normalised_name) DO NOTHING;
--> statement-breakpoint
INSERT INTO "document_tag" (document_id, tag_id)
SELECT DISTINCT d.id, tg.id FROM "document" d
CROSS JOIN LATERAL jsonb_array_elements_text(d.tags) AS el(name)
JOIN "tag" tg ON tg.normalised_name = lower(regexp_replace(trim(el.name), '\s+', ' ', 'g'))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The report the spec requires: visible in the boot log.
DO $$
DECLARE np int; nr int; na int; ns int; created text;
BEGIN
  SELECT count(*) INTO np FROM document_person;
  SELECT count(*) INTO nr FROM document_property;
  SELECT count(*) INTO na FROM document_account;
  SELECT count(*) INTO ns FROM document_subject;
  SELECT coalesce(string_agg(name, ', '), '(none)') INTO created FROM subject WHERE name <> 'Household';
  RAISE NOTICE 'entity-links backfill: % person, % property, % account, % subject links; subjects created: %', np, nr, na, ns, created;
END $$;
--> statement-breakpoint
ALTER TABLE "document" DROP COLUMN "subject";--> statement-breakpoint
ALTER TABLE "document" DROP COLUMN "tags";
