CREATE TABLE "skeleton"."companies" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skeleton"."members" (
	"company_id" text,
	"user_id" text,
	"role" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp(3) with time zone,
	CONSTRAINT "members_pkey" PRIMARY KEY("company_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "members_user_id_idx" ON "skeleton"."members" ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "members_one_owner_idx" ON "skeleton"."members" ("company_id") WHERE "role" = 'owner';--> statement-breakpoint
ALTER TABLE "skeleton"."members" ADD CONSTRAINT "members_company_id_companies_id_fkey" FOREIGN KEY ("company_id") REFERENCES "skeleton"."companies"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "skeleton"."members" ADD CONSTRAINT "members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "skeleton"."users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "skeleton"."members" ADD CONSTRAINT "members_role_member_roles_id_fkey" FOREIGN KEY ("role") REFERENCES "skeleton"."member_roles"("id");