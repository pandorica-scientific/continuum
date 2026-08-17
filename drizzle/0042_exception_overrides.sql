ALTER TABLE "calendar_event_exception" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "calendar_event_exception" ADD COLUMN "all_day" boolean;--> statement-breakpoint
ALTER TABLE "calendar_event_exception" ADD COLUMN "tz" text;--> statement-breakpoint
CREATE INDEX "calendar_sync_link_account_idx" ON "calendar_sync_link" USING btree ("account_id");