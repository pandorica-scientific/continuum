CREATE TABLE "calendar_account" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"remote_cal_id" text,
	"credential" text NOT NULL,
	"cursor" text,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_conflict" (
	"id" text PRIMARY KEY NOT NULL,
	"local_key" text NOT NULL,
	"account_id" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ours" jsonb NOT NULL,
	"theirs" jsonb NOT NULL,
	"resolution" text NOT NULL,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendar_sync_link" (
	"local_key" text NOT NULL,
	"account_id" text NOT NULL,
	"remote_id" text NOT NULL,
	"remote_etag" text,
	"pushed_hash" text,
	"seen_hash" text,
	"suppressed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "calendar_sync_link_local_key_account_id_pk" PRIMARY KEY("local_key","account_id")
);
--> statement-breakpoint
ALTER TABLE "calendar_conflict" ADD CONSTRAINT "calendar_conflict_account_id_calendar_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_link" ADD CONSTRAINT "calendar_sync_link_account_id_calendar_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_account"("id") ON DELETE cascade ON UPDATE no action;