CREATE TABLE "loan_event" (
	"id" text PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"happened_on" date NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"interest_minor" bigint,
	"note" text,
	"transaction_id" text
);
--> statement-breakpoint
ALTER TABLE "import_file" ADD COLUMN "stored_name" text;--> statement-breakpoint
ALTER TABLE "loan" ADD COLUMN "owner_person_id" text;--> statement-breakpoint
ALTER TABLE "loan_fixation_period" ADD COLUMN "payment_minor" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "owner_person_id" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "value_date" date;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "fee_minor" bigint;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "balance_after_minor" bigint;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "original_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "original_currency" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "constant_symbol" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "specific_symbol" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "fingerprint_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_event" ADD CONSTRAINT "loan_event_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loan_event_loan_idx" ON "loan_event" USING btree ("loan_id");--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_pair" ADD CONSTRAINT "transfer_pair_out_transaction_id_transaction_id_fk" FOREIGN KEY ("out_transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_pair" ADD CONSTRAINT "transfer_pair_in_transaction_id_transaction_id_fk" FOREIGN KEY ("in_transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loan_fixation_start_idx" ON "loan_fixation_period" USING btree ("loan_id","start_date");