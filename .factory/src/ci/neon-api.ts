// The Neon API, as far as the previews need it: the branches of the `<id>-preview` project. `base` is its default branch;
// every PR gets a child `preview/pr-N`. The key is project-scoped (made by `pnpm bootstrap previews <id>`) and lives
// only in the env of the two jobs that run `main`'s code. Docs read 2026-10-20:
// api-docs.neon.tech/reference/{createprojectbranch,listprojectbranches,getconnectionuri}; deleting is
// `DELETE /projects/{id}/branches/{branch_id}`, which refuses the default branch and a branch with children.
import { z } from "zod";

type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

const API = "https://console.neon.tech/api/v2";

export const BASE_BRANCH = "base";
/** The branch of a PR in the preview project. */
export const previewBranchName = (pr: number | string) => `preview/pr-${pr}`;

export interface Branch {
  id: string;
  name: string;
  default: boolean;
}

/** What the previews do to Neon; the real adapter is `NeonApi`, the tests use it over a fake `fetch`. */
export interface PreviewBranches {
  /** `base` exists: when no branch has that name, a fresh one is made from the default branch and becomes the default. */
  ensureBase(): Promise<{ branch: Branch; recreated: boolean }>;
  /** Every branch whose name starts with `preview/`. */
  listPreviewBranches(): Promise<Branch[]>;
  findBranch(name: string): Promise<Branch | undefined>;
  createBranch(name: string, parentId: string): Promise<Branch>;
  deleteBranch(id: string): Promise<void>;
  /** Direct (migrations) or pooled (the Worker) connection string of the branch's read-write endpoint. */
  connectionUri(branchId: string, options: { pooled: boolean }): Promise<string>;
}

const branchSchema = z.object({ id: z.string(), name: z.string(), default: z.boolean().optional() });
const toBranch = (b: z.infer<typeof branchSchema>): Branch => ({ id: b.id, name: b.name, default: b.default === true });

export class NeonApi implements PreviewBranches {
  private readonly apiKey: string;
  private readonly projectId: string;
  private readonly fetchFn: Fetch;
  private readonly role: string;
  private readonly database: string;

  constructor(options: { apiKey: string; projectId: string; fetchFn?: Fetch; role?: string; database?: string }) {
    if (!/^[a-z0-9-]{1,60}$/.test(options.projectId)) throw new Error("The Neon project id is not valid.");
    this.apiKey = options.apiKey;
    this.projectId = options.projectId;
    this.fetchFn = options.fetchFn ?? fetch;
    this.role = options.role ?? "neondb_owner";
    this.database = options.database ?? "neondb";
  }

  private async call<S extends z.ZodType>(method: string, path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
    const response = await this.fetchFn(`${API}/projects/${this.projectId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Only Neon's own message: never the request, which may carry the key.
      const message = (json as { message?: string }).message ?? "no message";
      throw new Error(`Neon ${method} ${path.split("?")[0]} answered ${response.status}: ${message}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(`Neon ${method} ${path.split("?")[0]} answered an unexpected shape.`);
    return parsed.data;
  }

  private async branches(): Promise<Branch[]> {
    const all: Branch[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.call("GET", `/branches?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, z.object({ branches: z.array(branchSchema), pagination: z.object({ next: z.string().optional() }).optional() }));
      all.push(...page.branches.map(toBranch));
      cursor = page.pagination?.next;
    } while (cursor);
    return all;
  }

  async findBranch(name: string): Promise<Branch | undefined> {
    return (await this.branches()).find((b) => b.name === name);
  }

  async listPreviewBranches(): Promise<Branch[]> {
    return (await this.branches()).filter((b) => b.name.startsWith("preview/"));
  }

  async createBranch(name: string, parentId: string): Promise<Branch> {
    // A read-write endpoint, capped at the smallest size: a preview is idle almost always.
    const body = { branch: { name, parent_id: parentId }, endpoints: [{ type: "read_write", autoscaling_limit_max_cu: 0.25 }] };
    const made = await this.call("POST", "/branches", z.object({ branch: branchSchema }), body);
    return toBranch(made.branch);
  }

  async deleteBranch(id: string): Promise<void> {
    await this.call("DELETE", `/branches/${encodeURIComponent(id)}`, z.unknown());
  }

  async connectionUri(branchId: string, options: { pooled: boolean }): Promise<string> {
    const query = new URLSearchParams({ branch_id: branchId, database_name: this.database, role_name: this.role, ...(options.pooled ? { pooled: "true" } : {}) });
    const { uri } = await this.call("GET", `/connection_uri?${query}`, z.object({ uri: z.string() }));
    if (!/^postgres(ql)?:\/\//.test(uri)) throw new Error("Neon did not answer a connection string.");
    return uri;
  }

  async ensureBase(): Promise<{ branch: Branch; recreated: boolean }> {
    const all = await this.branches();
    const found = all.find((b) => b.name === BASE_BRANCH);
    if (found) return { branch: found, recreated: false };
    const parent = all.find((b) => b.default);
    if (!parent) throw new Error("The preview project has no default branch to make base from.");
    const made = await this.createBranch(BASE_BRANCH, parent.id);
    await this.call("POST", `/branches/${encodeURIComponent(made.id)}/set_as_default`, z.unknown());
    return { branch: { ...made, default: true }, recreated: true };
  }
}
