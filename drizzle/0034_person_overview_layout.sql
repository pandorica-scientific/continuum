-- Each person arranges their own Overview board, so the layout belongs to the
-- person row rather than the global settings table: it cascades when a person
-- is deleted, and it stays out of the config export allowlist.
--
-- Null is not the same as an empty array. Null means this person has never
-- customised, and the default layout renders; an empty array means they removed
-- every panel, which is a state they are allowed to be in.
alter table "person" add column "overview_layout" jsonb;
