ALTER TABLE "property_bill" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
-- Adopt the rows the old label-matching code created, so the meter keeps
-- writing to the line it already made instead of adding a third one. The label
-- was the only marker it had; from here the source column is.
UPDATE "property_bill" SET "source" = 'meter' WHERE "label" = 'Energy · from meter';
