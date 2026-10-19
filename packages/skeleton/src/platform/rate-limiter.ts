import { DurableObject } from "cloudflare:workers";
import { decide, type RateLimitDecision, type RateLimitRule } from "./rate-limit.ts";

type Window = { start: number; count: number };

/**
 * Better Auth's rate-limit counter for one key (`<ip>|<path>`), kept in the
 * object's SQLite storage so it survives eviction. A Durable Object runs one
 * request at a time and the storage calls here are synchronous, so the
 * read-decide-write is atomic. An alarm clears the key once its window closes.
 * Every Product Worker exports it and binds it as `RATE_LIMITER`.
 */
export class RateLimiter extends DurableObject {
  consume(rule: RateLimitRule): RateLimitDecision {
    const storage = this.ctx.storage;
    const now = Date.now();
    const current = storage.kv.get<Window>("window");
    const { state, decision } = decide(current, rule, now);
    if (state !== current) {
      storage.kv.put("window", state);
      if (state.start === now) void storage.setAlarm(now + rule.window * 1_000);
    }
    return decision;
  }

  override async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
