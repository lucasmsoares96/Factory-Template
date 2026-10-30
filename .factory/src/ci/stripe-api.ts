// The Stripe sandbox of the Previews, as far as the previews need it: the events endpoints (webhook endpoints) of the
// Product's Previews, one per PR. Nothing else is touched: a Preview never writes plans, prices or Entitlements in the
// sandbox. The key is the sandbox's restricted key (`<ID>_PREVIEW_STRIPE_SECRET_KEY`) and lives only in the env of the
// preview `deploy` job and of the cleanup. Docs read 2026-10-29: docs.stripe.com/api/webhook_endpoints (list, create,
// delete) and docs.stripe.com/development/dashboard/webhooks (at most 16 endpoints; the sandbox's own count is unconfirmed).
import Stripe from "stripe";
import { WEBHOOK_PATH } from "../bootstrap/billing.ts";
import { WEBHOOK_EVENTS } from "../bootstrap/stripe.ts";

/** What Stripe lets a sandbox register. */
export const WEBHOOK_LIMIT = 16;

export interface PreviewWebhook {
  id: string;
  url: string;
  /** The Product it was made for (`metadata.productId`), when it was made by a Preview. */
  productId?: string;
  /** The Preview it was made for (`metadata.environment`, `pr-N`). */
  environment?: string;
}

/** What the previews do to the Stripe sandbox; the real adapter is `StripePreviewApi`, the tests use it over a fake `fetch`. */
export interface PreviewWebhooks {
  /** Every events endpoint of the sandbox (the 16 limit counts them all, whoever made them). */
  list(): Promise<PreviewWebhook[]>;
  create(input: { url: string; productId: string; environment: string }): Promise<{ id: string; secret: string }>;
  delete(id: string): Promise<void>;
}

export const previewEnvironment = (pr: number | string) => `pr-${pr}`;

export const previewWebhookUrl = (previewUrl: string) => new URL(WEBHOOK_PATH, previewUrl).toString();

export class StripePreviewApi implements PreviewWebhooks {
  private readonly stripe: Stripe;

  constructor(key: string, options: { httpClient?: Stripe.HttpClient } = {}) {
    if (!/^(rk|sk)_test_/.test(key)) throw new Error("The Previews' Stripe key must be a sandbox (test mode) key.");
    this.stripe = new Stripe(key, { maxNetworkRetries: 0, appInfo: { name: "factory-previews" }, ...(options.httpClient ? { httpClient: options.httpClient } : {}) });
  }

  async list(): Promise<PreviewWebhook[]> {
    const found: PreviewWebhook[] = [];
    for await (const endpoint of this.stripe.webhookEndpoints.list({ limit: 100 })) {
      found.push({ id: endpoint.id, url: endpoint.url, productId: endpoint.metadata?.productId, environment: endpoint.metadata?.environment });
    }
    return found;
  }

  async create(input: { url: string; productId: string; environment: string }): Promise<{ id: string; secret: string }> {
    const endpoint = await this.stripe.webhookEndpoints.create({
      url: input.url,
      enabled_events: WEBHOOK_EVENTS as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
      metadata: { productId: input.productId, environment: input.environment },
      description: `${input.productId} preview ${input.environment}`,
    });
    if (!endpoint.secret) throw new Error("Stripe did not return the signing secret of the endpoint.");
    return { id: endpoint.id, secret: endpoint.secret };
  }

  async delete(id: string): Promise<void> {
    await this.stripe.webhookEndpoints.del(id);
  }
}
