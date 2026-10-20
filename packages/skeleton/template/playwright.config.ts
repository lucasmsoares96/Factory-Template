import { defineE2EConfig } from "@workspace/skeleton/e2e";
import product from "./product.config.ts";

// The Skeleton's E2E specs plus this Product's own (`e2e/`), run against its production build.
export default defineE2EConfig({ product: product.id, dir: import.meta.dirname, messages: product.messages });
