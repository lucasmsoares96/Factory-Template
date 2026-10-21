import {
  CloudflareRefused,
  type AccountsClient,
  type CloudflareAccount,
  type CloudflareClient,
  type CloudflareDnsRecord,
  type CloudflareZone,
  type GitHubClient,
  type CollaboratorPermission,
  type LabelSpec,
  type MachineUserClient,
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
  /** Accepted collaborators, by login. */
  readonly collaborators = new Map<string, CollaboratorPermission>();
  /** Logins with a pending invitation. */
  readonly invitations = new Set<string>();

  async inviteCollaborator(login: string): Promise<void> {
    if (this.collaborators.has(login) || this.invitations.has(login)) return;
    this.writes++;
    this.invitations.add(login);
  }
  async collaboratorPermission(login: string): Promise<CollaboratorPermission> {
    return this.collaborators.get(login) ?? "none";
  }

  /** Names of the deletes that must fail (`secret:NAME`, `variable:NAME`, `environment:NAME`, `ruleset`, `collaborator`). */
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
  async removeCollaborator(login: string): Promise<void> {
    this.deleting("collaborator");
    this.collaborators.delete(login);
    this.invitations.delete(login);
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
}

/** The machine users' accounts, by classic PAT. Accepting an invitation turns it into a `write` collaborator of the fake repo. */
export class FakeMachineUsers {
  private readonly accounts = new Map<string, { login: string; scopes: string[] | null }>();
  /** The invitation cannot be accepted (the account never opens it). */
  acceptFails = false;
  private readonly github: FakeGitHub;

  constructor(github: FakeGitHub) {
    this.github = github;
  }

  add(token: string, account: { login: string; scopes: string[] | null }): void {
    this.accounts.set(token, account);
  }

  forToken(token: string): MachineUserClient {
    return {
      viewer: async () => {
        const account = this.accounts.get(token);
        if (!account) throw new Error("GitHub rejected the PAT (401 Bad credentials).");
        return account;
      },
      acceptInvitation: async () => {
        const account = this.accounts.get(token);
        if (!account || this.acceptFails || !this.github.invitations.has(account.login)) return false;
        this.github.writes++;
        this.github.invitations.delete(account.login);
        this.github.collaborators.set(account.login, "write");
        return true;
      },
    };
  }
}
