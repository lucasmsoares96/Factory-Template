CREATE TABLE "skeleton"."subscriptions" (
	"id" text PRIMARY KEY,
	"plan" text NOT NULL,
	"reference_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text DEFAULT 'incomplete' NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false,
	"cancel_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"seats" integer,
	"billing_interval" text,
	"stripe_schedule_id" text
);
--> statement-breakpoint
ALTER TABLE "skeleton"."users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
CREATE INDEX "subscriptions_reference_id_idx" ON "skeleton"."subscriptions" ("reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_idx" ON "skeleton"."subscriptions" ("stripe_subscription_id");--> statement-breakpoint
ALTER TABLE "skeleton"."subscriptions" ADD CONSTRAINT "subscriptions_reference_id_users_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "skeleton"."users"("id") ON DELETE CASCADE;