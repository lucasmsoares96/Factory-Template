import {
  CloudflareRefused,
  type AccountsClient,
  type ExistingAccount,
  type CloudflareAccount,
  type CloudflareClient,
  type CloudflareDnsRecord,
  type CloudflareZone,
  type GitHubClient,
  type IssueRef,
  type PullRequestInfo,
  type WorkflowRun,
  type LabelSpec,
  type TokenClient,
  type NewDnsRecord,
  type NeonClient,
  type NeonOrg,
  type NeonProject,
  type Prompter,
  type RepoInfo,
  type RulesetInfo,
  type RulesetSpec,
  type ToolsClient,
  type WranglerAuth,
  type ResendClient,
  type ResendDnsRecord,
  type ResendDomain,
  type StripeClient,
  type StripePlanSpec,
  type StripePlanState,
  type StripePriceMigration,
  type StripeWebhook,
  type WorkerDomain,
} from "../clients.ts";
import { WEBHOOK_EVENTS } from "../stripe.ts";

/** In-memory forge. `writes` counts every mutation so tests can prove a run created nothing. */
export class FakeGitHub implements GitHubClient {
  readonly secrets = new Map<string, string>();
  /** Secrets of each environment, by environment name. */
  readonly environmentSecrets = new Map<string, Map<string, string>>();
  readonly variables = new Map<string, string>();
  readonly labels = new Map<string, LabelSpec>();
  /** Environment name -> the branch it is restricted to. */
  readonly environments = new Map<string, string>();
  readonly rulesets: RulesetInfo[] = [];
  /** Everything a secret was ever set to, by name: lets a test prove a value was never printed or written elsewhere. */
  readonly secretWrites: { name: string; environment?: string }[] = [];
  writes = 0;
  /** The repo fixed by `target`: what a real call would go to. */
  targeted: string | undefined;
  target(fullName: string): void {
    this.targeted = fullName;
    this.info = { ...this.info, fullName };
  }
  /** Simulates a repo whose plan refuses environments (private on Free). */
  refuseEnvironments = false;
  /** Same for rulesets. */
  refuseRulesets = false;
  /** The repo setting `allow_auto_merge`. */
  autoMerge = false;
  info: RepoInfo = { fullName: "owner/repo", visibility: "public", viewerPermission: "ADMIN", defaultBranch: "main" };
  login = "owner";
  /** Names of the deletes that must fail (`secret:NAME`, `variable:NAME`, `environment:NAME`, `ruleset`). */
  readonly failDeletes = new Set<string>();
  private deleting(key: string): void {
    if (this.failDeletes.has(key)) throw new Error(`gh delete failed: ${key} (HTTP 500)`);
    this.writes++;
  }
  async deleteSecret(name: string, options: { environment?: string } = {}): Promise<void> {
    this.deleting(`secret:${name}`);
    (options.environment ? this.environmentSecrets.get(options.environment) : this.secrets)?.delete(name);
  }
  async deleteVariable(name: string): Promise<void> {
    this.deleting(`variable:${name}`);
    this.variables.delete(name);
  }
  async deleteEnvironment(name: string): Promise<void> {
    this.deleting(`environment:${name}`);
    this.environments.delete(name);
    this.environmentSecrets.delete(name);
  }
  async deleteRuleset(id: number): Promise<void> {
    this.deleting("ruleset");
    const at = this.rulesets.findIndex((r) => r.id === id);
    if (at >= 0) this.rulesets.splice(at, 1);
  }

  /** The example issue flow: issues, sub-issue links, pull requests, branches and workflow runs. */
  readonly issues = new Map<number, { title: string; body: string; labels: string[]; url: string }>();
  readonly subIssues: { parent: number; child: number }[] = [];
  readonly pulls = new Map<number, PullRequestInfo & { head: string }>();
  readonly branches = new Set<string>();
  readonly runs = new Map<string, WorkflowRun[]>();
  readonly previewComments = new Map<number, string>();
  readonly checksDone = new Set<number>();
  /** Called once per poll of the example wait (on the child's label read): lets a test play the Factory. */
  onPoll: ((poll: number, github: FakeGitHub) => void) | undefined;
  polls = 0;
  /** Set to make the wait throw. */
  failStatus = false;
  nextNumber = 1;
  private addIssue(title: string, body: string, labels: string[]): number {
    const number = this.nextNumber++;
    this.issues.set(number, { title, body, labels: [...labels], url: `https://github.com/owner/repo/issues/${number}` });
    return number;
  }
  /** The state of `factory-resume.yml`; null: the repo has no such workflow. */
  resumeSweep: boolean | null = null;
  /** Open items under each label, as `countLabeled` returns them. */
  readonly labeledCounts = new Map<string, number>();
  async resumeSweepEnabled(): Promise<boolean | null> {
    return this.resumeSweep;
  }
  async setResumeSweep(enabled: boolean): Promise<void> {
    this.writes++;
    this.resumeSweep = enabled;
  }
  async countLabeled(label: string): Promise<number> {
    return this.labeledCounts.get(label) ?? 0;
  }
  async createIssue(input: { title: string; body: string; labels: string[] }): Promise<IssueRef> {
    this.deleting("create-issue");
    for (const l of input.labels) if (!this.labels.has(l)) throw new Error(`gh issue create failed: label ${l} does not exist (HTTP 422)`);
    const number = this.addIssue(input.title, input.body, input.labels);
    return { number, url: this.issues.get(number)!.url };
  }
  /** What a run of the Factory does: a follow-up issue about `child`. */
  openSkeletonFollowUp(child: number): number {
    return this.addIssue(`The Skeleton must grow: x`, `The Skeleton must grow: needs a change to finish #${child} (x).`, []);
  }
  async addSubIssue(parent: number, child: number): Promise<void> {
    this.deleting("sub-issue");
    this.subIssues.push({ parent, child });
  }
  async issueLabels(issue: number): Promise<string[]> {
    this.polls++;
    this.onPoll?.(this.polls, this);
    return [...(this.issues.get(issue)?.labels ?? [])];
  }
  readonly cancelled: number[] = [];
  async addLabels(issue: number, labels: string[]): Promise<void> {
    this.deleting("add-labels");
    for (const l of labels) if (!this.labels.has(l)) throw new Error(`gh issue edit failed: label ${l} does not exist`);
    const found = this.issues.get(issue)!;
    found.labels.push(...labels);
    this.labelEvents.push({ issue, labels });
  }
  /** Every `labeled` event: the real one starts the workflow. */
  readonly labelEvents: { issue: number; labels: string[] }[] = [];
  async cancelRun(run: number): Promise<void> {
    this.cancelled.push(run);
  }
  async findPullRequest(branch: string): Promise<PullRequestInfo | null> {
    const found = [...this.pulls.values()].find((p) => p.head === branch);
    return found ? { number: found.number, url: found.url, state: found.state } : null;
  }
  async pullRequestStatus(pr: number): Promise<{ previewComment: string | null; checksDone: boolean }> {
    if (this.failStatus) throw new Error("gh pr view failed: boom");
    return { previewComment: this.previewComments.get(pr) ?? null, checksDone: this.checksDone.has(pr) };
  }
  async workflowRuns(workflow: string): Promise<WorkflowRun[]> {
    return [...(this.runs.get(workflow) ?? [])];
  }
  addRun(workflow: string, run: Partial<WorkflowRun> = {}): WorkflowRun {
    const list = this.runs.get(workflow) ?? [];
    const full: WorkflowRun = { id: 100 + list.length, url: `https://github.com/owner/repo/actions/runs/${100 + list.length}`, status: "completed", conclusion: "success", createdAt: new Date().toISOString(), ...run };
    this.runs.set(workflow, [full, ...list]);
    return full;
  }
  /** What the closed-PR workflow does. Set to false to leave no run behind. */
  cleanupRunOnClose = true;
  async closePullRequest(pr: number): Promise<void> {
    this.deleting("close-pr");
    const found = this.pulls.get(pr);
    if (found) found.state = "closed";
    if (this.cleanupRunOnClose) this.addRun("factory-pr-cleanup.yml");
  }
  async deleteBranch(branch: string): Promise<void> {
    if (branch === this.info.defaultBranch) throw new Error("refusing the default branch");
    this.deleting(`branch:${branch}`);
    this.branches.delete(branch);
  }
  async deleteIssue(issue: number): Promise<void> {
    this.deleting(`issue:${issue}`);
    this.issues.delete(issue);
  }
  async findSkeletonFollowUps(issue: number): Promise<IssueRef[]> {
    return [...this.issues.entries()]
      .filter(([, i]) => i.title.startsWith("The Skeleton must grow") && i.body.includes(`#${issue}`))
      .map(([number, i]) => ({ number, url: i.url }));
  }

  async repo(): Promise<RepoInfo> {
    return this.info;
  }
  async user(): Promise<string> {
    return this.login;
  }
  private scope(environment?: string): Map<string, string> {
    if (!environment) return this.secrets;
    if (!this.environments.has(environment)) throw new Error(`gh secret set failed: environment ${environment} does not exist (HTTP 404)`);
    if (!this.environmentSecrets.has(environment)) this.environmentSecrets.set(environment, new Map());
    return this.environmentSecrets.get(environment)!;
  }
  async listSecrets(options: { environment?: string } = {}): Promise<string[]> {
    return [...(options.environment && !this.environments.has(options.environment) ? new Map() : this.scope(options.environment)).keys()];
  }
  async setSecret(name: string, value: string, options: { environment?: string } = {}): Promise<void> {
    this.writes++;
    this.secretWrites.push({ name, ...(options.environment ? { environment: options.environment } : {}) });
    this.scope(options.environment).set(name, value);
  }
  async listVariables(): Promise<Record<string, string>> {
    return Object.fromEntries(this.variables);
  }
  async setVariable(name: string, value: string): Promise<void> {
    this.writes++;
    this.variables.set(name, value);
  }
  async listLabels(): Promise<LabelSpec[]> {
    return [...this.labels.values()];
  }
  async upsertLabel(label: LabelSpec): Promise<void> {
    this.writes++;
    this.labels.set(label.name, { ...label });
  }
  async listEnvironments(): Promise<string[]> {
    return [...this.environments.keys()];
  }
  async upsertEnvironment(name: string, input: { branch: string }): Promise<"created" | "refused"> {
    if (this.refuseEnvironments) return "refused";
    this.writes++;
    this.environments.set(name, input.branch);
    return "created";
  }
  async listRulesets(): Promise<RulesetInfo[]> {
    return this.rulesets.map((r) => ({ ...r }));
  }
  async createRuleset(spec: RulesetSpec): Promise<"created" | "refused"> {
    if (this.refuseRulesets) return "refused";
    this.writes++;
    this.rulesets.push({
      id: 1000 + this.rulesets.length,
      name: spec.name,
      target: "branch",
      enforcement: "active",
      include: spec.include,
      rules: spec.rules,
      requiredChecks: spec.requiredChecks,
      strict: spec.strict,
    });
    return "created";
  }
  async autoMergeAllowed(): Promise<boolean> {
    return this.autoMerge;
  }
  async allowAutoMerge(): Promise<void> {
    this.writes++;
    this.autoMerge = true;
  }
  async requireUpToDate(id: number): Promise<"updated" | "refused"> {
    if (this.refuseRulesets) return "refused";
    const ruleset = this.rulesets.find((r) => r.id === id);
    if (!ruleset) throw new Error(`FakeGitHub: no ruleset ${id}`);
    this.writes++;
    ruleset.strict = true;
    return "updated";
  }
}

export class FakeCloudflare {
  readonly accounts: CloudflareAccount[] = [{ id: "acc-1", name: "Personal" }];
  readonly subdomains = new Map<string, string>();
  readonly zones: CloudflareZone[] = [];
  readonly dnsRecords = new Map<string, CloudflareDnsRecord[]>();
  readonly created: NewDnsRecord[] = [];
  readonly workers = new Set<string>();
  readonly kvNamespaces: { id: string; title: string }[] = [];
  readonly workerDomains: (WorkerDomain & { zoneId: string })[] = [];
  validTokens = new Set<string>(["good-token"]);
  /** Deletes that must fail: `worker:<name>`, `kv:<id>`. */
  readonly failDeletes = new Set<string>();
  /** Per token, the permissions it lacks: `workers`, `kv`, `account`, `dns`, `zone`. A call needing one is refused (403). */
  readonly denied = new Map<string, Set<string>>();
  writes = 0;

  deny(token: string, ...permissions: string[]): void {
    this.denied.set(token, new Set([...(this.denied.get(token) ?? []), ...permissions]));
  }

  /** The client a real run would build once it has the token. */
  forToken(token: string): CloudflareClient {
    const fail = (permission?: string) => {
      if (!this.validTokens.has(token)) throw new Error("Cloudflare rejected the token (401).");
      if (permission && this.denied.get(token)?.has(permission)) throw new CloudflareRefused(`Cloudflare rejected the token or request (403): needs ${permission}`);
    };
    return {
      verifyToken: async () => {
        fail();
      },
      listWorkerScripts: async () => {
        fail("workers");
        return [...this.workers];
      },
      listKvNamespaces: async () => {
        fail("kv");
        return this.kvNamespaces.map((ns) => ns.id);
      },
      findKvNamespace: async (_accountId, title) => {
        fail("kv");
        return this.kvNamespaces.find((ns) => ns.title === title) ?? null;
      },
      createKvNamespace: async (_accountId, title) => {
        fail("kv");
        this.writes++;
        const made = { id: `kv-${this.kvNamespaces.length + 1}`, title };
        this.kvNamespaces.push(made);
        return made;
      },
      getAccount: async (accountId) => {
        fail("account");
        const found = this.accounts.find((a) => a.id === accountId);
        if (!found) throw new Error("Cloudflare: account not found");
        return found;
      },
      listAccounts: async () => {
        fail("account");
        return this.accounts;
      },
      getWorkersSubdomain: async (accountId) => {
        fail("workers");
        return this.subdomains.get(accountId) ?? null;
      },
      registerWorkersSubdomain: async (accountId, subdomain) => {
        fail("workers");
        this.writes++;
        this.subdomains.set(accountId, subdomain);
      },
      listZones: async () => {
        fail("zone");
        return this.zones.slice(0, 1);
      },
      findZone: async (name) => {
        fail("zone");
        return this.zones.find((z) => z.name === name) ?? null;
      },
      listDnsRecords: async (zoneId) => {
        fail("dns");
        return [...(this.dnsRecords.get(zoneId) ?? [])];
      },
      createDnsRecord: async (zoneId, record) => {
        fail("dns");
        this.writes++;
        this.created.push(record);
        const { type, name, content } = record;
        this.dnsRecords.set(zoneId, [...(this.dnsRecords.get(zoneId) ?? []), { type, name, content }]);
      },
      workerExists: async (_accountId, name) => {
        fail("workers");
        return this.workers.has(name);
      },
      listWorkerDomains: async (_accountId, service) => {
        fail("workers");
        return this.workerDomains.filter((d) => d.service === service);
      },
      deleteWorkerDomains: async (_accountId, service) => {
        fail("workers");
        this.writes++;
        for (let i = this.workerDomains.length - 1; i >= 0; i--) if (this.workerDomains[i]!.service === service) this.workerDomains.splice(i, 1);
      },
      deleteWorker: async (_accountId, name) => {
        fail("workers");
        if (this.failDeletes.has(`worker:${name}`)) throw new Error(`Cloudflare: delete of ${name} failed (500)`);
        this.writes++;
        this.workers.delete(name);
      },
      deleteKvNamespace: async (_accountId, id) => {
        fail("kv");
        if (this.failDeletes.has(`kv:${id}`)) throw new Error(`Cloudflare: delete of ${id} failed (500)`);
        this.writes++;
        const at = this.kvNamespaces.findIndex((ns) => ns.id === id);
        if (at >= 0) this.kvNamespaces.splice(at, 1);
      },
      attachWorkerDomain: async (_accountId, domain) => {
        fail("workers");
        this.writes++;
        this.workerDomains.push({ hostname: domain.hostname, service: domain.service, zoneId: domain.zoneId });
      },
    };
  }
}

/** Node, pnpm and `gh` on this machine: set the fields to play a missing or wrong tool. The installs fix what they are told to. */
export class FakeTools implements ToolsClient {
  pins: { node?: string; pnpm?: string } = { node: "24.22.0", pnpm: "12.14.0" };
  node = "24.22.0";
  pnpm: string | undefined = "12.14.0";
  gh = true;
  loggedIn = true;
  /** `installGh` / `loginGh` leave the tool in place (false: the install or the login fails silently). */
  installWorks = true;
  loginWorks = true;
  installs = 0;
  logins = 0;
  async pinned() {
    return this.pins;
  }
  async nodeVersion() {
    return this.node;
  }
  async pnpmVersion() {
    return this.pnpm;
  }
  async ghInstalled() {
    return this.gh;
  }
  async ghAuthenticated() {
    return this.loggedIn;
  }
  async installGh() {
    this.installs++;
    this.gh = this.installWorks;
  }
  async loginGh() {
    this.logins++;
    this.loggedIn = this.loginWorks;
  }
}

/** wrangler's saved login: `savedToken` is what `wrangler auth token` would print; `login` saves `tokenAfterLogin`. */
export class FakeWrangler implements WranglerAuth {
  logins = 0;
  tokenChecks = 0;
  saved: string | undefined;
  tokenAfterLogin: string | undefined = "wrangler-oauth-token";
  constructor(saved?: string) {
    this.saved = saved;
  }
  async savedToken(): Promise<string | undefined> {
    this.tokenChecks++;
    return this.saved;
  }
  async login(): Promise<void> {
    this.logins++;
    this.saved = this.tokenAfterLogin;
  }
}

export class FakeNeon {
  readonly orgs: NeonOrg[] = [{ id: "org-1", name: "Personal" }];
  readonly projects: (NeonProject & { orgId: string; password: string; defaultBranch?: string })[] = [];
  /** The API keys `createApiKey` made, by project. */
  readonly apiKeys: { name: string; projectId: string; key: string }[] = [];
  /** `createApiKey` is refused (the docs: the first key comes from the Console), as it may be under an OAuth login. */
  refuseApiKeys = false;
  /** Sessions opened with `forSession`, in order. */
  readonly sessions: { apiKey?: string; loggedIn: boolean; closed: number }[] = [];
  /** Every `orgId` a call carried, to prove it was passed on. */
  readonly orgIdsSeen: (string | undefined)[] = [];
  /** The next `login()` fails (the person closed the browser). */
  failLogin = false;
  validKeys = new Set<string>(["neon-full"]);
  /** Project ids whose delete must fail. */
  readonly failDeletes = new Set<string>();
  writes = 0;

  forSession(options: { apiKey?: string }): NeonClient {
    const session = { ...(options.apiKey ? { apiKey: options.apiKey } : {}), loggedIn: false, closed: 0 };
    this.sessions.push(session);
    const authed = () => {
      if (session.closed > 0) throw new Error("Neon: the session was closed.");
      if (options.apiKey ? !this.validKeys.has(options.apiKey) : !session.loggedIn) throw new Error("Neon: not authenticated (401).");
    };
    return {
      login: async () => {
        if (options.apiKey) return;
        if (this.failLogin) throw new Error("neonctl auth failed (exit 1).");
        session.loggedIn = true;
      },
      listOrgs: async () => {
        authed();
        return this.orgs;
      },
      listProjects: async (orgId) => {
        authed();
        this.orgIdsSeen.push(orgId);
        return this.projects.filter((p) => !orgId || p.orgId === orgId).map(({ id, name }) => ({ id, name }));
      },
      createProject: async (name, orgId) => {
        authed();
        this.orgIdsSeen.push(orgId);
        this.writes++;
        const project = { id: `proj-${this.projects.length + 1}`, name, orgId: orgId ?? "org-1", password: `pw-${this.projects.length + 1}` };
        this.projects.push(project);
        return { id: project.id, name: project.name };
      },
      createApiKey: async (name, projectId) => {
        authed();
        if (this.refuseApiKeys) throw new Error("neonctl api-keys failed: the first API key must be created in the Console (403)");
        if (!this.projects.some((p) => p.id === projectId)) throw new Error("Neon: project not found (404).");
        this.writes++;
        const key = `napi_${projectId}_${this.apiKeys.length + 1}`;
        this.apiKeys.push({ name, projectId, key });
        return key;
      },
      defaultBranchName: async (projectId) => {
        authed();
        return this.projects.find((p) => p.id === projectId)?.defaultBranch ?? "main";
      },
      deleteProject: async (projectId) => {
        authed();
        if (this.failDeletes.has(projectId)) throw new Error(`neonctl projects failed: could not delete ${projectId}`);
        this.writes++;
        const at = this.projects.findIndex((p) => p.id === projectId);
        if (at >= 0) this.projects.splice(at, 1);
      },
      renameBranch: async (projectId, _from, to) => {
        authed();
        this.writes++;
        const project = this.projects.find((p) => p.id === projectId);
        if (project) project.defaultBranch = to;
      },
      connectionString: async (projectId, { pooled, orgId }) => {
        authed();
        this.orgIdsSeen.push(orgId);
        const project = this.projects.find((p) => p.id === projectId);
        if (!project) throw new Error("Neon: project not found (404).");
        return `postgresql://neondb_owner:${project.password}@ep-${project.id}${pooled ? "-pooler" : ""}.eu-central-1.aws.neon.tech/neondb?sslmode=require`;
      },
      close: async () => {
        session.closed++;
      },
    };
  }
}

/**
 * The production databases, by connection string. `events` is the order of calls, so a test can prove the migrations
 * ran before the first insert; an insert into a database nobody migrated fails like Postgres would (no table).
 */
export class FakeAccounts implements AccountsClient {
  readonly databases = new Map<string, { migrated: boolean; users: Map<string, { password: string; verified: boolean }>; existing: ExistingAccount[] }>();
  readonly events: string[] = [];
  writes = 0;

  private database(url: string) {
    let found = this.databases.get(url);
    if (!found) this.databases.set(url, (found = { migrated: false, users: new Map(), existing: [] }));
    return found;
  }
  async migrate(url: string, productId: string): Promise<void> {
    this.events.push(`migrate ${productId}`);
    this.database(url).migrated = true;
  }
  /** Accounts that were in the database before billing, with their Seats. */
  seedAccounts(url: string, accounts: (Partial<ExistingAccount> & Pick<ExistingAccount, "email">)[]): void {
    const db = this.database(url);
    for (const account of accounts) {
      db.existing.push({ id: `user-${account.email}`, name: account.email.split("@")[0]!, seats: 1, subscribed: false, stripeCustomerId: null, ...account });
    }
  }
  /** The customer ids linked to users, by email. */
  linkedCustomers(url: string): Record<string, string | null> {
    return Object.fromEntries(this.database(url).existing.map((account) => [account.email, account.stripeCustomerId]));
  }
  async listAccounts(url: string): Promise<ExistingAccount[]> {
    return this.database(url).existing.map((account) => ({ ...account }));
  }
  async linkStripeCustomer(url: string, userId: string, customerId: string): Promise<void> {
    this.writes++;
    const account = this.database(url).existing.find((candidate) => candidate.id === userId);
    if (account) account.stripeCustomerId = customerId;
  }
  async userExists(url: string, email: string): Promise<boolean> {
    return this.database(url).users.has(email.toLowerCase());
  }
  async verifiedUserExists(url: string, email: string): Promise<boolean> {
    return this.database(url).users.get(email.toLowerCase())?.verified === true;
  }
  async upsertUser(url: string, user: { email: string; name: string; password: string }) {
    const db = this.database(url);
    if (!db.migrated) throw new Error('relation "skeleton.users" does not exist');
    this.events.push(`upsert ${user.email.toLowerCase()}`);
    this.writes++;
    const existed = db.users.has(user.email.toLowerCase());
    db.users.set(user.email.toLowerCase(), { password: user.password, verified: true });
    return existed ? ("password-reset" as const) : ("created" as const);
  }
}

export class FakeResend {
  readonly domains: ResendDomain[] = [];
  readonly keys: { name: string; domainId: string; token: string }[] = [];
  validKeys = new Set<string>(["re-full"]);
  /** What a domain becomes once verification is triggered; "pending" simulates DNS that has not propagated. */
  verifyResult: "verified" | "pending" = "verified";
  verifyCalls = 0;
  writes = 0;

  /** Records Resend asks for on a new domain (shapes from the Create Domain reference). */
  static records(): ResendDnsRecord[] {
    return [
      { record: "DKIM", type: "TXT", name: "resend._domainkey", value: "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC-fake", status: "not_started" },
      { record: "SPF", type: "MX", name: "send", value: "feedback-smtp.us-east-1.amazonses.com", priority: 10, status: "not_started" },
      { record: "SPF", type: "TXT", name: "send", value: "v=spf1 include:amazonses.com ~all", status: "not_started" },
    ];
  }

  forKey(key: string): ResendClient {
    const fail = () => {
      if (!this.validKeys.has(key)) throw new Error("Resend refused the request (401).");
    };
    return {
      findDomain: async (name) => {
        fail();
        return this.domains.find((d) => d.name === name) ?? null;
      },
      createDomain: async (name) => {
        fail();
        this.writes++;
        const domain: ResendDomain = { id: `dom-${this.domains.length + 1}`, name, status: "not_started", records: FakeResend.records() };
        this.domains.push(domain);
        return domain;
      },
      verifyDomain: async (id) => {
        fail();
        this.verifyCalls++;
        const domain = this.domains.find((d) => d.id === id);
        if (domain) domain.status = this.verifyResult;
      },
      deleteDomain: async (id) => {
        fail();
        this.writes++;
        const at = this.domains.findIndex((d) => d.id === id);
        if (at >= 0) this.domains.splice(at, 1);
      },
      createRestrictedKey: async ({ name, domainId }) => {
        fail();
        this.writes++;
        const token = `re_restricted_${this.keys.length + 1}`;
        this.keys.push({ name, domainId, token });
        return token;
      },
    };
  }
}

/** Scripted answers by prompt id; asking for one that was not scripted fails the test. */
export class FakePrompter implements Prompter {
  readonly asked: string[] = [];
  /** Messages through `note`: framed and wrapped at `columns`, like clack does. */
  readonly notes: string[] = [];
  /** Lines through `link`: written verbatim, one per entry. */
  readonly printed: string[] = [];
  /** The message of every `text` prompt, in order. */
  readonly messages: string[] = [];
  columns = 80;
  private readonly answers: Record<string, string | boolean | string[]>;

  constructor(answers: Record<string, string | boolean | string[]>) {
    this.answers = answers;
  }

  /** Replaces the scripted answer of a prompt (a list is a queue). */
  script(id: string, answer: string | boolean | string[]): void {
    this.answers[id] = answer;
  }

  note(message: string): void {
    const width = Math.max(10, this.columns - 6);
    const wrapped = message.split("\n").flatMap((line) => line.match(new RegExp(`.{1,${width}}`, "g")) ?? [""]);
    this.notes.push(wrapped.map((l) => `| ${l}`).join("\n"));
  }
  link(message: string, url: string): void {
    this.printed.push(message, url);
  }
  private answer(id: string): string | boolean {
    this.asked.push(id);
    const value = this.answers[id];
    if (value === undefined) throw new Error(`Unscripted prompt: ${id}`);
    // A list is a queue: each ask takes the next answer; the last one repeats.
    if (Array.isArray(value)) return (value.length > 1 ? value.shift() : value[0]) as string;
    return value;
  }
  async text(input: { id: string; message?: string }): Promise<string> {
    this.messages.push(input.message ?? "");
    return String(this.answer(input.id));
  }
  async password(input: { id: string }): Promise<string> {
    return String(this.answer(input.id));
  }
  async select<T extends string>(input: { id: string }): Promise<T> {
    return String(this.answer(input.id)) as T;
  }
  /** Whether the repo confirmation was asked; it is not in `asked`, which lists the questions of the steps. */
  repoConfirmed: boolean | undefined;
  async confirm(input: { id: string }): Promise<boolean> {
    if (input.id === "repo-confirm") return (this.repoConfirmed = this.answers[input.id] === true);
    return this.answer(input.id) === true;
  }
  /** Ids of the `choose` prompts shown. An unscripted one, or the answer `cancel`, plays Ctrl-C (its `onCancel`). */
  readonly chosen: string[] = [];
  /** Lines shown through the spinner, in order. */
  readonly spun: string[] = [];
  async choose<T extends string>(input: { id: string; onCancel: T }): Promise<T> {
    this.chosen.push(input.id);
    const value = this.answers[input.id];
    return value === undefined || value === "cancel" ? input.onCancel : (String(value) as T);
  }
  spinner(message: string) {
    this.spun.push(message);
    return { update: (next: string) => void this.spun.push(next), stop: (last: string) => void this.spun.push(last) };
  }
}

/** The fine-grained tokens GitHub knows, by value: whether each can push to the repo. Unknown tokens are rejected. */
export class FakeTokens {
  private readonly tokens = new Map<string, { push: boolean }>();
  /** Every repo the tokens were asked about, in order: the only calls a token ever makes. */
  readonly asked: string[] = [];

  add(token: string, access: { push: boolean }): void {
    this.tokens.set(token, access);
  }

  forToken(token: string): TokenClient {
    return {
      repoAccess: async (repo) => {
        this.asked.push(repo);
        const access = this.tokens.get(token);
        if (!access) throw new Error("GitHub rejected the token (401 Bad credentials).");
        return access;
      },
    };
  }
}

/** One Stripe account (the sandbox or the real one) in memory. */
export class FakeStripeAccount {
  readonly plans = new Map<string, StripePlanSpec & { productId: string }>();
  /** Amounts the prices were made with, by lookup key (a price never changes). */
  /** `entitlement_<name>` metadata of each plan (`<product>/<plan>`). */
  readonly entitlements = new Map<string, Record<string, string>>();
  readonly prices = new Map<string, { id: string; amount: number; currency: string; interval: string }>();
  /** Prices a newer one replaced (same lookup key), kept for the Subscriptions still on them. */
  readonly archivedPrices: { id: string; lookupKey: string; amount: number; currency: string; interval: string }[] = [];
  /** Plans (`<product>/<key>`) archived because the answers no longer list them. */
  readonly archivedPlans = new Set<string>();
  /** Subscriptions a test puts on a price (by id); `scheduledTo` is set once the new price is scheduled for the renewal. */
  readonly subscriptions: { id: string; priceId: string; status: string; renewsAt: number; hasSchedule?: boolean; scheduledTo?: string }[] = [];
  priceCount = 0;
  readonly webhooks: (StripeWebhook & { productId: string; secret: string })[] = [];
  readonly portals = new Set<string>();
  readonly customers: { id: string; productId: string; userId: string; email: string }[] = [];
  /** Trials started with no card (Stripe cancels each when it ends): the price, the Seats and the days. */
  readonly trials: { customerId: string; productId: string; userId: string; lookupKey: string; seats: number; days: number }[] = [];
  paymentMethodsOn = false;
  writes = 0;
}

/**
 * Two fake Stripe accounts, told apart by the key's prefix (`_test_` is the sandbox). A key is valid when listed in
 * `keys`; `lacking` gives the permissions a key does not have.
 */
export class FakeStripe {
  readonly sandbox = new FakeStripeAccount();
  readonly live = new FakeStripeAccount();
  readonly keys = new Set<string>();
  /** Permissions a key lacks, by key. */
  readonly lacking = new Map<string, string[]>();
  private webhookCount = 0;

  accountOf(key: string): FakeStripeAccount {
    return key.includes("_test_") ? this.sandbox : this.live;
  }

  forKey(key: string): StripeClient {
    const account = this.accountOf(key);
    const check = () => {
      if (!this.keys.has(key)) throw new Error("Invalid API Key provided (401).");
    };
    return {
      missingPermissions: async () => {
        check();
        return this.lacking.get(key) ?? [];
      },
      listPlans: async (productId): Promise<StripePlanState[]> => {
        check();
        return [...account.plans.entries()]
          .filter(([id, plan]) => plan.productId === productId && !account.archivedPlans.has(id))
          .map(([, plan]) => plan)
          .map((plan) => ({
            key: plan.key,
            name: plan.name,
            kind: plan.kind,
            seats: plan.seats,
            entitlements: { ...account.entitlements.get(`${productId}/${plan.key}`) },
            prices: plan.prices
              .map((price) => {
                const { amount, currency, interval } = account.prices.get(price.lookupKey)!;
                return { lookupKey: price.lookupKey, amount, currency, interval };
              })
              .sort((a, b) => a.lookupKey.localeCompare(b.lookupKey)),
          }))
          .sort((a, b) => a.key.localeCompare(b.key));
      },
      ensurePlan: async (productId, plan, options) => {
        check();
        const created: string[] = [];
        const different: string[] = [];
        const replaced: string[] = [];
        const id = `${productId}/${plan.key}`;
        if (!account.plans.has(id) || account.archivedPlans.has(id)) {
          account.plans.set(id, { ...plan, productId, prices: [] });
          account.archivedPlans.delete(id);
          account.writes++;
          created.push(`product ${plan.key}`);
        }
        for (const price of plan.prices) {
          const found = account.prices.get(price.lookupKey);
          const changed = found !== undefined && (found.amount !== price.amount || found.currency !== plan.currency);
          if (found && !(changed && options?.replace)) {
            if (changed) different.push(price.lookupKey);
            continue;
          }
          if (found) {
            account.archivedPrices.push({ ...found, lookupKey: price.lookupKey });
            account.writes += 2;
            replaced.push(price.lookupKey);
          } else {
            account.writes++;
            created.push(`price ${price.lookupKey}`);
          }
          account.prices.set(price.lookupKey, { id: `price_${++account.priceCount}`, amount: price.amount, currency: plan.currency, interval: price.interval });
          const plans = account.plans.get(id)!;
          plans.prices = [...plans.prices.filter((p) => p.lookupKey !== price.lookupKey), price];
        }
        return { created, different, replaced };
      },
      archivePlansExcept: async (productId, keep) => {
        check();
        const archived: string[] = [];
        for (const [id, plan] of account.plans) {
          if (plan.productId !== productId || account.archivedPlans.has(id) || keep.includes(plan.key)) continue;
          account.archivedPlans.add(id);
          for (const price of plan.prices) {
            const found = account.prices.get(price.lookupKey);
            if (found) account.archivedPrices.push({ ...found, lookupKey: price.lookupKey });
            account.prices.delete(price.lookupKey);
          }
          account.writes++;
          archived.push(plan.key);
        }
        return archived.sort();
      },
      listPriceMigrations: async (): Promise<StripePriceMigration[]> => {
        check();
        const migrations: StripePriceMigration[] = [];
        for (const old of account.archivedPrices) {
          const next = account.prices.get(old.lookupKey);
          if (!next) continue;
          for (const sub of account.subscriptions) {
            if (sub.priceId !== old.id || sub.hasSchedule || sub.scheduledTo || !["active", "trialing", "past_due"].includes(sub.status)) continue;
            migrations.push({ subscriptionId: sub.id, lookupKey: old.lookupKey, fromPriceId: old.id, toPriceId: next.id, oldAmount: old.amount, newAmount: next.amount, currency: next.currency, renewsAt: sub.renewsAt });
          }
        }
        return migrations;
      },
      schedulePriceMigration: async (migration) => {
        check();
        account.writes++;
        account.subscriptions.find((sub) => sub.id === migration.subscriptionId)!.scheduledTo = migration.toPriceId;
      },
      ensureEntitlements: async (productId, planKey, values) => {
        check();
        const id = `${productId}/${planKey}`;
        if (!account.plans.has(id)) throw new Error(`Stripe has no product for the plan ${planKey}.`);
        const held = account.entitlements.get(id) ?? {};
        const added = Object.keys(values).filter((name) => !(name in held));
        for (const name of added) held[name] = String(values[name]);
        account.entitlements.set(id, held);
        if (added.length > 0) account.writes++;
        return added;
      },
      ensurePaymentMethods: async () => {
        check();
        if (account.paymentMethodsOn) return "unchanged";
        account.paymentMethodsOn = true;
        account.writes++;
        return "updated";
      },
      ensurePortal: async (productId) => {
        check();
        if (account.portals.has(productId)) return "unchanged";
        account.portals.add(productId);
        account.writes++;
        return "created";
      },
      listWebhooks: async (productId) => {
        check();
        return account.webhooks.filter((hook) => hook.productId === productId).map(({ id, url, events }) => ({ id, url, events }));
      },
      createWebhook: async (productId, url) => {
        check();
        account.writes++;
        const hook = { id: `we_${++this.webhookCount}`, url, productId, events: WEBHOOK_EVENTS, secret: `whsec_fake_${this.webhookCount}` };
        account.webhooks.push(hook);
        return { id: hook.id, secret: hook.secret };
      },
      deleteWebhook: async (id) => {
        check();
        account.writes++;
        const at = account.webhooks.findIndex((hook) => hook.id === id);
        if (at >= 0) account.webhooks.splice(at, 1);
      },
      createCustomer: async (productId, person) => {
        check();
        const found = account.customers.find((customer) => customer.productId === productId && customer.userId === person.userId);
        if (found) return found.id;
        account.writes++;
        const customer = { id: `cus_${account.customers.length + 1}`, productId, userId: person.userId, email: person.email };
        account.customers.push(customer);
        return customer.id;
      },
      startTrial: async (productId, trial) => {
        check();
        if (account.trials.some((sub) => sub.customerId === trial.customerId)) return "exists";
        account.writes++;
        account.trials.push({ productId, ...trial });
        return "started";
      },
    };
  }
}
