export { createApp, openApiConfig, type AppOptions } from "./platform/app.ts";
export {
  apiError,
  apiErrorSchema,
  createRouter,
  errorMessages,
  errorResponse,
  type ApiError,
  type ErrorCode,
} from "./platform/errors.ts";
export type { SkeletonBindings, SkeletonEnv } from "./platform/env.ts";
export { authOptions, AUTH_BASE_PATH, type AuthOptionsInput } from "./platform/auth-options.ts";
export type { Email, EmailTransport, SendEmail } from "./platform/email.ts";
export type { Database } from "./platform/db.ts";
export {
  requireIdentity,
  resolveIdentity,
  unauthenticatedResponse,
  type Identity,
  type IdentityUser,
} from "./platform/identity.ts";
export {
  CompanyParams,
  companyNotFoundResponse,
  requireMember,
  skeletonRole,
  type Member,
  type SkeletonRole,
} from "./platform/member.ts";
export {
  PAGE_LIMIT,
  PageQuery,
  afterPosition,
  decodeCursor,
  encodeCursor,
  pageOf,
  toPage,
  type Position,
} from "./platform/pagination.ts";
export {
  assertUniqueFeatures,
  emitMemberJoined,
  defineFeature,
  seedFeatures,
  type Feature,
  type FeatureCompanyPage,
  type FeatureEvents,
  type FeatureNav,
} from "./platform/feature.ts";
export { defineProduct, type ProductConfig } from "./product.ts";
export type { JsonSchema, McpScope, McpTool } from "./platform/mcp/tool.ts";
