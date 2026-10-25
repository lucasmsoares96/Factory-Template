import { createRoute, z } from "@hono/zod-openapi";
import type { Messages } from "../i18n/index.ts";
import { createRouter } from "./errors.ts";
import type { Feature, FeatureCompanyPage, FeatureNav } from "./feature.ts";
import { requireIdentity, unauthenticatedResponse } from "./identity.ts";

const NavEntry = z
  .object({
    label: z.string().openapi({ description: "The text shown, in the build's locale.", example: "Account" }),
    to: z.string().openapi({ description: "The SPA path the entry opens.", example: "/account" }),
  })
  .openapi("NavEntry");

const Nav = z
  .object({
    entries: z.array(NavEntry).openapi({
      description: "The features' `nav` entries, in mount order: the Skeleton's, then the Product's.",
      example: [{ label: "Account", to: "/account" }],
    }),
    companyPage: z.array(NavEntry).openapi({
      description:
        "The features' `companyPage` sections, in mount order: `to` is under the Company's page (`/c/<companyId>` + `to`).",
      example: [{ label: "Projects", to: "/projects" }],
    }),
  })
  .openapi("Nav");

const getNav = createRoute({
  method: "get",
  path: "/nav",
  operationId: "getNav",
  summary: "Get the signed-in navigation",
  description:
    "Answers the entries of the signed-in navigation, one per feature that declares `nav`, and the sections of the Company page, one per feature that declares `companyPage`.",
  // What the SPA's shell renders, not something an agent acts on.
  "x-mcp": false,
  middleware: [requireIdentity] as const,
  responses: {
    200: { description: "The navigation entries.", content: { "application/json": { schema: Nav } } },
    401: unauthenticatedResponse,
  },
});

/**
 * `GET /api/nav`: the features live in the Worker, so the SPA's signed-in shell
 * reads their `nav` entries from here, and the Company page their `companyPage`
 * sections. A label that is a message path (`account.nav`) is translated with
 * the build's texts; any other label is shown as is.
 */
export function navRoutes({ features, t }: { features: readonly Feature[]; t: Messages }) {
  const translated = (entry: FeatureNav | FeatureCompanyPage | undefined) => (entry ? [{ label: translate(entry.label, t), to: entry.to }] : []);
  const entries = features.flatMap(({ nav }) => translated(nav));
  const companyPage = features.flatMap(({ companyPage }) => translated(companyPage));
  return createRouter().openapi(getNav, (c) => c.json({ entries, companyPage }, 200));
}

function translate(label: string, t: Messages): string {
  let text: unknown = t;
  for (const key of label.split(".")) {
    if (typeof text !== "object" || text === null || !Object.hasOwn(text, key)) return label;
    text = (text as Record<string, unknown>)[key];
  }
  return typeof text === "string" ? text : label;
}
