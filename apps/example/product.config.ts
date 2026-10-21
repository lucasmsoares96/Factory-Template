import { defineProduct } from "@workspace/skeleton/product";

/**
 * The Product's identity and its texts over the Skeleton's. The theme (shadcn
 * tokens) is in src/client/styles.css. This file reaches the browser: keep it
 * to data, with no server code.
 */
export default defineProduct({
  id: "example",
  title: "Example",
  emailFrom: "Example <no-reply@example.com>",
  domain: "example.com",
  messages: {
    en: {
      app: { title: "Example" },
      auth: {
        signIn: { description: "Your workspace, one sign-in away." },
        signUp: { description: "Create your Example workspace in a minute." },
      },
    },
    "pt-BR": {
      app: { title: "Example" },
      auth: {
        signIn: { description: "Seu espaço, a um login de distância." },
        signUp: { description: "Crie seu espaço no Example em um minuto." },
      },
    },
  },
});
