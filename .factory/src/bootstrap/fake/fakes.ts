import {
  CloudflareRefused,
  type AccountsClient,
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
  type WranglerAuth,
  type ResendClient,
  type ResendDnsRecord,
  type ResendDomain,
  type WorkerDomain,
} from "../clients.ts";

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
  /** Simulates a repo whose plan refuses environments (private on Free). */
  refuseEnvironments = false;
  /** Same for rulesets. */
  refuseRulesets = false;
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
    });
    return "created";
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
  readonly databases = new Map<string, { migrated: boolean; users: Map<string, { password: string; verified: boolean }> }>();
  readonly events: string[] = [];
  writes = 0;

  private database(url: string) {
    let found = this.databases.get(url);
    if (!found) this.databases.set(url, (found = { migrated: false, users: new Map() }));
    return found;
  }
  async migrate(url: string, productId: string): Promise<void> {
    this.events.push(`migrate ${productId}`);
    this.database(url).migrated = true;
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
  columns = 80;
  private readonly answers: Record<string, string | boolean | string[]>;

  constructor(answers: Record<string, string | boolean | string[]>) {
    this.answers = answers;
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
  async text(input: { id: string }): Promise<string> {
    return String(this.answer(input.id));
  }
  async password(input: { id: string }): Promise<string> {
    return String(this.answer(input.id));
  }
  async select<T extends string>(input: { id: string }): Promise<T> {
    return String(this.answer(input.id)) as T;
  }
  async confirm(input: { id: string }): Promise<boolean> {
    return this.answer(input.id) === true;
  }
  /** Ids of the `pause` prompts shown (the answer does not matter). */
  readonly paused: string[] = [];
  /** Lines shown through the spinner, in order. */
  readonly spun: string[] = [];
  async pause(input: { id: string }): Promise<void> {
    this.paused.push(input.id);
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
