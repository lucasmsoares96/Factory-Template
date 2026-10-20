import {
  CloudflareRefused,
  type CloudflareAccount,
  type CloudflareClient,
  type CloudflareDnsRecord,
  type CloudflareZone,
  type GitHubClient,
  type LabelSpec,
  type NewDnsRecord,
  type NeonClient,
  type NeonOrg,
  type NeonProject,
  type Prompter,
  type RepoInfo,
  type RulesetInfo,
  type RulesetSpec,
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
  readonly workerDomains: (WorkerDomain & { zoneId: string })[] = [];
  validTokens = new Set<string>(["good-token"]);
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
        return [];
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
      attachWorkerDomain: async (_accountId, domain) => {
        fail("workers");
        this.writes++;
        this.workerDomains.push({ hostname: domain.hostname, service: domain.service, zoneId: domain.zoneId });
      },
    };
  }
}

export class FakeNeon {
  readonly orgs: NeonOrg[] = [{ id: "org-1", name: "Personal" }];
  readonly projects: (NeonProject & { orgId: string; password: string })[] = [];
  /** Sessions opened with `forSession`, in order. */
  readonly sessions: { apiKey?: string; loggedIn: boolean; closed: number }[] = [];
  /** Every `orgId` a call carried, to prove it was passed on. */
  readonly orgIdsSeen: (string | undefined)[] = [];
  /** The next `login()` fails (the person closed the browser). */
  failLogin = false;
  validKeys = new Set<string>(["neon-full"]);
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
