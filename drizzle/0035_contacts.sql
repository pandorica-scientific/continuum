CREATE TABLE "contact" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"photo" text,
	"organisation" text,
	"job_title" text,
	"phone" text,
	"email" text,
	"address" text,
	"notes" text,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_account" (
	"contact_id" text NOT NULL,
	"account_id" text NOT NULL,
	CONSTRAINT "contact_account_contact_id_account_id_pk" PRIMARY KEY("contact_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "contact_loan" (
	"contact_id" text NOT NULL,
	"loan_id" text NOT NULL,
	CONSTRAINT "contact_loan_contact_id_loan_id_pk" PRIMARY KEY("contact_id","loan_id")
);
--> statement-breakpoint
CREATE TABLE "contact_property" (
	"contact_id" text NOT NULL,
	"property_id" text NOT NULL,
	CONSTRAINT "contact_property_contact_id_property_id_pk" PRIMARY KEY("contact_id","property_id")
);
--> statement-breakpoint
CREATE TABLE "contact_tenancy" (
	"contact_id" text NOT NULL,
	"tenancy_id" text NOT NULL,
	CONSTRAINT "contact_tenancy_contact_id_tenancy_id_pk" PRIMARY KEY("contact_id","tenancy_id")
);
--> statement-breakpoint
ALTER TABLE "contact_account" ADD CONSTRAINT "contact_account_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_account" ADD CONSTRAINT "contact_account_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_loan" ADD CONSTRAINT "contact_loan_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_loan" ADD CONSTRAINT "contact_loan_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_property" ADD CONSTRAINT "contact_property_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_property" ADD CONSTRAINT "contact_property_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tenancy" ADD CONSTRAINT "contact_tenancy_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tenancy" ADD CONSTRAINT "contact_tenancy_tenancy_id_tenancy_id_fk" FOREIGN KEY ("tenancy_id") REFERENCES "public"."tenancy"("id") ON DELETE cascade ON UPDATE no action;