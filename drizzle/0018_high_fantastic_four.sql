CREATE TABLE "enrollment_token" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "person" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
ALTER TABLE "person" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrollment_token" ADD CONSTRAINT "enrollment_token_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Existing installs predate the two-value role. Everyone becomes a member,
-- then the earliest person by created_at is promoted, matching the rule the
-- setup wizard now applies to fresh installs.
UPDATE "person" SET "role" = 'member';--> statement-breakpoint
UPDATE "person" SET "role" = 'admin'
WHERE "id" = (SELECT "id" FROM "person" ORDER BY "created_at" ASC LIMIT 1);