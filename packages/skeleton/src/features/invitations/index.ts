import { defineFeature } from "../../platform/feature.ts";
import { invitationsApi } from "./api.ts";

/**
 * Invitations to a Company: the Owner invites an address with a role, sees the
 * pending Invitations, resends and cancels them (the section of the Company
 * page in `invitations-section.tsx`), and the email with the link, whose public
 * page (`public/$token.tsx`) shows the Invitation and lets the invited address
 * accept it and join the Company. Creating an Invitation is a service
 * (`createInvitation`) a Product's routes reuse. `createApp()` mounts it in
 * every Product, before the Product's features.
 */
export const invitations = defineFeature({
  id: "invitations",
  api(app) {
    app.route("/", invitationsApi);
  },
});
