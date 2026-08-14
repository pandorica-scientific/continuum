-- Merge subjects that differ only in case before forbidding them: relink every
-- document to the oldest spelling, drop the duplicates, then add the index.
INSERT INTO "document_subject" (document_id, subject_id)
SELECT ds.document_id, k.keep_id
FROM "document_subject" ds
JOIN "subject" s ON s.id = ds.subject_id
JOIN (SELECT min(id) AS keep_id, lower(name) AS ln FROM "subject" GROUP BY lower(name)) k
  ON lower(s.name) = k.ln AND s.id <> k.keep_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM "subject" s
USING (SELECT min(id) AS keep_id, lower(name) AS ln FROM "subject" GROUP BY lower(name)) k
WHERE lower(s.name) = k.ln AND s.id <> k.keep_id;
--> statement-breakpoint
CREATE UNIQUE INDEX "subject_name_ci_idx" ON "subject" USING btree (lower("name"));