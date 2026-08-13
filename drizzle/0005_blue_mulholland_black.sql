CREATE TABLE "loan_property" (
	"id" text PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"property_id" text NOT NULL,
	"share_pct" numeric(6, 3)
);
--> statement-breakpoint
ALTER TABLE "loan" ADD COLUMN "accrual_style" text DEFAULT 'payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "loan_property" ADD CONSTRAINT "loan_property_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_property" ADD CONSTRAINT "loan_property_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loan_property_idx" ON "loan_property" USING btree ("loan_id","property_id");
--> statement-breakpoint
INSERT INTO "loan_property" ("id", "loan_id", "property_id")
SELECT gen_random_uuid()::text, "id", "secured_by_property_id"
FROM "loan" WHERE "secured_by_property_id" IS NOT NULL;
