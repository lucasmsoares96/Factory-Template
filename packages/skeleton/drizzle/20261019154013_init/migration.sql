CREATE SCHEMA "skeleton";
--> statement-breakpoint
CREATE TABLE "skeleton"."member_roles" (
	"id" text PRIMARY KEY
);
--> statement-breakpoint
INSERT INTO "skeleton"."member_roles" ("id") VALUES ('owner'), ('employee');
