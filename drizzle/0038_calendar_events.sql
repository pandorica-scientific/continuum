CREATE TABLE "calendar_event" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"category" text,
	"all_day" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"tz" text NOT NULL,
	"rrule" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "calendar_event_exception" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"recurrence_id" text NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"title" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_exception" ADD CONSTRAINT "calendar_event_exception_event_id_calendar_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_exception_occurrence_idx" ON "calendar_event_exception" USING btree ("event_id","recurrence_id");