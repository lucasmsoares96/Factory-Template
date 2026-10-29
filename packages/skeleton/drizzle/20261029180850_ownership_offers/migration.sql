CREATE TABLE "skeleton"."ownership_offers" (
	"id" text PRIMARY KEY,
	"company_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"offered_by" text,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp(3) with time zone,
	"canceled_at" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ownership_offers_one_pending_idx" ON "skeleton"."ownership_offers" ("company_id") WHERE "accepted_at" is null and "canceled_at" is null;--> statement-breakpoint
ALTER TABLE "skeleton"."ownership_offers" ADD CONSTRAINT "ownership_offers_company_id_companies_id_fkey" FOREIGN KEY ("company_id") REFERENCES "skeleton"."companies"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "skeleton"."ownership_offers" ADD CONSTRAINT "ownership_offers_recipient_id_users_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "skeleton"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "skeleton"."ownership_offers" ADD CONSTRAINT "ownership_offers_offered_by_users_id_fkey" FOREIGN KEY ("offered_by") REFERENCES "skeleton"."users"("id") ON DELETE SET NULL;