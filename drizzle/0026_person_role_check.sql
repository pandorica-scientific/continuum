-- Constrain person.role to the two values the code recognises.
--
-- Migration 0020 had to backfill rows that held something else, and nothing
-- stopped that from happening again: canSignIn, canChangeRole and requireAdmin
-- all treat "not admin" as member, so a typo'd role silently demotes the only
-- administrator and locks the household out of managing itself. The type says
-- 'admin' | 'member'; this makes the database say it too.
UPDATE "person" SET "role" = 'member' WHERE "role" NOT IN ('admin', 'member');--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_role_check" CHECK ("role" IN ('admin', 'member'));
