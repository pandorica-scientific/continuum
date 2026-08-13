ALTER TABLE "document" ADD COLUMN "amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "amount_currency" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "period_month" text;