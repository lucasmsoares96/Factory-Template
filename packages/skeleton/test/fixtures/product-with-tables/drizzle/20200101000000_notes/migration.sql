CREATE TABLE "notes" (
	"id" text PRIMARY KEY,
	"role" text
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_role_member_roles_id_fkey" FOREIGN KEY ("role") REFERENCES "skeleton"."member_roles"("id");--> statement-breakpoint
INSERT INTO "skeleton"."member_roles" ("id") VALUES ('manager');
