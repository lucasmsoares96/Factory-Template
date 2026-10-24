import { defineFeature } from "../../platform/feature.ts";
import { accountApi } from "./api.ts";

/**
 * The signed-in user's own account: `PATCH /api/me` and the account page
 * (`routes/`, at `/account`), which also asks Better Auth to change the email
 * (configured in `platform/auth-options.ts`). `createApp()` mounts it in every Product, before
 * the Product's features; its nav label is a message path the Worker translates.
 */
export const account = defineFeature({
  id: "account",
  api(app) {
    app.route("/", accountApi);
  },
  nav: { label: "account.nav", to: "/account" },
});
