ALTER TABLE "loan" DROP CONSTRAINT "loan_secured_by_property_id_property_id_fk";
--> statement-breakpoint
ALTER TABLE "loan" DROP COLUMN "secured_by_property_id";