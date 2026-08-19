-- A covering index for every foreign key.
--
-- Each of these was a sequential scan that grows with the whole household's
-- history rather than with the row's own share of it: "the documents of this
-- person", "the bills of this flat", "the transactions in this category". The
-- link tables were the worst of them, because a composite primary key indexes
-- its FIRST column only, so every reverse lookup scanned the table.
--
-- Enforced from here on by tests/integration/schema-invariants.test.ts, which
-- discounts PARTIAL indexes: property_bill_meter_property_idx covers
-- property_id only WHERE source = 'meter', and does nothing for a general
-- lookup of one property's bills.

CREATE INDEX "account_owner_person_idx" ON "account" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "calendar_conflict_account_idx" ON "calendar_conflict" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "calendar_event_created_by_idx" ON "calendar_event" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "contact_account_account_idx" ON "contact_account" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "contact_loan_loan_idx" ON "contact_loan" USING btree ("loan_id");--> statement-breakpoint
CREATE INDEX "contact_property_property_idx" ON "contact_property" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "contact_tenancy_tenancy_idx" ON "contact_tenancy" USING btree ("tenancy_id");--> statement-breakpoint
CREATE INDEX "document_account_account_idx" ON "document_account" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "document_person_person_idx" ON "document_person" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "document_property_property_idx" ON "document_property" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "document_subject_subject_idx" ON "document_subject" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "document_tag_tag_idx" ON "document_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "import_file_account_idx" ON "import_file" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "import_job_applies_to_account_idx" ON "import_job" USING btree ("applies_to_account_id");--> statement-breakpoint
CREATE INDEX "loan_owner_person_idx" ON "loan" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "loan_event_transaction_idx" ON "loan_event" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "loan_property_property_idx" ON "loan_property" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "loan_tag_tag_idx" ON "loan_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "property_owner_person_idx" ON "property" USING btree ("owner_person_id");--> statement-breakpoint
CREATE INDEX "property_bill_property_idx" ON "property_bill" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "property_bill_document_idx" ON "property_bill" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "property_tag_tag_idx" ON "property_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "rule_category_idx" ON "rule" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "rule_tag_tag_idx" ON "rule_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tax_statement_document_idx" ON "tax_statement" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "tax_statement_line_statement_idx" ON "tax_statement_line" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "tenancy_property_idx" ON "tenancy" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "transaction_category_idx" ON "transaction" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transaction_suggested_category_idx" ON "transaction" USING btree ("suggested_category_id");--> statement-breakpoint
CREATE INDEX "transaction_import_file_idx" ON "transaction" USING btree ("import_file_id");--> statement-breakpoint
CREATE INDEX "transaction_split_category_idx" ON "transaction_split" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "transaction_split_tag_tag_idx" ON "transaction_split_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "transaction_tag_tag_idx" ON "transaction_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "transfer_pair_out_transaction_idx" ON "transfer_pair" USING btree ("out_transaction_id");--> statement-breakpoint
CREATE INDEX "transfer_pair_in_transaction_idx" ON "transfer_pair" USING btree ("in_transaction_id");--> statement-breakpoint
CREATE INDEX "webauthn_challenge_person_idx" ON "webauthn_challenge" USING btree ("person_id");