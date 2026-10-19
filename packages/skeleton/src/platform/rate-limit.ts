/** A Better Auth rate-limit rule: at most `max` requests per `window` seconds. */
export type RateLimitRule = { window: number; max: number };

/** What `consume` answers: whether the request may go on, and if not, in how many seconds. */
export type RateLimitDecision = { allowed: boolean; retryAfter: number | null };

/** What the Worker calls on a `RateLimiter` stub (its RPC method). */
export type RateLimiterStub = { consume(rule: RateLimitRule): Promise<RateLimitDecision> };

/** The `RATE_LIMITER` Durable Object namespace, as the Worker uses it. */
export type RateLimiterPool = { getByName(name: string): RateLimiterStub };

/**
 * Better Auth's `rateLimit.customStorage` over the `RateLimiter` Durable Object:
 * one object per key (`<ip>|<path>`), so every Worker isolate counts against the
 * same, strongly consistent counter.
 */
export function rateLimitStorage(pool: RateLimiterPool) {
  return {
    consume: (key: string, rule: RateLimitRule) => pool.getByName(key).consume(rule),
  };
}

/**
 * One step of a fixed window: the window opens at the first request and lets
 * `max` requests in until it closes. Pure, so the Durable Object stays a thin
 * shell around its storage.
 */
export function decide(
  state: { start: number; count: number } | undefined,
  rule: RateLimitRule,
  now: number,
): { state: { start: number; count: number }; decision: RateLimitDecision } {
  const windowMs = rule.window * 1_000;
  if (!state || now - state.start >= windowMs) {
    return { state: { start: now, count: 1 }, decision: { allowed: true, retryAfter: null } };
  }
  if (state.count >= rule.max) {
    return { state, decision: { allowed: false, retryAfter: Math.ceil((state.start + windowMs - now) / 1_000) } };
  }
  return { state: { ...state, count: state.count + 1 }, decision: { allowed: true, retryAfter: null } };
}
