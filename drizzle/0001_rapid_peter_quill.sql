CREATE TABLE "broker_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"ticker" text,
	"happened_at" timestamp with time zone NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "holding" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'STOCK' NOT NULL,
	"units" numeric(18, 6) NOT NULL,
	"value_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"net_profit_pct" numeric(9, 2),
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"lender" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'mortgage' NOT NULL,
	"currency" text DEFAULT 'CZK' NOT NULL,
	"secured_by_property_id" text,
	"principal_minor" bigint NOT NULL,
	"owed_minor" bigint NOT NULL,
	"owed_as_of" date,
	"payment_minor" bigint NOT NULL,
	"start_date" date,
	"end_date" date,
	"regime" text DEFAULT 'fixed_period' NOT NULL,
	"interest_deductible" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_fixation_period" (
	"id" text PRIMARY KEY NOT NULL,
	"loan_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"annual_rate_pct" numeric(6, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "networth_snapshot" (
	"day" date PRIMARY KEY NOT NULL,
	"value_minor" bigint NOT NULL,
	"currency" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshot" (
	"day" date PRIMARY KEY NOT NULL,
	"value_minor" bigint NOT NULL,
	"currency" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"size_label" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"currency" text DEFAULT 'CZK' NOT NULL,
	"value_minor" bigint DEFAULT 0 NOT NULL,
	"valued_at" date,
	"money_in_minor" bigint DEFAULT 0 NOT NULL,
	"bought_year" integer,
	"images" jsonb DEFAULT '{"photos":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_bill" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"label" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenancy" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"tenant_name" text NOT NULL,
	"tenant_contact" text DEFAULT '' NOT NULL,
	"rent_minor" bigint DEFAULT 0 NOT NULL,
	"deposit_minor" bigint DEFAULT 0 NOT NULL,
	"start_date" date,
	"end_date" date,
	"renewal_notice_date" date
);
--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_secured_by_property_id_property_id_fk" FOREIGN KEY ("secured_by_property_id") REFERENCES "public"."property"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_fixation_period" ADD CONSTRAINT "loan_fixation_period_loan_id_loan_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_bill" ADD CONSTRAINT "property_bill_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy" ADD CONSTRAINT "tenancy_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loan_fixation_loan_idx" ON "loan_fixation_period" USING btree ("loan_id");