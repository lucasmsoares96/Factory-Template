import type {
  CloudflareAccount,
  CloudflareClient,
  GitHubClient,
  LabelSpec,
  NeonClient,
  NeonProject,
  Prompter,
  RepoInfo,
  ResendClient,
  ResendDomain,
} from "../clients.ts";

/** In-memory forge. `writes` counts every mutation so tests can prove a run created nothing. */
export class FakeGitHub implements GitHubClient {
  readonly secrets = new Map<string, string>();
  readonly variables = new Map<string, string>();
  readonly labels = new Map<string, LabelSpec>();
  writes = 0;
  info: RepoInfo = { fullName: "owner/repo", visibility: "public", viewerPermission: "ADMIN", defaultBranch: "main" };
  login = "owner";

  async repo(): Promise<RepoInfo> {
    return this.info;
  }
  async user(): Promise<string> {
    return this.login;
  }
  async listSecrets(): Promise<string[]> {
    return [...this.secrets.keys()];
  }
  async setSecret(name: string, value: string): Promise<void> {
    this.writes++;
    this.secrets.set(name, value);
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
}

export class FakeCloudflare {
  readonly accounts: CloudflareAccount[] = [{ id: "acc-1", name: "Personal" }];
  readonly subdomains = new Map<string, string>();
  validTokens = new Set<string>(["good-token"]);
  writes = 0;

  /** The client a real run would build once it has the token. */
  forToken(token: string): CloudflareClient {
    const fail = () => {
      if (!this.validTokens.has(token)) throw new Error("Cloudflare rejected the token (401).");
    };
    return {
      listAccounts: async () => {
        fail();
        return this.accounts;
      },
      getWorkersSubdomain: async (accountId) => {
        fail();
        return this.subdomains.get(accountId) ?? null;
      },
      registerWorkersSubdomain: async (accountId, subdomain) => {
        fail();
        this.writes++;
        this.subdomains.set(accountId, subdomain);
      },
    };
  }
}

export class FakeNeon implements NeonClient {
  readonly projects: NeonProject[] = [];
  async findProject(name: string): Promise<NeonProject | null> {
    return this.projects.find((p) => p.name === name) ?? null;
  }
}

export class FakeResend implements ResendClient {
  readonly domains: ResendDomain[] = [];
  async findDomain(name: string): Promise<ResendDomain | null> {
    return this.domains.find((d) => d.name === name) ?? null;
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
  private readonly answers: Record<string, string | boolean>;

  constructor(answers: Record<string, string | boolean>) {
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
