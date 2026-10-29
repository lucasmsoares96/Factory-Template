/** The days Stripe keeps retrying a failed renewal (Smart Retries / the Product's Stripe settings) before it ends the Subscription. */
export const PAYMENT_RETRY_DAYS = 7;

/** The last day the card can be updated: the retry window counted from the failed charge, which starts the new period. */
export const retryDeadline = (periodStart: Date): Date => new Date(periodStart.getTime() + PAYMENT_RETRY_DAYS * 24 * 60 * 60 * 1000);
