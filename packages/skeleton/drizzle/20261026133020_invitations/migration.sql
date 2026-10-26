CREATE TABLE "skeleton"."invitations" (
	"id" text PRIMARY KEY,
	"company_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text,
	"token_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp(3) with time zone,
	"canceled_at" timestamp(3) with time zone,
	CONSTRAINT "invitations_not_owner" CHECK ("role" <> 'owner')
);
--> statement-breakpoint
CREATE INDEX "invitations_company_id_idx" ON "skeleton"."invitations" ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_one_pending_idx" ON "skeleton"."invitations" ("company_id","email") WHERE "accepted_at" is null and "canceled_at" is null;--> statement-breakpoint
ALTER TABLE "skeleton"."invitations" ADD CONSTRAINT "invitations_company_id_companies_id_fkey" FOREIGN KEY ("company_id") REFERENCES "skeleton"."companies"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "skeleton"."invitations" ADD CONSTRAINT "invitations_role_member_roles_id_fkey" FOREIGN KEY ("role") REFERENCES "skeleton"."member_roles"("id");--> statement-breakpoint
ALTER TABLE "skeleton"."invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fkey" FOREIGN KEY ("invited_by") REFERENCES "skeleton"."users"("id") ON DELETE SET NULL;