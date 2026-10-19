import { createApp } from "../../src/index.ts";

export { PasswordHasher, RateLimiter } from "../../src/durable-objects.ts";

export default createApp({
  title: "skeleton-test",
  emailFrom: "Skeleton Test <no-reply@skeleton.test>",
}) satisfies ExportedHandler<Env>;
