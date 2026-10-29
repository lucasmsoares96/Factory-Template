import { billing, type Feature } from "@workspace/skeleton";

/**
 * The Product's features, in mount order. A feature lives in `src/features/<id>/`
 * (`schema.ts`, `routes/`, `public/`, `messages.ts`, ...) and exports a `Feature`.
 */
export const features: Feature[] = [
  // Billing runs only where the Worker has STRIPE_SECRET_KEY (`pnpm dev` and the tests use a fake Stripe).
  billing({ entitlements: ["reports", "projects"] }),
];
