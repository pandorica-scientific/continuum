CREATE TABLE "document" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"shelf" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"stored_name" text,
	"ext" text DEFAULT 'PDF' NOT NULL,
	"added_on" date NOT NULL,
	"expires_on" date,
	"expiry_verb" text DEFAULT 'expires' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "document_shelf_idx" ON "document" USING btree ("shelf");