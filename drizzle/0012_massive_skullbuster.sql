CREATE TABLE "rule" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"provenance" text DEFAULT 'learned' NOT NULL,
	"conditions" jsonb NOT NULL,
	"category_id" text,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"corrected_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_tag" (
	"rule_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "rule_tag_rule_id_tag_id_pk" PRIMARY KEY("rule_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "suggested_category_id" text;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_tag" ADD CONSTRAINT "rule_tag_rule_id_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_tag" ADD CONSTRAINT "rule_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_suggested_category_id_category_id_fk" FOREIGN KEY ("suggested_category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Carry every existing category_rule across as a single-condition rule.
-- The prior of 6 must match DEFAULT_RULE_PRIOR in src/lib/rules/match.ts: SQL
-- cannot import the constant, so this is the one place it is duplicated. It is
-- 6 because Wilson then puts a clean rule at 0.6097, above the 0.5 threshold,
-- while one correction drops it to 0.4869 and back into review. Learned rules
-- get the prior too — each exists because a human chose that category, and
-- without it every previously-automatic filing would land back in the queue.
INSERT INTO "rule" (id, name, enabled, provenance, conditions, category_id, accepted_count, corrected_count)
SELECT
  gen_random_uuid()::text,
  cr.pattern,
  true,
  cr.provenance,
  jsonb_build_array(jsonb_build_object(
    'field', CASE cr.matcher_type
               WHEN 'counterparty' THEN 'counterparty'
               WHEN 'counterparty_account' THEN 'counterAccount'
               WHEN 'variable_symbol' THEN 'variableSymbol'
             END,
    'op', CASE cr.matcher_type WHEN 'counterparty' THEN 'contains' ELSE 'equals' END,
    'value', cr.pattern
  )),
  cr.category_id,
  6,
  0
FROM "category_rule" cr;
