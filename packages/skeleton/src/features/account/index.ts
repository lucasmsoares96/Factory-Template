import { defineFeature } from "../../platform/feature.ts";
import { accountApi } from "./api.ts";
import { connectionsApi } from "./connections.ts";

/**
 * The signed-in user's own account: `PATCH /api/me`, the account page
 * (`routes/`, at `/account`), and the MCP Connections the user authorized
 * (`/api/connections`, the page at `/account/connections`). The page also
 * changes the password and deletes the account through Better Auth's routes
 * (`/api/auth/change-password`, `/api/auth/delete-user`; their rules are in
 * `platform/auth-options.ts`), which stay out of the MCP. `createApp()` mounts
 * it in every Product, before the Product's features; its nav label is a
 * message path the Worker translates.
 */
export const account = defineFeature({
  id: "account",
  api(app) {
    app.route("/", accountApi);
    app.route("/", connectionsApi);
  },
  nav: { label: "account.nav", to: "/account" },
});
