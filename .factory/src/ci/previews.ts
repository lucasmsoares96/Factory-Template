// The logic behind the PR previews, one subcommand per step so the YAML stays thin. Everything here runs from `main`'s
// checkout (the `preview-plan`, `deploy`, `smoke`, `comment` jobs of `factory-pr.yml` and the cleanup workflow):
// the pull request's code only ever reaches it as an allowlisted artifact.
//   gate      which Products get a preview (affected ∩ PREVIEW_PRODUCTS) and whether the author or the label allows it
//   bindings  the PR's Worker bindings against the ones of `main`: different means "preview skipped"
//   database  the Neon branch `preview/pr-N` from `base` (or "limit reached") and the Worker's secrets file
//   config    the Worker config of the preview: the PR's built config plus the `previews` block
//   url       the preview URL from wrangler's output file
//   result    one JSON file about a Product's preview (`result.json`), for the smoke and the comment
//   status    (smoke job) reads `result.json`: is there a preview to test, and its URL
//   smoke-result  the smoke's verdict as `smoke.json`
//   cleanup-plan  (PR closed) every Product in PREVIEW_PRODUCTS
//   comment   the one PR comment listing every Product's preview (edited, never duplicated)
//   base      (deploy of `main`) `base` exists, recreated when missing, and is migrated
//   cleanup   (PR closed) the Neon branch of the PR is deleted
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import { productSecretName } from "../bootstrap/domain.ts";
import { builtConfigs, deployConfig, parseList, type DeployEntry } from "./deploy.ts";
import type { MatrixEntry } from "./matrix.ts";
import { BASE_BRANCH, NeonApi, previewBranchName, type PreviewBranches } from "./neon-api.ts";

const PRODUCT_ID = /^[a-z][a-z0-9-]*$/;

/** The Products that get a preview: affected Products (the matrix of `plan`) that are listed in PREVIEW_PRODUCTS. */
export function planPreviews(input: { matrix: MatrixEntry[]; previewProducts: string }): { include: DeployEntry[] } {
  const affected = new Set(input.matrix.filter((e) => e.kind === "product").map((e) => e.name));
  const include = parseList(input.previewProducts)
    .filter((id) => PRODUCT_ID.test(id) && affected.has(id))
    .sort()
    .map((id) => ({ id, prefix: productSecretName(id, "") }));
  return { include };
}

export type Permission = "admin" | "maintain" | "write" | "triage" | "read" | "none";
const CAN_WRITE: Permission[] = ["admin", "maintain", "write"];

/**
 * Whether the preview may run for this event. An author with `write` or more gets it on every event. Anyone else gets it
 * only on the event of the label itself, put by someone with `write` or more: a push removes the label, so the next push
 * has to be approved again. The payload's list of labels is never read, only the event's own `label`.
 */
export function previewTrust(input: { action: string; label: string; previewLabel: string; authorPermission: Permission; senderPermission: Permission }): { allowed: boolean; why: string } {
  if (CAN_WRITE.includes(input.authorPermission)) return { allowed: true, why: "the author has write access" };
  if (input.action === "labeled" && input.label === input.previewLabel && CAN_WRITE.includes(input.senderPermission)) {
    return { allowed: true, why: `${input.previewLabel} label put by someone with write access` };
  }
  return { allowed: false, why: `the author has no write access: someone with write access must add the \`${input.previewLabel}\` label` };
}

/** Line and block comments and trailing commas out of a JSONC document, leaving strings alone. */
export function parseJsonc(text: string): Record<string, unknown> {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i === -1) throw new Error("Unterminated comment in the config.");
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as Record<string, unknown>;
}

type Config = Record<string, unknown>;
const list = (value: unknown): Config[] => (Array.isArray(value) ? (value as Config[]) : []);
const object = (value: unknown): Config => (value && typeof value === "object" && !Array.isArray(value) ? (value as Config) : {});
const isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || (Array.isArray(value) ? value.length === 0 : typeof value === "object" && Object.keys(value).length === 0);

/** The Worker's bindings, as `kind:name` lines: what the preview must not change (ids and values do not count). */
export function bindingSignature(config: Config): string[] {
  const out: string[] = [];
  for (const [kind, key] of [["kv", "kv_namespaces"], ["d1", "d1_databases"], ["r2", "r2_buckets"], ["service", "services"], ["hyperdrive", "hyperdrive"], ["vectorize", "vectorize"], ["workflow", "workflows"], ["analytics", "analytics_engine_datasets"], ["send_email", "send_email"], ["mtls", "mtls_certificates"], ["ratelimit", "ratelimits"]] as const) {
    for (const entry of list(config[key])) out.push(`${kind}:${String(entry.binding ?? entry.name)}`);
  }
  for (const entry of list(object(config.durable_objects).bindings)) out.push(`do:${String(entry.name)}=${String(entry.class_name)}`);
  for (const entry of list(object(config.queues).producers)) out.push(`queue:${String(entry.binding)}`);
  for (const key of ["ai", "browser", "images", "version_metadata", "unsafe", "containers", "dispatch_namespaces", "pipelines", "secrets_store_secrets", "worker_loaders", "vpc_services"]) {
    // The Cloudflare Vite plugin writes some of these as empty lists or objects in every build: empty is no binding.
    if (!isEmpty(config[key])) out.push(`${key}:${JSON.stringify(config[key])}`);
  }
  return out.sort();
}

/** Whether the PR's built config has other bindings than the Product of `main` (the source `wrangler.jsonc`). */
export function bindingsChanged(prBuilt: Config, mainSource: Config | undefined): boolean {
  if (!mainSource) return true;
  return JSON.stringify(bindingSignature(prBuilt)) !== JSON.stringify(bindingSignature(mainSource));
}

const SUPPORTED = (signature: string) => signature === "kv:OAUTH_KV" || signature.startsWith("do:");

/**
 * The preview's Worker config: the built one (name set to the id, no `secrets` or `dev`) with the `previews` block that
 * Worker Previews require, since previews inherit nothing: the outbox transport and the preview flag, the preview KV for
 * `OAUTH_KV` and the Durable Object bindings. Only those bindings are supported (the preview has no other resource).
 */
export function previewConfig(built: Config, input: { id: string; kvId: string }): Config {
  const unsupported = bindingSignature(built).filter((s) => !SUPPORTED(s));
  if (unsupported.length > 0) throw new Error(`The preview supports OAUTH_KV and Durable Object bindings only; found: ${unsupported.join(", ")}`);
  const kv = [{ binding: "OAUTH_KV", id: input.kvId }];
  const durable = built.durable_objects ? { durable_objects: built.durable_objects } : {};
  return {
    ...deployConfig(built, input.id),
    // The top level mirrors the preview resource, so nothing is provisioned in the account for a preview.
    kv_namespaces: kv,
    previews: { vars: { ...object(built.vars), EMAIL_TRANSPORT: "outbox", PREVIEW_OUTBOX: "true" }, kv_namespaces: kv, ...durable },
  };
}

/** The preview URL of `wrangler preview`'s output file (ND-JSON, `WRANGLER_OUTPUT_FILE_PATH`, entry `type: "preview"`). */
export function previewUrl(ndjson: string): string | undefined {
  for (const line of ndjson.split("\n").filter(Boolean).reverse()) {
    const entry = JSON.parse(line) as { type?: string; preview_urls?: string[] };
    if (entry.type === "preview" && entry.preview_urls?.[0]) return entry.preview_urls[0];
  }
  return undefined;
}

export type DatabaseResult =
  | { status: "ready"; directUrl: string; pooledUrl: string; created: boolean }
  | { status: "skipped"; reason: "limit-reached" };

/**
 * The Neon branch of the PR. A push to a PR that already has one reuses it (the migrations apply on top); a new one is
 * made from `base`, unless `limit` previews of the Product are already open. A branch of Neon's free plan is a hard
 * limit, so `limit` is 9 (`base` + 9 = 10).
 */
export async function prepareDatabase(input: { db: PreviewBranches; pr: number; limit: number }): Promise<DatabaseResult> {
  const { db, pr, limit } = input;
  const { branch: base } = await db.ensureBase();
  let branch = await db.findBranch(previewBranchName(pr));
  const created = branch === undefined;
  if (!branch) {
    if ((await db.listPreviewBranches()).length >= limit) return { status: "skipped", reason: "limit-reached" };
    branch = await db.createBranch(previewBranchName(pr), base.id);
  }
  return { status: "ready", created, directUrl: await db.connectionUri(branch.id, { pooled: false }), pooledUrl: await db.connectionUri(branch.id, { pooled: true }) };
}

/** Deletes the PR's branch when there is one. Returns whether it existed. */
export async function removeDatabase(input: { db: PreviewBranches; pr: number }): Promise<boolean> {
  const branch = await input.db.findBranch(previewBranchName(input.pr));
  if (!branch) return false;
  await input.db.deleteBranch(branch.id);
  return true;
}

export type PreviewStatus = "deployed" | "bindings-changed" | "limit-reached" | "failed";
export interface PreviewResult {
  id: string;
  status: PreviewStatus;
  url?: string;
  /** The smoke of the deployed preview; absent when it was not run. */
  smoke?: "passed" | "failed";
}

const resultSchema = z.object({
  id: z.string().regex(PRODUCT_ID),
  status: z.enum(["deployed", "bindings-changed", "limit-reached", "failed"]),
  url: z.string().optional(),
});
const smokeSchema = z.object({ id: z.string().regex(PRODUCT_ID), smoke: z.enum(["passed", "failed"]) });

/** `result.json` and `smoke.json` files (name and text), merged by Product. A file that does not fit its schema is ignored. */
export function mergeResults(files: { name: string; text: string }[]): PreviewResult[] {
  const results = new Map<string, PreviewResult>();
  const smokes = new Map<string, "passed" | "failed">();
  for (const { name, text } of files) {
    try {
      const json: unknown = JSON.parse(text);
      if (name === "result.json") {
        const parsed = resultSchema.safeParse(json);
        if (parsed.success) results.set(parsed.data.id, parsed.data);
      } else if (name === "smoke.json") {
        const parsed = smokeSchema.safeParse(json);
        if (parsed.success) smokes.set(parsed.data.id, parsed.data.smoke);
      }
    } catch {
      // Not JSON: ignored like any file that does not fit.
    }
  }
  return [...results.values()].map((r) => (smokes.has(r.id) ? { ...r, smoke: smokes.get(r.id)! } : r));
}

/** The URL of a deployed preview as the smoke may use it: only a workers.dev address. */
export function deployedPreview(text: string): string | undefined {
  const parsed = resultSchema.safeParse(JSON.parse(text));
  return parsed.success && parsed.data.status === "deployed" && parsed.data.url && PREVIEW_HOST.test(parsed.data.url) ? parsed.data.url : undefined;
}

/** Every Product listed in PREVIEW_PRODUCTS (a closed PR may have had a preview in any of them). */
export function planCleanup(previewProducts: string): { include: DeployEntry[] } {
  return { include: parseList(previewProducts).filter((id) => PRODUCT_ID.test(id)).sort().map((id) => ({ id, prefix: productSecretName(id, "") })) };
}

export const COMMENT_MARKER = "<!-- factory-previews -->";
/** Previews live on workers.dev; anything else in a result file is not put in a comment. */
const PREVIEW_HOST = /^https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev(\/\S*)?$/;

/** The text of the one comment. `trusted: false` explains how to get a preview; results fill the table otherwise. */
export function renderComment(input: { trusted: boolean; why: string; products: string[]; results: PreviewResult[]; sha?: string }): string {
  const lines = [COMMENT_MARKER, "### Previews", ""];
  if (!input.trusted) {
    lines.push(`Preview not deployed: ${input.why}.`);
  } else {
    lines.push("| Product | Preview |", "| --- | --- |");
    for (const id of input.products) {
      const result = input.results.find((r) => r.id === id);
      let cell: string;
      if (!result) cell = "preview not deployed (the build or the deploy did not finish; see the run)";
      else if (result.status === "limit-reached") cell = "preview skipped: limit reached";
      else if (result.status === "bindings-changed") cell = "preview skipped: the Worker bindings changed (a preview runs with the bindings of the default branch; merge that change first)";
      else if (result.status === "failed") cell = "preview failed (see the run)";
      else if (!result.url || !PREVIEW_HOST.test(result.url)) cell = "preview deployed, but its URL is not a workers.dev address";
      else cell = `${result.url} (smoke ${result.smoke ?? "not run"})`;
      lines.push(`| \`${id}\` | ${cell} |`);
    }
  }
  if (input.sha) lines.push("", `Commit ${input.sha.slice(0, 7)}. The preview and its database are deleted when the PR closes.`);
  return lines.join("\n");
}

/** The only door to the forge for the previews: permissions and the PR's comments. `gh` is called from `GhPreviewForge`. */
export interface PreviewForge {
  permission(login: string): Promise<Permission>;
  comments(pr: number): Promise<{ id: number; body: string; bot: boolean }[]>;
  createComment(pr: number, body: string): Promise<void>;
  updateComment(id: number, body: string): Promise<void>;
}

/** Edits the comment the workflow wrote before (marker and bot author) or creates it: one comment per PR. */
export async function upsertComment(forge: PreviewForge, pr: number, body: string): Promise<"created" | "updated"> {
  const mine = (await forge.comments(pr)).find((c) => c.bot && c.body.includes(COMMENT_MARKER));
  if (mine) {
    if (mine.body !== body) await forge.updateComment(mine.id, body);
    return "updated";
  }
  await forge.createComment(pr, body);
  return "created";
}

export class GhPreviewForge implements PreviewForge {
  private readonly repo: string;
  constructor(repo: string) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("REPO is not owner/name.");
    this.repo = repo;
  }
  private gh(args: string[], input?: string): string {
    return execFileSync("gh", ["api", ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "inherit"] });
  }
  async permission(login: string): Promise<Permission> {
    try {
      const value = this.gh([`repos/${this.repo}/collaborators/${encodeURIComponent(login)}/permission`, "--jq", ".permission"]).trim();
      return (["admin", "maintain", "write", "triage", "read"] as const).find((p) => p === value) ?? "none";
    } catch {
      return "none";
    }
  }
  async comments(pr: number) {
    const raw = this.gh(["--paginate", `repos/${this.repo}/issues/${pr}/comments`, "--jq", '.[] | {id, body, bot: (.user.type == "Bot")}']);
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as { id: number; body: string; bot: boolean });
  }
  async createComment(pr: number, body: string): Promise<void> {
    this.gh([`repos/${this.repo}/issues/${pr}/comments`, "--method", "POST", "--input", "-"], JSON.stringify({ body }));
  }
  async updateComment(id: number, body: string): Promise<void> {
    this.gh([`repos/${this.repo}/issues/comments/${id}`, "--method", "PATCH", "--input", "-"], JSON.stringify({ body }));
  }
}

function output(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

const INTEGER = /^[1-9]\d{0,8}$/;

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { product: { type: "string" }, pr: { type: "string" }, dir: { type: "string" }, out: { type: "string" }, file: { type: "string" }, status: { type: "string" }, "kv-id": { type: "string" }, results: { type: "string" } },
  });
  const [command] = positionals;
  const need = (value: string | undefined, name: string) => {
    if (!value) throw new Error(`Missing --${name}`);
    return value;
  };
  const productId = () => {
    const id = need(values.product, "product");
    if (!PRODUCT_ID.test(id)) throw new Error(`"${id}" is not a Product id.`);
    return id;
  };
  // The PR number comes from the event (env), never from an artifact.
  const prNumber = () => {
    const pr = process.env.PR_NUMBER ?? values.pr ?? "";
    if (!INTEGER.test(pr)) throw new Error("PR_NUMBER is not a pull request number.");
    return Number(pr);
  };
  const neon = () => {
    const { NEON_API_KEY: apiKey, NEON_PROJECT_ID: projectId } = process.env;
    if (!apiKey || !projectId) throw new Error("The preview has no Neon key or project: run `pnpm bootstrap previews <id>`.");
    return new NeonApi({ apiKey, projectId });
  };
  const config = loadConfig(process.env);

  if (command === "gate") {
    const forge = new GhPreviewForge(need(process.env.REPO, "REPO"));
    const matrix = JSON.parse(process.env.MATRIX ?? '{"include":[]}') as { include: MatrixEntry[] };
    const plan = planPreviews({ matrix: matrix.include, previewProducts: process.env.PREVIEW_PRODUCTS ?? "" });
    const trust = previewTrust({
      action: process.env.ACTION ?? "",
      label: process.env.LABEL_NAME ?? "",
      previewLabel: config.labels.preview,
      authorPermission: await forge.permission(need(process.env.AUTHOR, "AUTHOR")),
      senderPermission: await forge.permission(need(process.env.SENDER, "SENDER")),
    });
    console.log(JSON.stringify({ ...plan, trusted: trust.allowed, why: trust.why }));
    output("matrix", JSON.stringify(plan));
    output("empty", String(plan.include.length === 0));
    output("trusted", String(trust.allowed));
    output("why", trust.why);
  } else if (command === "bindings") {
    const id = productId();
    const [configFile] = builtConfigs(resolve(need(values.dir, "dir")));
    if (!configFile) throw new Error("No worker/<name>/wrangler.json in the artifact.");
    const source = join("apps", id, "wrangler.jsonc");
    const changed = bindingsChanged(JSON.parse(readFileSync(configFile, "utf8")) as Config, existsSync(source) ? parseJsonc(readFileSync(source, "utf8")) : undefined);
    console.log(changed ? "bindings changed" : "bindings unchanged");
    output("changed", String(changed));
  } else if (command === "database") {
    const out = resolve(need(values.out, "out"));
    const result = await prepareDatabase({ db: neon(), pr: prNumber(), limit: config.previewLimit });
    output("skipped", result.status === "skipped" ? result.reason : "");
    if (result.status === "skipped") console.log("preview skipped: limit reached");
    else {
      mkdirSync(out, { recursive: true });
      // Files, not step outputs: nothing secret goes through the Actions log or its output store.
      writeFileSync(join(out, "direct-url"), result.directUrl, { mode: 0o600 });
      writeFileSync(join(out, "worker-env.json"), JSON.stringify({ DATABASE_URL: result.pooledUrl, BETTER_AUTH_SECRET: randomBytes(32).toString("base64url") }), { mode: 0o600 });
      console.log(`Neon branch ${previewBranchName(prNumber())} ${result.created ? "created from base" : "reused"}`);
    }
  } else if (command === "config") {
    const [configFile] = builtConfigs(resolve(need(values.dir, "dir")));
    if (!configFile) throw new Error("No worker/<name>/wrangler.json in the artifact.");
    const built = JSON.parse(readFileSync(configFile, "utf8")) as Config;
    const path = join(resolve(configFile, ".."), "wrangler.preview.json");
    writeFileSync(path, JSON.stringify(previewConfig(built, { id: productId(), kvId: need(values["kv-id"], "kv-id") }), null, 2));
    output("path", path);
    console.log(path);
  } else if (command === "url") {
    const url = previewUrl(readFileSync(resolve(need(values.file, "file")), "utf8"));
    if (!url) throw new Error("wrangler reported no preview URL.");
    console.log(url);
  } else if (command === "result") {
    const id = productId();
    const status = need(values.status, "status") as PreviewStatus;
    if (!["deployed", "bindings-changed", "limit-reached", "failed"].includes(status)) throw new Error(`Unknown status ${status}`);
    const url = status === "deployed" && values.file && existsSync(values.file) ? readFileSync(values.file, "utf8").trim() : undefined;
    const result: PreviewResult = { id, status, ...(url ? { url } : {}) };
    writeFileSync(resolve(need(values.out, "out")), JSON.stringify(result));
  } else if (command === "status") {
    const url = deployedPreview(readFileSync(resolve(need(values.file, "file")), "utf8"));
    output("deployed", String(url !== undefined));
    if (url) output("url", url);
    console.log(url ? `preview at ${url}` : "no deployed preview to test");
  } else if (command === "smoke-result") {
    const smoke = process.env.SMOKE;
    if (smoke !== "passed" && smoke !== "failed") throw new Error("SMOKE must be passed or failed.");
    writeFileSync(resolve(need(values.out, "out")), JSON.stringify({ id: productId(), smoke }));
  } else if (command === "cleanup-plan") {
    const plan = planCleanup(process.env.PREVIEW_PRODUCTS ?? "");
    console.log(JSON.stringify(plan));
    output("matrix", JSON.stringify(plan));
    output("empty", String(plan.include.length === 0));
  } else if (command === "comment") {
    const forge = new GhPreviewForge(need(process.env.REPO, "REPO"));
    const dir = resolve(need(values.results, "results"));
    const results = mergeResults(
      existsSync(dir)
        ? readdirSync(dir, { recursive: true, encoding: "utf8" })
            .filter((f) => f.endsWith(".json"))
            .map((f) => ({ name: f.split("/").pop()!, text: readFileSync(join(dir, f), "utf8") }))
        : [],
    );
    const plan = JSON.parse(process.env.MATRIX ?? '{"include":[]}') as { include: DeployEntry[] };
    const body = renderComment({ trusted: process.env.TRUSTED === "true", why: process.env.WHY ?? "", products: plan.include.map((e) => e.id), results, sha: process.env.SHA });
    console.log(`comment ${await upsertComment(forge, prNumber(), body)}`);
  } else if (command === "base") {
    // The deploy of `main`: the preview project's `base` exists and carries the current schema, so previews start from it.
    const { migrateDatabase } = await import("../../../packages/skeleton/src/node/migrate.ts");
    const db = neon();
    const { branch, recreated } = await db.ensureBase();
    const folder = resolve(need(values.dir, "dir"), "migrations/product");
    await migrateDatabase({ databaseUrl: await db.connectionUri(branch.id, { pooled: false }), productMigrationsFolder: folder });
    console.log(`${BASE_BRANCH} ${recreated ? "recreated and " : ""}migrated`);
  } else if (command === "cleanup") {
    console.log((await removeDatabase({ db: neon(), pr: prNumber() })) ? `deleted ${previewBranchName(prNumber())}` : `no Neon branch for pr-${prNumber()}`);
  } else {
    throw new Error("Usage: previews.ts <gate|bindings|database|config|url|result|status|smoke-result|comment|base|cleanup|cleanup-plan>");
  }
}
