CREATE TABLE "broker_position" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"purchase_value_minor" bigint,
	"sale_value_minor" bigint,
	"currency" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "broker_operation" ADD COLUMN "position_id" text;