/**
 * Clients of the four services the wizard configures. Every one has a real
 * and a fake adapter (`fake/`). Credentials live inside the adapters and are
 * never written to disk; the interfaces only move values in memory.
 */

export interface RepoInfo {
  fullName: string;
  visibility: "public" | "private" | "internal";
  /** Permission of the logged-in user: ADMIN, MAINTAIN, WRITE, TRIAGE or READ. */
  viewerPermission: string;
  defaultBranch: string;
}

export interface LabelSpec {
  name: string;
  /** Hex without `#`. */
  color: string;
  description: string;
}

/** The only door to the forge. `gh` is called from `github.ts` and nowhere else. */
export interface GitHubClient {
  repo(): Promise<RepoInfo>;
  /** Login of the account `gh` is authenticated as. */
  user(): Promise<string>;
  /** Names of the secrets of the repo, or of one environment. */
  listSecrets(options?: { environment?: string }): Promise<string[]>;
  /** Stores the value in the repo (or in one environment); it is never read back. */
  setSecret(name: string, value: string, options?: { environment?: string }): Promise<void>;
  listVariables(): Promise<Record<string, string>>;
  setVariable(name: string, value: string): Promise<void>;
  listLabels(): Promise<LabelSpec[]>;
  /** Create or update (`gh label create --force`). */
  upsertLabel(label: LabelSpec): Promise<void>;
  listEnvironments(): Promise<string[]>;
  /**
   * Creates (or updates) an environment that only the branch `branch` may deploy to. `refused` means the plan or the
   * visibility of the repo does not allow environments (the API said 403, 404 or 422); any other failure throws.
   */
  upsertEnvironment(name: string, input: { branch: string }): Promise<"created" | "refused">;
  /** Branch rulesets of the repo, with their rules. */
  listRulesets(): Promise<RulesetInfo[]>;
  /** `refused` as for environments. */
  createRuleset(spec: RulesetSpec): Promise<"created" | "refused">;
  /** Deletes a secret of the repo or of one environment (only `destroy` calls the delete methods). */
  deleteSecret(name: string, options?: { environment?: string }): Promise<void>;
  deleteVariable(name: string): Promise<void>;
  /** Deleting an environment deletes its secrets and variables. */
  deleteEnvironment(name: string): Promise<void>;
  deleteRuleset(id: number): Promise<void>;
  /** Creates an issue with the labels (they must exist) and returns it. Only the example issue of the Factory module calls the methods below. */
  createIssue(input: { title: string; body: string; labels: string[] }): Promise<IssueRef>;
  /** Links `child` under `parent` as a sub-issue. */
  addSubIssue(parent: number, child: number): Promise<void>;
  issueLabels(issue: number): Promise<string[]>;
  /** Adds labels (they must exist); this is what fires the `issues: labeled` event. */
  addLabels(issue: number, labels: string[]): Promise<void>;
  /** Cancels a workflow run that is still going. */
  cancelRun(run: number): Promise<void>;
  /** The newest pull request whose head is `branch`, in any state, or null. */
  findPullRequest(branch: string): Promise<PullRequestInfo | null>;
  /** The preview comment of the PR (`<!-- factory-previews -->`, its text) or null, and whether every check has finished. */
  pullRequestStatus(pr: number): Promise<{ previewComment: string | null; checksDone: boolean }>;
  /** Runs of a workflow file, newest first. */
  workflowRuns(workflow: string): Promise<WorkflowRun[]>;
  /** Closes a pull request without merging it. */
  closePullRequest(pr: number): Promise<void>;
  /** Deletes a branch of the repo; a branch that is already gone is not an error. Never the default branch. */
  deleteBranch(branch: string): Promise<void>;
  /** Deletes an issue for good (GraphQL `deleteIssue`; `gh issue delete`). */
  deleteIssue(issue: number): Promise<void>;
  /** Open or closed issues titled "The Skeleton must grow: ..." whose body mentions `#issue`. */
  findSkeletonFollowUps(issue: number): Promise<IssueRef[]>;
}

export interface IssueRef {
  number: number;
  url: string;
}

export interface PullRequestInfo extends IssueRef {
  state: "open" | "closed" | "merged";
}

export interface WorkflowRun {
  id: number;
  url: string;
  /** `queued`, `in_progress` or `completed`. */
  status: string;
  /** Set once completed: `success`, `failure`, `cancelled`, `skipped`... */
  conclusion: string | null;
  /** ISO time. */
  createdAt: string;
}

/**
 * The owner's fine-grained token, held in memory (it goes straight to the `FACTORY_TOKEN` secret). `gh` is signed in with
 * a different credential, so only the token itself can say what the token may do.
 */
export interface TokenClient {
  /** `GET /repos/{owner}/{repo}` with the token: whether it can push. Throws when GitHub rejects the token or the repo is not among its repositories. */
  repoAccess(repo: string): Promise<{ push: boolean }>;
}

/** The rules of a branch ruleset the wizard cares about. `ref` patterns are as GitHub stores them (`~DEFAULT_BRANCH`, `refs/heads/main`). */
export interface RulesetSpec {
  name: string;
  /** Ref patterns the ruleset applies to. */
  include: string[];
  /** Rule types: `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks`. */
  rules: string[];
  /** Contexts of the required status checks. */
  requiredChecks: string[];
}

export interface RulesetInfo {
  id: number;
  name: string;
  target: string;
  enforcement: string;
  include: string[];
  rules: string[];
  requiredChecks: string[];
}

export interface CloudflareAccount {
  id: string;
  name: string;
}

/** The API refused the call for lack of permission (HTTP 403 or error 10000): the token is valid but too narrow. */
export class CloudflareRefused extends Error {}

/**
 * wrangler's own saved login (`wrangler login`, kept by wrangler like neonctl keeps its login). The wizard never stores
 * the token it hands out; it only holds it in memory for the run.
 */
export interface WranglerAuth {
  /** The token of wrangler's saved login, or undefined when there is none. Never opens a browser. */
  savedToken(): Promise<string | undefined>;
  /** Opens the browser (`wrangler login`); the login is kept by wrangler for the next run. */
  login(): Promise<void>;
}

/** Bound to one API token, held in memory. */
export interface CloudflareClient {
  /** Read-only: the token is active (account-token verify, falling back to the user-token verify). */
  verifyToken(accountId: string): Promise<void>;
  /** Read-only probes of the main token, one per permission it must carry. Refusals throw `CloudflareRefused`. */
  listWorkerScripts(accountId: string): Promise<string[]>;
  listKvNamespaces(accountId: string): Promise<string[]>;
  /** The KV namespace titled exactly `title`, or null (needs Workers KV Storage: Read). */
  findKvNamespace(accountId: string, title: string): Promise<{ id: string; title: string } | null>;
  /** Needs Workers KV Storage: Edit. */
  createKvNamespace(accountId: string, title: string): Promise<{ id: string; title: string }>;
  getAccount(accountId: string): Promise<CloudflareAccount>;
  /** At most one zone of the account the token sees; probes Zone: Read without needing a domain. */
  listZones(): Promise<CloudflareZone[]>;
  /** Accounts the token can see; a failure means the token is invalid. */
  listAccounts(): Promise<CloudflareAccount[]>;
  /** The `workers.dev` subdomain of the account, or null when none is registered. */
  getWorkersSubdomain(accountId: string): Promise<string | null>;
  registerWorkersSubdomain(accountId: string, subdomain: string): Promise<void>;
  /** The zone whose name is exactly `name` in the account the token sees, or null. */
  findZone(name: string): Promise<CloudflareZone | null>;
  listDnsRecords(zoneId: string): Promise<CloudflareDnsRecord[]>;
  createDnsRecord(zoneId: string, record: NewDnsRecord): Promise<void>;
  workerExists(accountId: string, name: string): Promise<boolean>;
  /** Custom Domains attached to the Worker `service`. */
  listWorkerDomains(accountId: string, service: string): Promise<WorkerDomain[]>;
  attachWorkerDomain(accountId: string, domain: { hostname: string; service: string; zoneId: string; zoneName: string }): Promise<void>;
  /** Detaches every Custom Domain of the Worker (its DNS records stay). */
  deleteWorkerDomains(accountId: string, service: string): Promise<void>;
  /** Deletes the Worker script (with its Previews, Durable Objects and bindings). */
  deleteWorker(accountId: string, name: string): Promise<void>;
  deleteKvNamespace(accountId: string, id: string): Promise<void>;
}

export interface CloudflareZone {
  id: string;
  name: string;
}

export interface CloudflareDnsRecord {
  type: string;
  /** Fully qualified, as Cloudflare returns it. */
  name: string;
  content: string;
}

export interface NewDnsRecord extends CloudflareDnsRecord {
  priority?: number;
  /** Always false here: email records must not be proxied. */
  proxied: false;
}

export interface WorkerDomain {
  hostname: string;
  service: string;
}

export interface NeonProject {
  id: string;
  name: string;
}

export interface NeonOrg {
  id: string;
  name: string;
}

/**
 * Neon through `neonctl`. The browser login is kept by neonctl in its own config directory, so it is asked once per
 * machine; `NEON_API_KEY` from the environment skips it. Credentials stay inside the adapter; connection strings hold a password
 * and travel only as return values, from here straight to `GitHubClient.setSecret`.
 */
export interface NeonClient {
  /** Opens the browser to sign in, unless neonctl already has a saved login or the adapter was given an API key. */
  login(): Promise<void>;
  listOrgs(): Promise<NeonOrg[]>;
  /** Every project of the org, any name. Project names are not unique in Neon, so the caller filters and handles duplicates. */
  listProjects(orgId?: string): Promise<NeonProject[]>;
  createProject(name: string, orgId?: string): Promise<NeonProject>;
  /**
   * An API key that reaches only `projectId` (`neonctl api-keys create --project-id`), shown once. May be refused under
   * an OAuth login (the docs say the first key comes from the Console): the caller then asks for a pasted one.
   */
  createApiKey(name: string, projectId: string): Promise<string>;
  /** Name of the project's default branch. */
  defaultBranchName(projectId: string): Promise<string>;
  renameBranch(projectId: string, from: string, to: string): Promise<void>;
  /** Deletes the project with every branch and database in it. Irreversible. */
  deleteProject(projectId: string): Promise<void>;
  /** The connection string of the default branch: pooled (the Worker) or direct (migrations). */
  connectionString(projectId: string, options: { pooled: boolean; orgId?: string }): Promise<string>;
  /** Releases what the run holds. The neonctl login is kept, so the next run does not ask again. */
  close(): Promise<void>;
}

/**
 * The Product's production database, reached by the direct connection string held in memory. The passwords given to
 * `upsertUser` are hashed by the Skeleton's own function and go nowhere else.
 */
export interface AccountsClient {
  /** The Skeleton's migrations and then the Product's (the same code the deploy runs); idempotent. */
  migrate(databaseUrl: string, productId: string): Promise<void>;
  userExists(databaseUrl: string, email: string): Promise<boolean>;
  /** Whether a user with this email exists and is verified (so it can sign in). */
  verifiedUserExists(databaseUrl: string, email: string): Promise<boolean>;
  /** A verified user who signs in with `password`; an existing email gets verified and its password reset. */
  upsertUser(databaseUrl: string, user: { email: string; name: string; password: string }): Promise<"created" | "password-reset">;
}

/** A DNS record Resend asks for. `name` is relative to the domain, as Resend gives it. */
export interface ResendDnsRecord {
  record: string;
  type: string;
  name: string;
  value: string;
  priority?: number;
  status: string;
}

export interface ResendDomain {
  id: string;
  name: string;
  /** not_started, pending, verified, failed, temporary_failure... */
  status: string;
  records: ResendDnsRecord[];
}

/** Bound to one API key, held in memory. */
export interface ResendClient {
  findDomain(name: string): Promise<ResendDomain | null>;
  createDomain(name: string): Promise<ResendDomain>;
  /** Starts the asynchronous check; read the result with `findDomain`. */
  verifyDomain(id: string): Promise<void>;
  /** A sending-only key limited to the domain; the token is returned once. Needs a full-access key. */
  createRestrictedKey(input: { name: string; domainId: string }): Promise<string>;
  deleteDomain(id: string): Promise<void>;
}

/** What a wizard step asks of the person. Answers are never logged. */
export interface Prompter {
  note(message: string): void;
  /** Prints a message and then a URL alone on its own line: no frame, no wrapping, so terminals can detect the link. */
  link(message: string, url: string): void;
  text(input: { id: string; message: string; initial?: string }): Promise<string>;
  password(input: { id: string; message: string }): Promise<string>;
  select<T extends string>(input: { id: string; message: string; options: { value: T; label: string }[] }): Promise<T>;
  confirm(input: { id: string; message: string; initial?: boolean }): Promise<boolean>;
  /** Waits for Enter. Unlike the others, Ctrl-C returns instead of ending the process, so the caller can still clean up. */
  pause(input: { id: string; message: string }): Promise<void>;
  /** A spinner for a long wait; `stop` ends it with a final line. */
  spinner(message: string): { update(message: string): void; stop(message: string): void };
}
