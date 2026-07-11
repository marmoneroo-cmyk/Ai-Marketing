CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" text DEFAULT 'stripe' NOT NULL,
	"external_customer_id" text,
	"external_subscription_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_end" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscriptions_org_uq" UNIQUE("org_id")
);
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "plan" SET DEFAULT 'free';--> statement-breakpoint
UPDATE "organizations" SET "plan" = 'free' WHERE "plan" NOT IN ('free', 'starter', 'pro');--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
