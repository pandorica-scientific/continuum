CREATE TABLE "import_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bank" text,
	"source" text NOT NULL,
	"encoding" text,
	"delimiter" text,
	"signature" text NOT NULL,
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mapping" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"origin" text DEFAULT 'user' NOT NULL,
	"filename_pattern" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
