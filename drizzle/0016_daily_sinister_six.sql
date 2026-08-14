CREATE TABLE "tax_statement" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"year" integer NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"gross_income_minor" bigint NOT NULL,
	"tax_paid_minor" bigint NOT NULL,
	"document_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_statement_line" (
	"id" text PRIMARY KEY NOT NULL,
	"statement_id" text NOT NULL,
	"label" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_statement" ADD CONSTRAINT "tax_statement_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statement" ADD CONSTRAINT "tax_statement_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statement_line" ADD CONSTRAINT "tax_statement_line_statement_id_tax_statement_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."tax_statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tax_statement_unique_idx" ON "tax_statement" USING btree ("person_id","year","country");