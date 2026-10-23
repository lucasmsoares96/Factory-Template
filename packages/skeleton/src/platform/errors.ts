import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SkeletonEnv } from "./env.ts";
import { errorMessages, type ErrorCode } from "./error-codes.ts";

export { errorMessages, type ErrorCode };

export type ApiError<C extends ErrorCode = ErrorCode> = { code: C; message: string };

/** The OpenAPI schema of an error response that can only carry `codes`. */
export function apiErrorSchema<const C extends [ErrorCode, ...ErrorCode[]]>(...codes: C) {
  return z.object({
    code: z.enum(codes).openapi({ description: "Stable error code. Clients translate it." }),
    message: z.string().openapi({ description: "English description, for logs and API clients." }),
  });
}

/** An error entry of a route's `responses`: `description` plus a body that can only carry `codes`. */
export function errorResponse<const C extends [ErrorCode, ...ErrorCode[]]>(description: string, ...codes: C) {
  return { description, content: { "application/json": { schema: apiErrorSchema(...codes) } } };
}

/** The body of an error response. */
export function apiError<C extends ErrorCode>(code: C): ApiError<C> {
  return { code, message: errorMessages[code] };
}

function respond(c: Context, status: ContentfulStatusCode, code: ErrorCode) {
  return c.json(apiError(code), status);
}

/**
 * The OpenAPIHono every Skeleton and Product router starts from: a request that
 * fails its Zod schema answers 400 `VALIDATION_FAILED`.
 */
export function createRouter() {
  return new OpenAPIHono<SkeletonEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return respond(c, 400, "VALIDATION_FAILED");
    },
  });
}

/**
 * Unknown routes answer 404 `NOT_FOUND`; a body the validator cannot parse
 * (malformed JSON) answers 400 `VALIDATION_FAILED`; other uncaught errors answer
 * 500 `INTERNAL_ERROR`.
 */
export function handleErrors(app: OpenAPIHono<SkeletonEnv>) {
  app.notFound((c) => respond(c, 404, "NOT_FOUND"));
  app.onError((error, c) => {
    if (error instanceof HTTPException && error.status === 400) return respond(c, 400, "VALIDATION_FAILED");
    console.error(error);
    return respond(c, 500, "INTERNAL_ERROR");
  });
}
