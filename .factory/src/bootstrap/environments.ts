/**
 * The GitHub environments of the deploy: one per Stage for the whole repository, both restricted to the default branch
 * (ADR 0010). A secret of an environment is not handed to a job that runs from another branch, so a workflow pushed on a
 * `factory/issue-N` branch cannot read the Cloudflare token. Names only: no import, so every module can use them.
 */
export const PRODUCTION_ENVIRONMENT = "production";
export const PREVIEW_ENVIRONMENT = "preview";
export const STAGE_ENVIRONMENTS = [PRODUCTION_ENVIRONMENT, PREVIEW_ENVIRONMENT] as const;

/** The secrets of the repository that are not deploy secrets: the Factory's own tokens and the CI-only Stripe sandbox key. */
export const REPO_SECRETS = ["FACTORY_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "STRIPE_CI_KEY"];
