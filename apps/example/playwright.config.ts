import { defineE2EConfig } from "@workspace/skeleton/e2e";
import { messages } from "./src/client/messages.ts";

// The Skeleton's E2E specs, run against this Product's production build.
export default defineE2EConfig({ product: "example", dir: import.meta.dirname, messages });
