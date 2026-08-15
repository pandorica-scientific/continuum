WITH "ranked_meter_bills" AS (
	SELECT
		"id",
		row_number() OVER (PARTITION BY "property_id" ORDER BY "sort", "id") AS "position"
	FROM "property_bill"
	WHERE "source" = 'meter'
)
UPDATE "property_bill" AS "bill"
SET "source" = 'manual'
FROM "ranked_meter_bills" AS "ranked"
WHERE "bill"."id" = "ranked"."id"
	AND "ranked"."position" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "property_bill_meter_property_idx"
ON "property_bill" USING btree ("property_id")
WHERE "source" = 'meter';
