import { defineFeature } from "../../platform/feature.ts";
import { companiesApi } from "./api.ts";
import { ownershipOfferApi } from "./ownership-offer.ts";

/**
 * Companies and their Members: create and list the user's Companies, the
 * Company page (`routes/`, at `/c/<companyId>`) with its Members (the Owner
 * changes their roles and removes them, and nobody leaves on their own; the Owner offers the
 * ownership to a Member, who accepts it with enough free Seats), and the Company
 * switcher of the signed-in shell. Every route of a Company sits under
 * `/api/companies/{companyId}/...` behind `requireMember`. `createApp()` mounts
 * it in every Product, before the Product's features.
 */
export const companies = defineFeature({
  id: "companies",
  api(app) {
    app.route("/", companiesApi);
    app.route("/", ownershipOfferApi);
  },
});
