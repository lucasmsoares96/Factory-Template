// An in-memory Neon API (the branch endpoints the previews use) behind a `fetch`, so `NeonApi` is tested as it is:
// paths, bodies, the key header and the rules Neon enforces (no deleting the default branch or one with children).
export interface FakeNeonBranch {
  id: string;
  name: string;
  parent?: string;
  default: boolean;
}

export class FakeNeonProject {
  readonly branches: FakeNeonBranch[] = [];
  readonly calls: string[] = [];
  /** Every Authorization header seen. */
  readonly auth: (string | null)[] = [];
  /** The next create answers this status (e.g. 422 when the plan's branch limit is hit). */
  failCreateWith: number | undefined;
  private sequence = 0;

  readonly projectId: string;
  readonly apiKey: string;

  constructor(projectId = "proj-preview", apiKey = "napi-preview", defaultName: string | undefined = "base") {
    this.projectId = projectId;
    this.apiKey = apiKey;
    if (defaultName) this.branches.push({ id: "br-default", name: defaultName, default: true });
  }

  readonly fetch = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers as ConstructorParameters<typeof Headers>[0]);
    this.auth.push(headers.get("authorization"));
    this.calls.push(`${method} ${url.pathname.replace("/api/v2", "")}${url.search ? "?" + url.searchParams.toString() : ""}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (headers.get("authorization") !== `Bearer ${this.apiKey}`) return json(401, { message: "authentication failed" });
    const prefix = `/api/v2/projects/${this.projectId}`;
    if (!url.pathname.startsWith(prefix)) return json(403, { message: "this key cannot reach another project" });
    const rest = url.pathname.slice(prefix.length);

    if (method === "GET" && rest === "/branches") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const page = this.branches.slice(start, start + limit);
      const next = start + limit < this.branches.length ? { next: String(start + limit) } : {};
      return json(200, { branches: page, pagination: next });
    }
    if (method === "POST" && rest === "/branches") {
      if (this.failCreateWith) return json(this.failCreateWith, { message: "branch limit exceeded" });
      const body = JSON.parse(String(init.body)) as { branch: { name: string; parent_id?: string }; endpoints?: unknown[] };
      if (this.branches.some((b) => b.name === body.branch.name)) return json(409, { message: "branch name already exists" });
      const branch = { id: `br-${++this.sequence}`, name: body.branch.name, parent: body.branch.parent_id ?? this.branches.find((b) => b.default)?.id, default: false };
      this.branches.push(branch);
      return json(201, { branch, endpoints: body.endpoints ?? [] });
    }
    const delete_ = /^\/branches\/([\w-]+)$/.exec(rest);
    if (method === "DELETE" && delete_) {
      const branch = this.branches.find((b) => b.id === delete_[1]);
      if (!branch) return json(404, { message: "branch not found" });
      if (branch.default) return json(412, { message: "cannot delete the default branch" });
      if (this.branches.some((b) => b.parent === branch.id)) return json(412, { message: "branch has children" });
      this.branches.splice(this.branches.indexOf(branch), 1);
      return json(200, { branch });
    }
    const setDefault = /^\/branches\/([\w-]+)\/set_as_default$/.exec(rest);
    if (method === "POST" && setDefault) {
      const branch = this.branches.find((b) => b.id === setDefault[1]);
      if (!branch) return json(404, { message: "branch not found" });
      for (const b of this.branches) b.default = b === branch;
      return json(200, { branch });
    }
    if (method === "GET" && rest === "/connection_uri") {
      const id = url.searchParams.get("branch_id");
      if (!this.branches.some((b) => b.id === id)) return json(404, { message: "branch not found" });
      const pooled = url.searchParams.get("pooled") === "true";
      return json(200, { uri: `postgresql://${url.searchParams.get("role_name")}:pw-${id}@ep-${id}${pooled ? "-pooler" : ""}.neon.tech/${url.searchParams.get("database_name")}?sslmode=require` });
    }
    return json(404, { message: `unknown route ${method} ${rest}` });
  };
}
