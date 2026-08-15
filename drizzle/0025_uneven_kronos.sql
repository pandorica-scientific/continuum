CREATE INDEX "credential_person_idx" ON "credential" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "session_person_idx" ON "session" USING btree ("person_id");