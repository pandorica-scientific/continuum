-- Thirteen link tables become three.
--
-- Ten of the thirteen were pure fan-out from three connectors: `tag` reached
-- five tables, `document` four, `contact` four. Every new module multiplied
-- them, so a vehicle would have cost `document_vehicle`, `vehicle_tag` and
-- `contact_vehicle` before it held a single column of its own — and each of
-- those needed its own queries, its own mutations and its own reverse index.
--
-- Pointing the far end at `entity` instead collapses the ten into three, and
-- both ends still keep a real foreign key and a working cascade. After this a
-- new module writes ONE concrete table and inherits tagging, document filing and
-- contact linking for nothing.
--
-- THREE, not one `entity_link` with a `relation` column. Each connector will
-- want columns of its own within a year — a note on why a contact is attached, a
-- sort order for filed documents, who filed it — and a shared table has nowhere
-- to put them without making the column meaningless for the other two. A single
-- table would also make one relation the hot path for every link in the system.
--
-- TWO TABLES DO NOT COLLAPSE, and it is worth saying why they are not
-- oversights:
--
--   loan_property carries `share_pct`. It is a domain relation with a payload,
--     not a link, and the share is explicit precisely so it is never derived.
--   rule_tag is a rule's OUTPUT — the tags it applies when it matches — not a
--     tag someone attached to a rule. Collapsing it would confuse "this rule
--     assigns these tags" with "this rule is tagged", which are different facts
--     that happen to share a shape.

CREATE TABLE tag_link (
	tag_id text NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
	target_id text NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
	CONSTRAINT tag_link_pkey PRIMARY KEY (tag_id, target_id)
);--> statement-breakpoint
-- The primary key leads with tag_id, so it cannot serve a lookup that only
-- knows the target — and "everything tagged like this" is exactly the query the
-- tags screen runs.
CREATE INDEX tag_link_target_idx ON tag_link(target_id);--> statement-breakpoint

CREATE TABLE document_link (
	document_id text NOT NULL REFERENCES document(id) ON DELETE CASCADE,
	target_id text NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
	CONSTRAINT document_link_pkey PRIMARY KEY (document_id, target_id)
);--> statement-breakpoint
CREATE INDEX document_link_target_idx ON document_link(target_id);--> statement-breakpoint

CREATE TABLE contact_link (
	contact_id text NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
	target_id text NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
	CONSTRAINT contact_link_pkey PRIMARY KEY (contact_id, target_id)
);--> statement-breakpoint
CREATE INDEX contact_link_target_idx ON contact_link(target_id);--> statement-breakpoint

-- ON CONFLICT DO NOTHING throughout: one record could legitimately be reached by
-- two of the old tables (a document tagged and also filed against a property),
-- and the collapsed table holds each pair once.
INSERT INTO tag_link (tag_id, target_id) SELECT tag_id, document_id FROM document_tag
	ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO tag_link (tag_id, target_id) SELECT tag_id, property_id FROM property_tag
	ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO tag_link (tag_id, target_id) SELECT tag_id, loan_id FROM loan_tag
	ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO tag_link (tag_id, target_id) SELECT tag_id, transaction_id FROM transaction_tag
	ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO tag_link (tag_id, target_id) SELECT tag_id, split_id FROM transaction_split_tag
	ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO document_link (document_id, target_id) SELECT document_id, person_id FROM document_person
	ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO document_link (document_id, target_id) SELECT document_id, property_id FROM document_property
	ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO document_link (document_id, target_id) SELECT document_id, account_id FROM document_account
	ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO document_link (document_id, target_id) SELECT document_id, subject_id FROM document_subject
	ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO contact_link (contact_id, target_id) SELECT contact_id, tenancy_id FROM contact_tenancy
	ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO contact_link (contact_id, target_id) SELECT contact_id, property_id FROM contact_property
	ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO contact_link (contact_id, target_id) SELECT contact_id, loan_id FROM contact_loan
	ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO contact_link (contact_id, target_id) SELECT contact_id, account_id FROM contact_account
	ON CONFLICT DO NOTHING;--> statement-breakpoint

DROP TABLE document_tag, property_tag, loan_tag, transaction_tag, transaction_split_tag;--> statement-breakpoint
DROP TABLE document_person, document_property, document_account, document_subject;--> statement-breakpoint
DROP TABLE contact_tenancy, contact_property, contact_loan, contact_account;
