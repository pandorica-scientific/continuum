CREATE TABLE "setup_claim" (
	"claimed" boolean PRIMARY KEY NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_claim_singleton" CHECK ("claimed" = true)
);--> statement-breakpoint
INSERT INTO "setup_claim" ("claimed")
SELECT true WHERE EXISTS (SELECT 1 FROM "person")
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "auth_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "auth_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "auth_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "session" s SET "auth_generation" = p."auth_generation"
FROM "person" p WHERE p."id" = s."person_id";--> statement-breakpoint
UPDATE "credential" c SET "auth_generation" = p."auth_generation"
FROM "person" p WHERE p."id" = c."person_id";--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "auth_generation" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "credential" ALTER COLUMN "auth_generation" DROP DEFAULT;--> statement-breakpoint
DELETE FROM "webauthn_challenge";--> statement-breakpoint
ALTER TABLE "webauthn_challenge" ADD COLUMN "address" text NOT NULL;--> statement-breakpoint
ALTER TABLE "webauthn_challenge" ADD COLUMN "person_id" text;--> statement-breakpoint
ALTER TABLE "webauthn_challenge" ADD COLUMN "auth_generation" integer;--> statement-breakpoint
ALTER TABLE "webauthn_challenge" ADD COLUMN "auth_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "webauthn_challenge" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "webauthn_challenge" ADD CONSTRAINT "webauthn_challenge_person_id_person_id_fk"
FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webauthn_challenge_expires_idx" ON "webauthn_challenge" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webauthn_challenge_address_created_idx" ON "webauthn_challenge" USING btree ("address", "created_at");
