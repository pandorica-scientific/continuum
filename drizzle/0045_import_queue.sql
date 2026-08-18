CREATE TABLE "import_job" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"payload" text,
	"byte_size" integer NOT NULL,
	"applies_to_account_id" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_applies_to_account_id_account_id_fk" FOREIGN KEY ("applies_to_account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;