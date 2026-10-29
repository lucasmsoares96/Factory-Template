import { createRoute, z } from "@hono/zod-openapi";
import { billing, CompanyParams, companyNotFoundResponse, defineFeature, requireMember } from "../../src/index.ts";
import { createRouter } from "../../src/platform/errors.ts";
import { requireIdentity, unauthenticatedResponse } from "../../src/platform/identity.ts";

// A test feature that checks Entitlements the way a Product does: it declares
// their names in `billing()` and asks for one by name behind `requireMember`.
// `exports` is in no Plan of the fake Stripe.

export const billingFeature = billing({ entitlements: ["reports", "projects", "exports"] });

const NAMES = ["reports", "projects", "exports"] as const;

const getEntitlement = createRoute({
  method: "get",
  path: "/companies/{companyId}/entitled/{name}",
  operationId: "getEntitled",
  summary: "Get an Entitlement of a Company",
  description: "Answers the value of an Entitlement for the Company of the path, as billing resolves it.",
  // Test-only: not an agent tool.
  "x-mcp": false,
  middleware: [requireIdentity, requireMember] as const,
  request: { params: CompanyParams.extend({ name: z.enum(NAMES).openapi({ description: "The Entitlement's name." }) }) },
  responses: {
    200: { description: "The value.", content: { "application/json": { schema: z.object({ value: z.union([z.boolean(), z.number()]) }) } } },
    401: unauthenticatedResponse,
    404: companyNotFoundResponse,
  },
});

const router = createRouter().openapi(getEntitlement, async (c) =>
  c.json({ value: await billingFeature.entitlement(c, c.req.valid("param").name) }, 200),
);

// @ts-expect-error `invoices` is not an Entitlement the Product declared.
void ((c: Parameters<typeof billingFeature.entitlement>[0]) => billingFeature.entitlement(c, "invoices"));

export const entitled = defineFeature({
  id: "entitled",
  api(app) {
    app.route("/", router);
  },
});
