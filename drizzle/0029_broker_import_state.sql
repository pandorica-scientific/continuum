CREATE TABLE "broker_import_state" (
	"id" text PRIMARY KEY NOT NULL,
	"latest_generated_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	CONSTRAINT "broker_import_state_singleton" CHECK ("id" = 'global')
);--> statement-breakpoint
WITH "latest_holding" AS (
	SELECT "as_of", "currency"
	FROM "holding"
	ORDER BY "as_of" DESC
	LIMIT 1
), "latest_snapshot" AS (
	SELECT "day", "currency"
	FROM "portfolio_snapshot"
	ORDER BY "day" DESC
	LIMIT 1
), "evidence" AS (
	SELECT
		"latest_holding"."as_of" AS "holding_as_of",
		"latest_holding"."currency" AS "holding_currency",
		("latest_snapshot"."day"::timestamp + interval '1 day - 1 microsecond') AT TIME ZONE 'UTC' AS "snapshot_as_of",
		"latest_snapshot"."currency" AS "snapshot_currency"
	FROM "latest_holding"
	FULL JOIN "latest_snapshot" ON true
)
INSERT INTO "broker_import_state" ("id", "latest_generated_at", "currency")
SELECT
	'global',
	COALESCE(
		GREATEST("holding_as_of", "snapshot_as_of"),
		"holding_as_of",
		"snapshot_as_of"
	),
	CASE
		WHEN "snapshot_as_of" IS NOT NULL
			AND ("holding_as_of" IS NULL OR "snapshot_as_of" >= "holding_as_of")
			THEN "snapshot_currency"
		ELSE "holding_currency"
	END
FROM "evidence"
WHERE "holding_as_of" IS NOT NULL OR "snapshot_as_of" IS NOT NULL;
