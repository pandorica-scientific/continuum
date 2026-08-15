-- Enrollment links were meant to be one per person, but only the code said so.
-- Two racing reissues each left a row behind, so an instance upgrading from
-- 0.3.x may already hold duplicates — and the constraint below cannot be added
-- while it does. Keep one link per person and drop the rest, which is what the
-- reissue was asking for in the first place. The survivor is the one that
-- expires last, which is also the most recently issued unless ENROLLMENT_LINK_DAYS
-- was shortened between the two; ctid breaks ties between rows written in the
-- same millisecond, so exactly one row survives either way.
DELETE FROM "enrollment_token" a
	USING "enrollment_token" b
	WHERE a."person_id" = b."person_id"
		AND (
			a."expires_at" < b."expires_at"
			OR (a."expires_at" = b."expires_at" AND a."ctid" < b."ctid")
		);
--> statement-breakpoint
ALTER TABLE "enrollment_token" ADD CONSTRAINT "enrollment_token_person_id_unique" UNIQUE("person_id");
