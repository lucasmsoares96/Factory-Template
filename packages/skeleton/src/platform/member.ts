import { z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { members } from "../db/schema.ts";
import type { SkeletonEnv } from "./env.ts";
import { apiError, errorResponse } from "./errors.ts";

/** The roles the Skeleton's own routes know. A Product's extra roles count as `employee` there. */
export type SkeletonRole = "owner" | "employee";

/**
 * The caller's membership in the Company of the path. `role` is the role as
 * stored: `owner`, `employee`, or one a Product added to `member_roles`.
 */
export type Member = { companyId: string; userId: string; role: string };

/** What a role may do on the Skeleton's routes: only `owner` is more than an Employee. */
export function skeletonRole(role: string): SkeletonRole {
  return role === "owner" ? "owner" : "employee";
}

/** The `{companyId}` path parameter of every route under `/api/companies/{companyId}/...`. */
export const CompanyParams = z.object({
  companyId: z.string().openapi({ description: "The Company's id.", example: "2f1c6a0e-8d1b-4a51-9f3e-6b0c1d2e3f40" }),
});

/**
 * The single place that resolves who the caller is in the Company of the path,
 * and the only permission check of the Company routes, the Skeleton's and the
 * Products'. Put it after `requireIdentity` on a route whose path has
 * `{companyId}`: it sets `c.var.member`, or answers 404 `NOT_FOUND` when the
 * caller is not a Member, exactly as if the Company did not exist, so nobody
 * learns of another user's Companies by their id. Declare that 404 with
 * `companyNotFoundResponse`.
 */
export const requireMember = createMiddleware<SkeletonEnv>(async (c, next) => {
  const companyId = c.req.param("companyId");
  const userId = c.var.identity.user.id;
  const [member] = companyId
    ? await c.var.db
        .select({ role: members.role })
        .from(members)
        .where(and(eq(members.companyId, companyId), eq(members.userId, userId)))
    : [];
  if (!member || !companyId) return c.json(apiError("NOT_FOUND"), 404);
  c.set("member", { companyId, userId, role: member.role });
  await next();
});

/** The 404 every route behind `requireMember` declares in its `responses`. */
export const companyNotFoundResponse = errorResponse(
  "No such Company, or the signed-in user is not one of its Members.",
  "NOT_FOUND",
);
