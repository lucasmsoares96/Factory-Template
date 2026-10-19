import { createApp } from "@workspace/skeleton";
import { messages } from "./client/messages.ts";

export { PasswordHasher, RateLimiter } from "@workspace/skeleton/durable-objects";

export default createApp({
  title: "example",
  emailFrom: "Example <no-reply@example.com>",
  messages,
}) satisfies ExportedHandler<Env>;
