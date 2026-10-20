import type { MessageOverrides } from "./i18n/index.ts";

/**
 * A Product's identity: what `product.config.ts` exports. The Worker, the SPA,
 * the emails and the E2E config all read it, so it holds only data (no server
 * code) and the SPA can bundle it.
 */
export type ProductConfig = {
  /** The Worker's name, the folder under `apps/` and the OpenAPI/MCP title (lower-case, dashes). */
  id: string;
  /** The Product's display name. */
  title: string;
  /** The sender of every email, e.g. `Example <no-reply@example.com>`. */
  emailFrom: string;
  /** The Product's domain: what the Resend sender domain and the production hostname are built from. */
  domain: string;
  /**
   * The Product's texts over the Skeleton's, per locale (theme tokens go in the
   * Product's `styles.css`). A feature keeps its texts in its own `messages.ts`
   * and the config spreads them in here.
   */
  messages?: MessageOverrides;
};

/** Types a Product's `product.config.ts` (identity at runtime). */
export function defineProduct(config: ProductConfig): ProductConfig {
  return config;
}
