ALTER TABLE "loan" ADD COLUMN "day_count" text DEFAULT '30/360' NOT NULL;--> statement-breakpoint
ALTER TABLE "loan" ADD COLUMN "payment_day" integer;