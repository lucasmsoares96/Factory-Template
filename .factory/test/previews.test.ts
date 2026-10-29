import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import Stripe from "stripe";
import { afterEach, describe, expect, it } from "vitest";
import { FakeNeonProject } from "../src/ci/fake/neon-api.ts";
import { NeonApi } from "../src/ci/neon-api.ts";
import { FakeStripeSandbox } from "../src/ci/fake/stripe-api.ts";
import { StripePreviewApi, WEBHOOK_LIMIT } from "../src/ci/stripe-api.ts";
import {
  bindingSignature,
  bindingsChanged,
  COMMENT_MARKER,
  parseJsonc,
  planPreviews,
  prepareDatabase,
  previewConfig,
  previewTrust,
  previewUrl,
  registerBilling,
  removeBilling,
  removeDatabase,
  renderComment,
  upsertComment,
  GhPreviewForge,
  type Permission,
  type PreviewForge,
} from "../src/ci/previews.ts";
import { previewSmoke } from "../src/ci/smoke.ts";
import { fakeGh, type FakeGhOutput } from "./github/fake-gh.ts";

const repo = join(import.meta.dirname, "../..");
const exampleSource = parseJsonc(readFileSync(join(repo, "apps/example/wrangler.jsonc"), "utf8"));
// What the Cloudflare Vite plugin writes for the same Worker: names and classes the same, the KV id filled in by provisioning.
const exampleBuilt = {
  name: "example",
  main: "index.js",
  assets: { directory: "../client", not_found_handling: "single-page-application" },
  durable_objects: exampleSource.durable_objects,
  migrations: exampleSource.migrations,
  kv_namespaces: [{ binding: "OAUTH_KV", id: "prod-kv" }],
  vars: { EMAIL_TRANSPORT: "resend" },
  secrets: { required: ["DATABASE_URL", "BETTER_AUTH_SECRET"] },
  configPath: "/home/runner/apps/example/wrangler.jsonc",
  // The Cloudflare Vite plugin writes these empty in every build: they are no binding (seen on PR #10, 2026-10-20).
  dispatch_namespaces: [],
  pipelines: [],
  secrets_store_secrets: [],
  vpc_services: [],
  worker_loaders: [],
};

describe("which Products get a preview", () => {
  const matrix = [
    { name: "example", kind: "product" as const },
    { name: "shop", kind: "product" as const },
    { name: "@workspace/skeleton", kind: "package" as const },
  ];

  it("is the affected Products that are listed in PREVIEW_PRODUCTS", () => {
    expect(planPreviews({ matrix, previewProducts: "example" }).include).toEqual([{ id: "example", prefix: "EXAMPLE_" }]);
    expect(planPreviews({ matrix, previewProducts: "shop, example,ghost" }).include.map((e) => e.id)).toEqual(["example", "shop"]);
  });

  it("is none when the variable is empty, and never a package or an unaffected Product", () => {
    expect(planPreviews({ matrix, previewProducts: "" }).include).toEqual([]);
    expect(planPreviews({ matrix: [matrix[2]!], previewProducts: "@workspace/skeleton,other" }).include).toEqual([]);
  });

  it("ignores an id that does not look like a Product id", () => {
    expect(planPreviews({ matrix: [{ name: "Bad_Id", kind: "product" }], previewProducts: "Bad_Id" }).include).toEqual([]);
  });
});

describe("who may get a preview", () => {
  const trust = (over: Partial<Parameters<typeof previewTrust>[0]> = {}) =>
    previewTrust({ action: "synchronize", label: "", previewLabel: "preview", authorPermission: "read", senderPermission: "read", ...over });

  it.each<Permission>(["write", "maintain", "admin"])("an author with %s gets it on every event", (authorPermission) => {
    for (const action of ["opened", "synchronize", "reopened", "ready_for_review", "labeled"]) expect(trust({ authorPermission, action }).allowed).toBe(true);
  });

  it.each<Permission>(["read", "triage", "none"])("an author with %s does not get it from a push", (authorPermission) => {
    expect(trust({ authorPermission, action: "synchronize" }).allowed).toBe(false);
    expect(trust({ authorPermission, action: "opened" }).allowed).toBe(false);
  });

  it("another author gets it on the event of the `preview` label put by someone with write access", () => {
    expect(trust({ action: "labeled", label: "preview", senderPermission: "write" }).allowed).toBe(true);
    expect(trust({ action: "labeled", label: "preview", senderPermission: "admin" }).allowed).toBe(true);
  });

  it("not when the label came from someone without write access, or is another label, or the event is not the label's", () => {
    expect(trust({ action: "labeled", label: "preview", senderPermission: "triage" }).allowed).toBe(false);
    expect(trust({ action: "labeled", label: "bug", senderPermission: "admin" }).allowed).toBe(false);
    expect(trust({ action: "synchronize", label: "preview", senderPermission: "admin" }).allowed).toBe(false);
  });

  it("explains how to get one, naming the configured label", () => {
    expect(trust({ previewLabel: "needs-preview" }).why).toContain("`needs-preview`");
  });
});

describe("the bindings of a PR against main", () => {
  it("reads the example's own config (JSONC with comments) as OAUTH_KV and the two Durable Objects", () => {
    expect(bindingSignature(exampleSource)).toEqual(["do:PASSWORD_HASHER=PasswordHasher", "do:RATE_LIMITER=RateLimiter", "kv:OAUTH_KV"]);
  });

  it("are unchanged when the build only adds an id, a path or other settings", () => {
    expect(bindingsChanged(exampleBuilt, exampleSource)).toBe(false);
  });

  it("ignore the empty lists the Vite plugin writes, but a filled one is a binding", () => {
    expect(bindingSignature(exampleBuilt)).toEqual(bindingSignature(exampleSource));
    expect(bindingsChanged({ ...exampleBuilt, pipelines: [{ binding: "P", pipeline: "x" }] }, exampleSource)).toBe(true);
    expect(bindingsChanged({ ...exampleBuilt, worker_loaders: [{ binding: "L" }] }, exampleSource)).toBe(true);
  });

  it("changed when the PR adds, drops or renames a binding of any kind", () => {
    expect(bindingsChanged({ ...exampleBuilt, d1_databases: [{ binding: "DB", database_id: "x" }] }, exampleSource)).toBe(true);
    expect(bindingsChanged({ ...exampleBuilt, kv_namespaces: [] }, exampleSource)).toBe(true);
    expect(bindingsChanged({ ...exampleBuilt, kv_namespaces: [{ binding: "OTHER_KV" }] }, exampleSource)).toBe(true);
    expect(bindingsChanged({ ...exampleBuilt, services: [{ binding: "API", service: "prod" }] }, exampleSource)).toBe(true);
    expect(bindingsChanged({ ...exampleBuilt, ai: { binding: "AI" } }, exampleSource)).toBe(true);
  });

  it("changed when main has no config to compare with (a new Product)", () => {
    expect(bindingsChanged(exampleBuilt, undefined)).toBe(true);
  });

  it("parseJsonc keeps `//` inside strings and drops trailing commas", () => {
    expect(parseJsonc('{ "a": "http://x", // c\n "b": [1, 2,], /* d */ }')).toEqual({ a: "http://x", b: [1, 2] });
  });
});

describe("the preview's Worker config", () => {
  const config = previewConfig(exampleBuilt, { id: "example", kvId: "preview-kv" }) as Record<string, any>;

  it("has the previews block: the outbox transport and flag, the preview KV and the Durable Objects", () => {
    expect(config.previews.vars).toEqual({ EMAIL_TRANSPORT: "outbox", PREVIEW_OUTBOX: "true" });
    expect(config.previews.kv_namespaces).toEqual([{ binding: "OAUTH_KV", id: "preview-kv" }]);
    expect(config.previews.durable_objects).toEqual(exampleSource.durable_objects);
  });

  it("never points the preview at the production KV, not even at the top level", () => {
    expect(JSON.stringify(config)).not.toContain("prod-kv");
    expect(config.kv_namespaces).toEqual([{ binding: "OAUTH_KV", id: "preview-kv" }]);
  });

  it("keeps the Worker name of the Product, and drops the build machine's fields and the secret list", () => {
    expect(config.name).toBe("example");
    expect(config).not.toHaveProperty("configPath");
    expect(config).not.toHaveProperty("secrets");
  });

  it("keeps the vars of the PR but forces the preview ones over them", () => {
    const merged = previewConfig({ ...exampleBuilt, vars: { EMAIL_TRANSPORT: "resend", PREVIEW_OUTBOX: "false", GREETING: "hi" } }, { id: "example", kvId: "k" }) as Record<string, any>;
    expect(merged.previews.vars).toEqual({ EMAIL_TRANSPORT: "outbox", PREVIEW_OUTBOX: "true", GREETING: "hi" });
  });

  it("refuses a binding the preview has no resource for", () => {
    expect(() => previewConfig({ ...exampleBuilt, d1_databases: [{ binding: "DB" }] }, { id: "example", kvId: "k" })).toThrow(/d1:DB/);
  });
});

describe("the preview's billing tag", () => {
  it("is `pr-N` in the previews block when the PR is known, and absent otherwise", () => {
    const tagged = previewConfig(exampleBuilt, { id: "example", kvId: "k", pr: 12 }) as Record<string, any>;
    expect(tagged.previews.vars.BILLING_ENVIRONMENT).toBe("pr-12");
    expect(JSON.stringify(tagged)).not.toMatch(/STRIPE/);
    expect((previewConfig(exampleBuilt, { id: "example", kvId: "k" }) as Record<string, any>).previews.vars).not.toHaveProperty("BILLING_ENVIRONMENT");
  });

  it("is forced over a var of the PR with the same name", () => {
    const config = previewConfig({ ...exampleBuilt, vars: { BILLING_ENVIRONMENT: "production" } }, { id: "example", kvId: "k", pr: 3 }) as Record<string, any>;
    expect(config.previews.vars.BILLING_ENVIRONMENT).toBe("pr-3");
  });
});

describe("the Stripe sandbox of the previews", () => {
  const URL_OF_3 = "https://pr-3-example.bytewer.workers.dev";
  const setup = () => {
    const sandbox = new FakeStripeSandbox();
    return { sandbox, webhooks: new StripePreviewApi(sandbox.apiKey, { httpClient: Stripe.createFetchHttpClient(sandbox.fetch) }) };
  };

  it("gets the PR's events endpoint, tagged with the Product and `pr-N`, and hands back its secret", async () => {
    const { sandbox, webhooks } = setup();

    const result = await registerBilling({ webhooks, productId: "example", pr: 3, previewUrl: URL_OF_3 });

    expect(result).toEqual({ status: "on", secret: "whsec_1" });
    expect(sandbox.endpoints).toEqual([expect.objectContaining({ url: `${URL_OF_3}/api/auth/stripe/webhook`, metadata: { productId: "example", environment: "pr-3" } })]);
  });

  it("replaces the PR's endpoint on the next push (Stripe shows the secret once) and leaves the others alone", async () => {
    const { sandbox, webhooks } = setup();
    await registerBilling({ webhooks, productId: "example", pr: 3, previewUrl: URL_OF_3 });
    const other = await registerBilling({ webhooks, productId: "example", pr: 4, previewUrl: "https://pr-4-example.bytewer.workers.dev" });
    const production = sandbox.seed({ productId: "example" }, "https://example.com/api/auth/stripe/webhook");

    const again = await registerBilling({ webhooks, productId: "example", pr: 3, previewUrl: URL_OF_3 });

    expect(again.status).toBe("on");
    expect(sandbox.endpoints.filter((e) => e.metadata.environment === "pr-3")).toHaveLength(1);
    expect(sandbox.endpoints.filter((e) => e.metadata.environment === "pr-4")).toHaveLength(1);
    expect(sandbox.endpoints).toContain(production);
    expect(other.status).toBe("on");
    expect(again).not.toEqual({ status: "on", secret: "whsec_1" });
  });

  it("is `full` with no place left: nothing is made, and the endpoints that were there stay", async () => {
    const { sandbox, webhooks } = setup();
    for (let i = 0; i < WEBHOOK_LIMIT; i++) sandbox.seed({ productId: "example", environment: `pr-${100 + i}` });

    const result = await registerBilling({ webhooks, productId: "example", pr: 3, previewUrl: URL_OF_3 });

    expect(result).toEqual({ status: "full" });
    expect(sandbox.endpoints).toHaveLength(WEBHOOK_LIMIT);
    expect(sandbox.calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  it("counts the PR's own endpoint as a free place when it is replaced at the limit", async () => {
    const { sandbox, webhooks } = setup();
    for (let i = 0; i < WEBHOOK_LIMIT - 1; i++) sandbox.seed({ productId: "example", environment: `pr-${100 + i}` });
    await registerBilling({ webhooks, productId: "example", pr: 3, previewUrl: URL_OF_3 });
    expect(sandbox.endpoints).toHaveLength(WEBHOOK_LIMIT);

    expect((await registerBilling({ webhooks, productId: "example", pr: 3, previewUrl: URL_OF_3 })).status).toBe("on");
    expect(sandbox.endpoints).toHaveLength(WEBHOOK_LIMIT);
  });

  it("counts every endpoint of the sandbox, even one of another Product, and pages through them", async () => {
    const { sandbox, webhooks } = setup();
    for (let i = 0; i < 130; i++) sandbox.seed();
    // 130 is past one page of 100 and past the limit.
    expect((await registerBilling({ webhooks, productId: "example", pr: 3, previewUrl: URL_OF_3 })).status).toBe("full");
    expect(sandbox.calls.filter((c) => c === "GET /v1/webhook_endpoints").length).toBeGreaterThan(2);
  });

  it("is removed when the PR closes: only the PR's own endpoint of that Product, and a missing one is no error", async () => {
    const { sandbox, webhooks } = setup();
    await registerBilling({ webhooks, productId: "example", pr: 3, previewUrl: URL_OF_3 });
    await registerBilling({ webhooks, productId: "example", pr: 4, previewUrl: "https://pr-4-example.bytewer.workers.dev" });
    await registerBilling({ webhooks, productId: "shop", pr: 3, previewUrl: "https://pr-3-shop.bytewer.workers.dev" });
    const production = sandbox.seed({ productId: "example" });

    expect(await removeBilling({ webhooks, productId: "example", pr: 3 })).toBe(1);
    expect(await removeBilling({ webhooks, productId: "example", pr: 3 })).toBe(0);

    expect(sandbox.endpoints.map((e) => `${e.metadata.productId}/${e.metadata.environment}`)).toEqual(["example/pr-4", "shop/pr-3", "example/undefined"]);
    expect(sandbox.endpoints).toContain(production);
  });

  it("never writes plans or Entitlements: the only calls are the events endpoints'", async () => {
    const { sandbox, webhooks } = setup();
    await registerBilling({ webhooks, productId: "example", pr: 3, previewUrl: URL_OF_3 });
    await registerBilling({ webhooks, productId: "example", pr: 3, previewUrl: URL_OF_3 });
    await removeBilling({ webhooks, productId: "example", pr: 3 });

    expect(sandbox.calls.every((c) => /^(GET|POST|DELETE) \/v1\/webhook_endpoints(\/we_\d+)?$/.test(c))).toBe(true);
  });

  it("sends the key as a bearer token, and a wrong key or an error shows Stripe's message and not the key", async () => {
    const sandbox = new FakeStripeSandbox("rk_test_right");
    const webhooks = new StripePreviewApi("rk_test_wrong", { httpClient: Stripe.createFetchHttpClient(sandbox.fetch) });

    const error = await registerBilling({ webhooks, productId: "example", pr: 3, previewUrl: URL_OF_3 }).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("rk_test_wrong");
    expect(sandbox.auth).toEqual(["Bearer rk_test_wrong"]);
  });

  it("refuses a live key: the previews never touch the real account", () => {
    expect(() => new StripePreviewApi("rk_live_abc")).toThrow(/sandbox/);
    expect(() => new StripePreviewApi("sk_live_abc")).toThrow(/sandbox/);
  });

  it("shows in the comment, in both languages, that a ready preview runs without billing and why", () => {
    const base = { trusted: true, previewLabel: "preview", products: ["example"] };
    const ready = { id: "example", status: "deployed" as const, url: URL_OF_3, smoke: "passed" as const };
    const full = renderComment({ ...base, language: "en", results: [{ ...ready, billing: "full" }] });
    expect(full).toContain(`${URL_OF_3} (smoke passed)`);
    expect(full).toContain("billing is off in this preview");
    expect(full).toContain("16 events endpoints");
    expect(renderComment({ ...base, language: "pt-BR", results: [{ ...ready, billing: "full" }] })).toContain("a cobrança está desligada neste preview");
    expect(renderComment({ ...base, language: "en", results: [{ ...ready, billing: "unavailable" }] })).toContain("did not accept its events endpoint");
    expect(renderComment({ ...base, language: "en", results: [{ ...ready, billing: "on" }] })).not.toContain("billing is off");
    expect(renderComment({ ...base, language: "en", results: [ready] })).not.toContain("billing");
  });
});

describe("`previews.ts billing` and `cleanup-billing` (the CLI)", () => {
  const run = promisify(execFile);
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "billing-"));
    dirs.push(dir);
    return dir;
  };
  const script = join(repo, ".factory/src/ci/previews.ts");
  const call = async (args: string[], env: Record<string, string>, dir: string) => {
    const output = join(dir, "output");
    writeFileSync(output, "");
    const { stdout } = await run("node", [script, ...args], { cwd: repo, env: { PATH: process.env.PATH!, GITHUB_OUTPUT: output, ...env } });
    return { stdout, output: readFileSync(output, "utf8") };
  };

  it("says nothing is set up, and writes nothing, when the Product has no sandbox key", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "url.txt"), "https://pr-3-example.bytewer.workers.dev");
    const result = await call(["billing", "--product", "example", "--url-file", join(dir, "url.txt"), "--file", join(dir, "env.json")], { PR_NUMBER: "3" }, dir);
    expect(result.stdout).toContain("billing is not set up");
    expect(result.output).toBe("");
    expect((await call(["cleanup-billing", "--product", "example"], { PR_NUMBER: "3" }, dir)).stdout).toContain("no billing endpoint to delete");
  });

  it("leaves the preview as it is (status `unavailable`, the Worker's secrets file untouched) when the URL is not a workers.dev one", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "url.txt"), "https://evil.example.com");
    writeFileSync(join(dir, "env.json"), '{"DATABASE_URL":"x"}');
    const result = await call(["billing", "--product", "example", "--url-file", join(dir, "url.txt"), "--file", join(dir, "env.json")], { PR_NUMBER: "3", STRIPE_SANDBOX_KEY: "rk_test_secret" }, dir);
    expect(result.output).toBe("status=unavailable\n");
    expect(result.stdout).not.toContain("rk_test_secret");
    expect(readFileSync(join(dir, "env.json"), "utf8")).toBe('{"DATABASE_URL":"x"}');
  });

  it("writes the `billing` of the result next to the URL, only for a deployed preview", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "url.txt"), "https://pr-3-example.bytewer.workers.dev");
    await call(["result", "--product", "example", "--status", "deployed", "--file", join(dir, "url.txt"), "--out", join(dir, "a.json")], { BILLING: "full" }, dir);
    await call(["result", "--product", "example", "--status", "failed", "--file", join(dir, "url.txt"), "--out", join(dir, "b.json")], { BILLING: "full" }, dir);
    expect(JSON.parse(readFileSync(join(dir, "a.json"), "utf8"))).toEqual({ id: "example", status: "deployed", url: "https://pr-3-example.bytewer.workers.dev", billing: "full" });
    expect(JSON.parse(readFileSync(join(dir, "b.json"), "utf8"))).toEqual({ id: "example", status: "failed" });
  });
});

describe("the preview URL in wrangler's output file", () => {
  it("is the first preview URL of the last preview entry", () => {
    const ndjson = [
      JSON.stringify({ type: "wrangler-session", version: 1 }),
      JSON.stringify({ type: "preview", version: 1, preview_name: "pr-3", preview_urls: ["https://pr-3-example.bytewer.workers.dev"], deployment_urls: ["https://x"] }),
    ].join("\n");
    expect(previewUrl(ndjson)).toBe("https://pr-3-example.bytewer.workers.dev");
    expect(previewUrl(JSON.stringify({ type: "deploy", targets: ["https://example.bytewer.workers.dev"] }))).toBeUndefined();
  });
});

describe("the Neon branch of a PR", () => {
  const world = (defaultName: string | undefined = "base") => {
    const project = new FakeNeonProject("proj-preview", "napi-preview", defaultName);
    const db = new NeonApi({ apiKey: "napi-preview", projectId: "proj-preview", fetchFn: project.fetch });
    return { project, db };
  };
  const names = (project: FakeNeonProject) => project.branches.map((b) => b.name);

  it("is `preview/pr-N`, a child of `base`, with a direct and a pooled connection string", async () => {
    const { project, db } = world();

    const result = await prepareDatabase({ db, pr: 7, limit: 9 });

    expect(result).toMatchObject({ status: "ready", created: true });
    expect(names(project)).toEqual(["base", "preview/pr-7"]);
    const branch = project.branches.find((b) => b.name === "preview/pr-7")!;
    expect(branch.parent).toBe("br-default");
    if (result.status === "ready") {
      expect(result.pooledUrl).toContain("-pooler");
      expect(result.directUrl).not.toContain("-pooler");
      expect(result.directUrl).toContain(branch.id);
    }
  });

  it("is reused by the next push, and does not count against the limit", async () => {
    const { project, db } = world();
    await prepareDatabase({ db, pr: 7, limit: 1 });

    const again = await prepareDatabase({ db, pr: 7, limit: 1 });

    expect(again).toMatchObject({ status: "ready", created: false });
    expect(names(project)).toEqual(["base", "preview/pr-7"]);
  });

  it("is skipped with `limit-reached` when the Product already has 9 previews open", async () => {
    const { project, db } = world();
    for (let pr = 1; pr <= 9; pr++) await prepareDatabase({ db, pr, limit: 9 });

    const tenth = await prepareDatabase({ db, pr: 10, limit: 9 });

    expect(tenth).toEqual({ status: "skipped", reason: "limit-reached" });
    expect(project.branches).toHaveLength(10);
  });

  it("recreates `base` from the default branch when it is gone, and makes it the default", async () => {
    const { project, db } = world("main");

    await prepareDatabase({ db, pr: 2, limit: 9 });

    expect(names(project).sort()).toEqual(["base", "main", "preview/pr-2"]);
    expect(project.branches.find((b) => b.name === "base")!.default).toBe(true);
    expect(project.branches.find((b) => b.name === "preview/pr-2")!.parent).toBe(project.branches.find((b) => b.name === "base")!.id);
  });

  it("is deleted when the PR closes, and a missing one is no error", async () => {
    const { project, db } = world();
    await prepareDatabase({ db, pr: 4, limit: 9 });

    expect(await removeDatabase({ db, pr: 4 })).toBe(true);
    expect(await removeDatabase({ db, pr: 4 })).toBe(false);
    expect(names(project)).toEqual(["base"]);
  });

  it("never deletes `base`, even by name: only `preview/pr-N` is looked up", async () => {
    const { project, db } = world();
    await removeDatabase({ db, pr: 99 });
    expect(names(project)).toEqual(["base"]);
    await expect(db.deleteBranch("br-default")).rejects.toThrow(/412/);
  });

  it("sends the key as a bearer token and names only Neon's message in an error, never the key", async () => {
    const { project } = world();
    const wrong = new NeonApi({ apiKey: "napi-wrong", projectId: "proj-preview", fetchFn: project.fetch });
    const error = await wrong.findBranch("base").catch((e: Error) => e);
    expect(String(error)).toContain("401");
    expect(String(error)).not.toContain("napi-wrong");
    expect(project.auth.at(-1)).toBe("Bearer napi-wrong");
  });

  it("a key of another project reaches nothing", async () => {
    const { project } = world();
    const other = new NeonApi({ apiKey: "napi-preview", projectId: "proj-production", fetchFn: project.fetch });
    await expect(other.findBranch("base")).rejects.toThrow(/403/);
  });

  it("pages through every branch", async () => {
    const { project, db } = world();
    for (let i = 0; i < 130; i++) project.branches.push({ id: `br-x${i}`, name: `preview/pr-${1000 + i}`, parent: "br-default", default: false });
    expect(await db.listPreviewBranches()).toHaveLength(130);
  });
});

describe("the one PR comment", () => {
  class FakeForge implements PreviewForge {
    readonly stored: { id: number; body: string; bot: boolean }[] = [];
    writes = 0;
    async permission(): Promise<Permission> {
      return "write";
    }
    async comments() {
      return this.stored.map((c) => ({ ...c }));
    }
    async createComment(_pr: number, body: string) {
      this.writes++;
      this.stored.push({ id: this.stored.length + 1, body, bot: true });
    }
    async updateComment(id: number, body: string) {
      this.writes++;
      this.stored.find((c) => c.id === id)!.body = body;
    }
  }

  const deployed = { id: "example", status: "deployed" as const, url: "https://pr-3-example.bytewer.workers.dev", smoke: "passed" as const };

  it("lists each Product with its URL and smoke", () => {
    const text = renderComment({ language: "en", trusted: true, previewLabel: "preview", products: ["example", "shop"], results: [deployed, { id: "shop", status: "deployed", url: "https://pr-3-shop.bytewer.workers.dev", smoke: "failed" }], sha: "abcdef1234" });
    expect(text).toContain(COMMENT_MARKER);
    expect(text).toContain("| `example` | https://pr-3-example.bytewer.workers.dev (smoke passed) |");
    expect(text).toContain("| `shop` | https://pr-3-shop.bytewer.workers.dev (smoke failed) |");
    expect(text).toContain("abcdef1");
  });

  it("says `preview skipped: limit reached` and why a PR that changed the bindings has none", () => {
    const text = renderComment({ language: "en", trusted: true, previewLabel: "preview", products: ["example", "shop"], results: [{ id: "example", status: "limit-reached" }, { id: "shop", status: "bindings-changed" }] });
    expect(text).toContain("preview skipped: limit reached");
    expect(text).toContain("preview skipped: the Worker bindings changed");
  });

  it("says a Product has no preview when its build or deploy never wrote a result", () => {
    expect(renderComment({ language: "en", trusted: true, previewLabel: "preview", products: ["example"], results: [] })).toContain("preview not deployed");
  });

  it("asks for the label when the author is not trusted", () => {
    const text = renderComment({ language: "en", trusted: false, previewLabel: "preview", products: ["example"], results: [] });
    expect(text).toContain("Preview not deployed: the author has no write access: someone with write access must add the `preview` label.");
    expect(text).not.toContain("| Product |");
  });

  it("is in Portuguese in every case with pt-BR, under the same marker", () => {
    const ready = renderComment({ language: "pt-BR", trusted: true, previewLabel: "preview", products: ["example", "shop"], results: [deployed, { id: "shop", status: "deployed", url: "https://pr-3-shop.bytewer.workers.dev", smoke: "failed" }], sha: "abcdef1234" });
    expect(ready.startsWith(COMMENT_MARKER)).toBe(true);
    expect(ready).toContain("| `example` | https://pr-3-example.bytewer.workers.dev (smoke passou) |");
    expect(ready).toContain("| `shop` | https://pr-3-shop.bytewer.workers.dev (smoke falhou) |");
    expect(ready).toContain("Commit abcdef1. O preview e o banco de dados dele são apagados quando o PR fecha.");

    const skipped = renderComment({ language: "pt-BR", trusted: true, previewLabel: "preview", products: ["example", "shop", "blog", "docs"], results: [{ id: "example", status: "limit-reached" }, { id: "shop", status: "bindings-changed" }, { id: "blog", status: "failed" }] });
    expect(skipped).toContain("| `example` | preview pulado: limite atingido |");
    expect(skipped).toContain("preview pulado: os bindings do Worker mudaram");
    expect(skipped).toContain("| `blog` | o preview falhou (veja a execução) |");
    expect(skipped).toContain("| `docs` | preview não publicado");

    const untrusted = renderComment({ language: "pt-BR", trusted: false, previewLabel: "preview", products: ["example"], results: [] });
    expect(untrusted).toContain("Preview não publicado: quem abriu o PR não tem acesso de escrita; alguém com acesso de escrita precisa adicionar o label `preview`.");

    for (const text of [ready, skipped, untrusted]) expect(text).not.toMatch(/smoke passed|smoke failed|skipped|not deployed|see the run|deleted when/);
  });

  it("never puts a URL outside workers.dev in the comment", () => {
    const text = renderComment({ language: "en", trusted: true, previewLabel: "preview", products: ["example"], results: [{ ...deployed, url: "https://evil.example/phish" }] });
    expect(text).not.toContain("evil.example");
  });

  it("is edited by the next push, not duplicated, and a comment of a person is never touched", async () => {
    const forge = new FakeForge();
    forge.stored.push({ id: 100, body: `${COMMENT_MARKER} pasted by a person`, bot: false });
    const first = `${COMMENT_MARKER}\nfirst`;
    const second = `${COMMENT_MARKER}\nsecond`;
    expect(await upsertComment(forge, 3, first)).toBe("created");
    expect(await upsertComment(forge, 3, second)).toBe("updated");
    expect(forge.stored.map((c) => c.body)).toEqual([`${COMMENT_MARKER} pasted by a person`, second]);
    const writes = forge.writes;
    await upsertComment(forge, 3, second);
    expect(forge.writes).toBe(writes);
  });
});

describe("the preview smoke", () => {
  /** A preview as the Worker serves it: Better Auth's flow in memory, the outbox route, the `/mcp` challenge. */
  function fakePreview(options: { outbox?: "route" | "missing"; sendEmail?: boolean; healthy?: boolean; mcp?: number } = {}) {
    const { outbox = "route", sendEmail = true, healthy = true, mcp = 401 } = options;
    const users = new Map<string, { password: string; verified: boolean }>();
    const mails: { to: string; html: string }[] = [];
    const calls: string[] = [];
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
    const fetchFn = (async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      calls.push(`${method} ${url.pathname}`);
      if (url.pathname === "/api/health") return healthy ? json(200, { status: "ok" }) : json(503, { code: "DATABASE_UNAVAILABLE" });
      if (url.pathname === "/api/auth/sign-up/email") {
        const body = JSON.parse(String(init.body)) as { email: string; password: string };
        users.set(body.email, { password: body.password, verified: false });
        if (sendEmail) mails.push({ to: body.email, html: `<a href="https://elsewhere.example/api/auth/verify-email?token=t-${body.email}&amp;callbackURL=%2Femail-verified">Verify</a>` });
        return json(200, { user: { email: body.email } });
      }
      if (url.pathname === "/api/preview/outbox") {
        if (outbox === "missing") return json(404, { code: "NOT_FOUND" });
        return json(200, { emails: mails.filter((m) => m.to === url.searchParams.get("to")) });
      }
      if (url.pathname === "/api/auth/verify-email") {
        const email = url.searchParams.get("token")!.slice(2);
        users.get(email)!.verified = true;
        return new Response(null, { status: 302, headers: { location: "/email-verified" } });
      }
      if (url.pathname === "/api/auth/sign-in/email") {
        const body = JSON.parse(String(init.body)) as { email: string; password: string };
        const user = users.get(body.email);
        if (!user?.verified || user.password !== body.password) return json(403, { code: "EMAIL_NOT_VERIFIED" });
        return json(200, { ok: true }, { "set-cookie": `session=${body.email}; Path=/; HttpOnly` });
      }
      if (url.pathname === "/api/me") {
        const cookie = new Headers(init.headers as ConstructorParameters<typeof Headers>[0]).get("cookie");
        return cookie ? json(200, { email: cookie.replace("session=", "") }) : json(401, { code: "UNAUTHENTICATED" });
      }
      if (url.pathname === "/mcp") return mcp === 401 ? json(401, {}, { "www-authenticate": 'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource"' }) : json(mcp, {});
      return json(404, {});
    }) as typeof fetch;
    return { fetchFn, calls, users };
  }
  const fast = { sleep: async () => {}, polls: 3, random: (() => { let n = 0; return () => `r${++n}`; })() };

  it("signs up, verifies through the outbox, signs in, reads /api/me and gets the /mcp challenge", async () => {
    const preview = fakePreview();

    const result = await previewSmoke("https://pr-1-example.workers.dev", { ...fast, fetchFn: preview.fetchFn });

    expect(result).toEqual({ ok: true, problems: [] });
    expect(preview.calls).toEqual([
      "GET /api/health",
      "POST /api/auth/sign-up/email",
      "GET /api/preview/outbox",
      "GET /api/auth/verify-email",
      "POST /api/auth/sign-in/email",
      "GET /api/me",
      "POST /mcp",
    ]);
  });

  it("follows the verification link on the preview's own origin, not the host the email names", async () => {
    const preview = fakePreview();
    const seen: string[] = [];
    const spy = ((input: string | URL, init?: RequestInit) => {
      seen.push(new URL(String(input)).origin);
      return preview.fetchFn(input, init);
    }) as typeof fetch;

    await previewSmoke("https://pr-1-example.workers.dev", { ...fast, fetchFn: spy });

    expect(new Set(seen)).toEqual(new Set(["https://pr-1-example.workers.dev"]));
  });

  it("fails naming the route when the preview has no outbox route", async () => {
    const result = await previewSmoke("https://p.workers.dev", { ...fast, fetchFn: fakePreview({ outbox: "missing" }).fetchFn });
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("/api/preview/outbox answered 404");
  });

  it("fails when the verification email never arrives", async () => {
    const result = await previewSmoke("https://p.workers.dev", { ...fast, fetchFn: fakePreview({ sendEmail: false }).fetchFn });
    expect(result.problems).toContain("no verification email reached the outbox");
  });

  it("fails on an unhealthy Worker and on a /mcp that does not challenge", async () => {
    const result = await previewSmoke("https://p.workers.dev", { ...fast, fetchFn: fakePreview({ healthy: false, mcp: 200 }).fetchFn });
    expect(result.problems).toEqual(["/api/health answered 503", "/mcp answered 200 without a token (want 401)"]);
  });

  it("uses a new visitor each run and never prints a password", async () => {
    const preview = fakePreview();
    await previewSmoke("https://p.workers.dev", { fetchFn: preview.fetchFn, sleep: async () => {} });
    await previewSmoke("https://p.workers.dev", { fetchFn: preview.fetchFn, sleep: async () => {} });
    expect(preview.users.size).toBe(2);
  });
});

describe("GhPreviewForge (a fake gh on PATH)", () => {
  it("runs gh api with the job's GH_TOKEN and the base variables only", async () => {
    const bin = await fakeGh();
    const saved = { PATH: process.env.PATH, GH_TOKEN: process.env.GH_TOKEN, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN };
    Object.assign(process.env, { PATH: bin, GH_TOKEN: "job-token", CLOUDFLARE_API_TOKEN: "cf-secret" });
    try {
      const forge = new GhPreviewForge("o/r");

      // The fake prints one JSON line, which `comments` parses as it would a comment.
      const [out] = (await forge.comments(7)) as unknown as FakeGhOutput[];
      await forge.createComment(7, "hello");

      expect(out!.args).toEqual(["api", "--paginate", "repos/o/r/issues/7/comments", "--jq", '.[] | {id, body, bot: (.user.type == "Bot")}']);
      expect(out!.env.GH_TOKEN).toBe("job-token");
      expect(out!.env.PATH).toBe(bin);
      expect(out!.env.CLOUDFLARE_API_TOKEN).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("reads a permission it cannot get as none", async () => {
    const bin = await fakeGh();
    const saved = process.env.PATH;
    process.env.PATH = bin;
    try {
      // The fake's output is not a permission name.
      expect(await new GhPreviewForge("o/r").permission("someone")).toBe("none");
    } finally {
      process.env.PATH = saved;
    }
  });
});
