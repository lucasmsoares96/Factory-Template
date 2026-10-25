import { defineFeature } from "../../platform/feature.ts";
import { companiesApi } from "./api.ts";

/**
 * Companies and their Members: create and list the user's Companies, the
 * Company page (`routes/`, at `/c/<companyId>`) with its Members, and the
 * Company switcher of the signed-in shell. Every route of a Company sits under
 * `/api/companies/{companyId}/...` behind `requireMember`. `createApp()` mounts
 * it in every Product, before the Product's features.
 */
export const companies = defineFeature({
  id: "companies",
  api(app) {
    app.route("/", companiesApi);
  },
});
