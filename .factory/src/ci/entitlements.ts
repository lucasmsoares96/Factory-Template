// The Entitlement warning of the `main` deploy (`factory-deploy.yml`), one subcommand per job step:
//   check   (deploy job, holds the production Stripe key) the Entitlements the Product declares that no production plan sets -> a result file
//   notice  (notice job, job token, no secret) one comment on the merged PR per Product with such Entitlements; nothing when there are none
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { childEnv, runGh } from "../adapters/github/gh.ts";
import { loadConfig } from "../config.ts";
import { pick } from "../env.ts";
import { declaredEntitlements, missingEntitlements } from "../bootstrap/entitlements.ts";
import type { StripeClient } from "../bootstrap/clients.ts";
import { StripeApi } from "../bootstrap/stripe.ts";
import { FACTORY_MARKER } from "../marker.ts";
import { messages, type Language } from "../messages.ts";

const PRODUCT_ID = /^[a-z][a-z0-9-]*$/;
/** A name goes into a Markdown comment: only what a code identifier or a slug may hold. */
const NAME = /^[\w.-]{1,64}$/;

export interface EntitlementResult {
  product: string;
  /** Declared in the code, in no production plan. */
  missing: string[];
}

/** The declared Entitlements that no plan of the production account sets. Empty when the Product declares none. */
export async function findUnplaced(stripe: Pick<StripeClient, "listPlans">, productId: string, declared: readonly string[]): Promise<EntitlementResult> {
  if (declared.length === 0) return { product: productId, missing: [] };
  return { product: productId, missing: missingEntitlements(declared, await stripe.listPlans(productId)) };
}

/** The hidden marker that finds this Product's comment again, so a rerun of the deploy edits it instead of adding one. */
export const noticeMarker = (productId: string) => `<!-- factory-entitlements:${productId} -->`;

export function renderNotice(language: Language, result: EntitlementResult): string {
  return `${messages(language).entitlementsMissing(result.product, result.missing)}\n\n${noticeMarker(result.product)}\n${FACTORY_MARKER}`;
}

/** The only door to the forge for the notice. */
export interface NoticeForge {
  /** The merged pull requests that contain the commit. */
  mergedPulls(sha: string): Promise<number[]>;
  comments(pr: number): Promise<{ id: number; body: string }[]>;
  createComment(pr: number, body: string): Promise<void>;
  updateComment(id: number, body: string): Promise<void>;
}

/** One comment per Product with Entitlements in no plan, on each merged PR of the commit; none for a Product with none. Returns what it wrote. */
export async function postNotices(forge: NoticeForge, input: { sha: string; language: Language; results: EntitlementResult[] }): Promise<string[]> {
  const due = input.results.filter((result) => PRODUCT_ID.test(result.product) && result.missing.some((name) => NAME.test(name)));
  if (due.length === 0) return [];
  const written: string[] = [];
  for (const pr of await forge.mergedPulls(input.sha)) {
    const existing = await forge.comments(pr);
    for (const result of due) {
      const body = renderNotice(input.language, { product: result.product, missing: result.missing.filter((name) => NAME.test(name)) });
      const mine = existing.find((comment) => comment.body.includes(noticeMarker(result.product)));
      if (!mine) await forge.createComment(pr, body);
      else if (mine.body !== body) await forge.updateComment(mine.id, body);
      written.push(`#${pr} ${result.product}`);
    }
  }
  return written;
}

export class GhNoticeForge implements NoticeForge {
  private readonly repo: string;
  constructor(repo: string) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("REPO is not owner/name.");
    this.repo = repo;
  }
  private gh(args: string[], input?: string): Promise<string> {
    return runGh(["api", ...args], { env: childEnv(process.env, pick(process.env, ["GH_TOKEN", "GH_HOST"])), input });
  }
  async mergedPulls(sha: string): Promise<number[]> {
    const raw = await this.gh([`repos/${this.repo}/commits/${sha}/pulls`, "--jq", ".[] | select(.merged_at != null) | .number"]);
    return raw.split("\n").filter(Boolean).map(Number);
  }
  async comments(pr: number) {
    const raw = await this.gh(["--paginate", `repos/${this.repo}/issues/${pr}/comments`, "--jq", '.[] | select(.user.type == "Bot") | {id, body}']);
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as { id: number; body: string });
  }
  async createComment(pr: number, body: string): Promise<void> {
    await this.gh([`repos/${this.repo}/issues/${pr}/comments`, "--method", "POST", "--input", "-"], JSON.stringify({ body }));
  }
  async updateComment(id: number, body: string): Promise<void> {
    await this.gh([`repos/${this.repo}/issues/comments/${id}`, "--method", "PATCH", "--input", "-"], JSON.stringify({ body }));
  }
}

/** The result files `check` left, one per Product, anywhere under `dir` (download-artifact makes a folder each). */
export function readResults(dir: string): EntitlementResult[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith("entitlements.json"))
    .flatMap((file) => {
      try {
        const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as Partial<EntitlementResult>;
        return typeof parsed.product === "string" && Array.isArray(parsed.missing) ? [{ product: parsed.product, missing: parsed.missing.filter((name): name is string => typeof name === "string") }] : [];
      } catch {
        return [];
      }
    });
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { product: { type: "string" }, out: { type: "string" }, results: { type: "string" } } });
  const [command] = positionals;
  const need = (value: string | undefined, name: string) => {
    if (!value) throw new Error(`Missing --${name}`);
    return value;
  };
  if (command === "check") {
    const id = need(values.product, "product");
    if (!PRODUCT_ID.test(id)) throw new Error(`"${id}" is not a Product id.`);
    const declared = declaredEntitlements(process.cwd(), id);
    const key = process.env.STRIPE_KEY;
    if (!key || declared.length === 0) {
      console.log(!key ? `${id}: no Stripe key, billing is not set up` : `${id}: no Entitlement declared`);
    } else {
      const result = await findUnplaced(new StripeApi(key), id, declared);
      const out = resolve(need(values.out, "out"));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(result));
      console.log(result.missing.length > 0 ? `${id}: in no plan: ${result.missing.join(", ")}` : `${id}: every Entitlement is in a plan`);
    }
  } else if (command === "notice") {
    const forge = new GhNoticeForge(need(process.env.REPO, "REPO"));
    const written = await postNotices(forge, { sha: need(process.env.SHA, "SHA"), language: loadConfig(process.env).language, results: readResults(resolve(need(values.results, "results"))) });
    console.log(written.length > 0 ? `commented ${written.join(", ")}` : "no Entitlement without a plan");
  } else {
    throw new Error("Usage: entitlements.ts <check|notice>");
  }
}
