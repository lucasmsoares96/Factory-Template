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
  listSecrets(): Promise<string[]>;
  /** Stores the value in the repo; it is never read back. */
  setSecret(name: string, value: string): Promise<void>;
  listVariables(): Promise<Record<string, string>>;
  setVariable(name: string, value: string): Promise<void>;
  listLabels(): Promise<LabelSpec[]>;
  /** Create or update (`gh label create --force`). */
  upsertLabel(label: LabelSpec): Promise<void>;
}

export interface CloudflareAccount {
  id: string;
  name: string;
}

/** Bound to one API token, held in memory. */
export interface CloudflareClient {
  /** Accounts the token can see; a failure means the token is invalid. */
  listAccounts(): Promise<CloudflareAccount[]>;
  /** The `workers.dev` subdomain of the account, or null when none is registered. */
  getWorkersSubdomain(accountId: string): Promise<string | null>;
  registerWorkersSubdomain(accountId: string, subdomain: string): Promise<void>;
}

export interface NeonProject {
  id: string;
  name: string;
}

export interface NeonClient {
  findProject(name: string): Promise<NeonProject | null>;
}

export interface ResendDomain {
  id: string;
  name: string;
  status: string;
}

export interface ResendClient {
  findDomain(name: string): Promise<ResendDomain | null>;
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
}
