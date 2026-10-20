import { defineProduct } from "@workspace/skeleton/product";

/**
 * The Product's identity and its texts over the Skeleton's. The theme (shadcn
 * tokens) is in src/client/styles.css. This file reaches the browser: keep it
 * to data, with no server code.
 */
export default defineProduct({
  id: "{{id}}",
  title: "{{title}}",
  emailFrom: "{{title}} <no-reply@{{domain}}>",
  domain: "{{domain}}",
  messages: {
    en: { app: { title: "{{title}}" } },
    "pt-BR": { app: { title: "{{title}}" } },
  },
});
