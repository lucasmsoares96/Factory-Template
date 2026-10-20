import type { CloudflareClient, CloudflareDnsRecord, CloudflareZone, ResendClient, ResendDnsRecord, ResendDomain } from "./clients.ts";
import { promptMainToken } from "./common.ts";
import type { ProductIdentity, Step, StepContext } from "./steps.ts";

/** `<ID>_NAME`: the prefix every per-Product secret carries, e.g. `my-app` + `RESEND_API_KEY` = `MY_APP_RESEND_API_KEY`. */
export function productSecretName(productId: string, name: string): string {
  return `${productId.toUpperCase().replace(/-/g, "_")}_${name}`;
}

/** The environment that holds a Product's production secrets. */
export function productionEnvironment(productId: string): string {
  return `${productId}-production`;
}

/**
 * Where a Product's production secrets live: in its `<id>-production` environment when that exists, otherwise
 * (the plan refused environments, or none was made yet) in the repo. A job with an environment also sees repo secrets,
 * so the workflow reads the same names either way.
 */
export async function secretScope(ctx: StepContext, productId: string): Promise<{ environment?: string }> {
  const name = productionEnvironment(productId);
  return (await ctx.github.listEnvironments()).includes(name) ? { environment: name } : {};
}

const RESEND_KEYS_URL = "https://resend.com/api-keys"; // checked against the Resend docs 2026-10-20

/** Resend is optional: ask before any key prompt. Returns the pasted key, or undefined (and marks Resend deferred). */
async function askForResendKey(ctx: StepContext, productId: string): Promise<string | undefined> {
  const defer = (why: string) => {
    ctx.memory.resendDeferred = true;
    ctx.log(`${why} ${productId} keeps the outbox (emails stored in the database, not sent). Run: pnpm bootstrap domain ${productId} when you want real email.`);
    return undefined;
  };
  if (!ctx.interactive) return defer("No RESEND_API_KEY and no terminal to ask: Resend deferred.");
  const choice = await ctx.prompter.select({
    id: "resend-setup",
    message: `Set up real email with Resend now? It is optional: without it, ${productId} keeps the outbox (emails are stored in the database, not sent). You can do it later with \`pnpm bootstrap domain ${productId}\`.`,
    options: [
      { value: "skip", label: "Skip for now (keep the outbox)" },
      { value: "now", label: "Set it up now" },
    ],
  });
  if (choice !== "now") return defer("Resend deferred:");
  ctx.prompter.link("Create a Resend API key here (Add API Key, permission: Full access):", RESEND_KEYS_URL);
  ctx.log("The key is used only during this run to create the domain, the DNS records and a sending-only key restricted to the domain. It is never stored.");
  const key = (await ctx.prompter.password({ id: "resend-key", message: "Paste the full-access Resend API key (not stored; leave empty to skip)" })).trim();
  return key || defer("No key given: Resend deferred.");
}

/** The Resend key of this run: memory, then the environment, then (when allowed and not deferred) the optional question. Never stored. */
async function resendClient(ctx: StepContext, prompt: boolean, productId = "this Product"): Promise<ResendClient | undefined> {
  let key = ctx.memory.resendKey ?? (ctx.env.RESEND_API_KEY || undefined);
  if (!key && prompt && !ctx.memory.resendDeferred) key = await askForResendKey(ctx, productId);
  if (!key) return undefined;
  ctx.memory.resendKey = key;
  return ctx.resend(key);
}

/** The Cloudflare client and account of this run, from memory, the environment or (when allowed) prompts. */
export async function cloudflareHandle(
  ctx: StepContext,
  prompt: boolean,
): Promise<{ client: CloudflareClient; accountId: string } | undefined> {
  let token = ctx.memory.cloudflareToken ?? (ctx.env.CLOUDFLARE_API_TOKEN || undefined);
  if (!token && prompt && !ctx.memory.cloudflareDeclined) {
    token = await promptMainToken(ctx, {
      message: "Paste the Cloudflare API token, needed for the DNS records and the Worker's domain (not stored; leave empty to skip)",
      showLink: true,
      optional: true,
    });
    if (!token) {
      ctx.memory.cloudflareDeclined = true;
      ctx.log("No Cloudflare token given: the steps that need it are skipped. Run: pnpm bootstrap domain <id> to do them later.");
    }
  }
  if (!token) return undefined;
  ctx.memory.cloudflareToken = token;
  const client = ctx.cloudflare(token);
  let accountId = ctx.memory.accountId ?? (ctx.env.CLOUDFLARE_ACCOUNT_ID || undefined);
  if (!accountId) {
    const accounts = await client.listAccounts();
    if (accounts.length === 1 || (accounts.length > 1 && !prompt)) accountId = accounts[0]?.id;
    else if (accounts.length > 1) {
      accountId = await ctx.prompter.select({
        id: "cloudflare-account",
        message: "Which Cloudflare account?",
        options: accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.id})` })),
      });
    }
  }
  if (!accountId) return undefined;
  ctx.memory.accountId = accountId;
  return { client, accountId };
}

/** The restricted key secret is only made once the Resend domain exists: its presence on the forge stands in when no Resend key is at hand. */
async function resendProvenByKeySecret(ctx: StepContext, product: ProductIdentity): Promise<boolean> {
  return (await ctx.github.listSecrets(await secretScope(ctx, product.id))).includes(productSecretName(product.id, "RESEND_API_KEY"));
}

export function resendDomainStep(product: ProductIdentity): Step {
  return {
    id: "resend-domain",
    title: "Resend sending domain",
    async check(ctx) {
      const resend = await resendClient(ctx, false, product.id);
      if (!resend) {
        if (await resendProvenByKeySecret(ctx, product)) return { done: true, detail: "not re-checked: the restricted key secret exists" };
        return { done: false, detail: "export RESEND_API_KEY to look it up" };
      }
      const found = await resend.findDomain(product.domain);
      return { done: found !== null, detail: found ? `${found.name}: ${found.status}` : undefined };
    },
    async run(ctx) {
      const resend = await resendClient(ctx, true, product.id);
      if (!resend) return;
      if ((await resend.findDomain(product.domain)) !== null) return;
      await resend.createDomain(product.domain);
    },
  };
}

/** The zone of `domain` or of its closest parent: `app.acme.dev` tries itself, then `acme.dev`. */
export async function findZoneFor(client: CloudflareClient, domain: string): Promise<CloudflareZone | null> {
  const labels = domain.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const zone = await client.findZone(labels.slice(i).join("."));
    if (zone) return zone;
  }
  return null;
}

/** Resend names are relative to the zone root (`send`, `resend._domainkey`); Cloudflare wants them fully qualified. */
function fqdn(name: string, zoneName: string): string {
  return name === "" || name === "@" ? zoneName : `${name}.${zoneName}`.toLowerCase();
}

/** A record "exists" when the zone has one of the same type and name: it is never overwritten, even if the value differs. */
function classify(records: ResendDnsRecord[], existing: CloudflareDnsRecord[], zoneName: string) {
  const missing: ResendDnsRecord[] = [];
  const different: ResendDnsRecord[] = [];
  for (const record of records) {
    const name = fqdn(record.name, zoneName);
    const found = existing.find((e) => e.type === record.type && e.name.toLowerCase() === name);
    if (!found) missing.push(record);
    else if (found.content.replace(/^"|"$/g, "") !== record.value) different.push(record);
  }
  return { missing, different };
}

export type DnsState =
  | { kind: "no-resend-key" }
  | { kind: "no-domain" }
  | { kind: "no-cloudflare"; domain: ResendDomain }
  | { kind: "no-zone"; domain: ResendDomain }
  | { kind: "ready"; domain: ResendDomain; zone: CloudflareZone; client: CloudflareClient; missing: ResendDnsRecord[]; different: ResendDnsRecord[] };

/** Read-only picture of the Resend domain against the zone; shared by the step and the doctor. */
export async function readDnsState(ctx: StepContext, product: ProductIdentity, prompt: boolean): Promise<DnsState> {
  const resend = await resendClient(ctx, prompt, product.id);
  if (!resend) return { kind: "no-resend-key" };
  const domain = await resend.findDomain(product.domain);
  if (!domain) return { kind: "no-domain" };
  const cloudflare = await cloudflareHandle(ctx, prompt);
  if (!cloudflare) return { kind: "no-cloudflare", domain };
  const zone = await findZoneFor(cloudflare.client, product.domain);
  if (!zone) return { kind: "no-zone", domain };
  const { missing, different } = classify(domain.records, await cloudflare.client.listDnsRecords(zone.id), zone.name);
  return { kind: "ready", domain, zone, client: cloudflare.client, missing, different };
}

const POLLS = 6;
const POLL_MS = 10_000;

function describe(record: ResendDnsRecord): string {
  return [record.type, record.name || "@", record.value, ...(record.priority === undefined ? [] : [`priority ${record.priority}`])].join("  ");
}

export function dnsRecordsStep(product: ProductIdentity): Step {
  const redo = `pnpm bootstrap domain ${product.id} --redo dns-records`;
  return {
    id: "dns-records",
    title: "DNS records in Cloudflare",
    async check(ctx) {
      if (ctx.memory.resendDeferred) return { done: true, detail: "Resend domain deferred" };
      const state = await readDnsState(ctx, product, false);
      if (state.kind === "no-resend-key") {
        if (await resendProvenByKeySecret(ctx, product)) return { done: true, detail: "not re-checked: the restricted key secret exists" };
        return { done: false, detail: "export RESEND_API_KEY to look it up" };
      }
      if (state.kind === "no-domain") return { done: false, detail: "no Resend domain yet" };
      if (state.kind === "no-cloudflare") return { done: false, detail: "export CLOUDFLARE_API_TOKEN to look it up" };
      if (state.kind === "no-zone") return { done: false, detail: "zone not in this Cloudflare account" };
      return { done: state.missing.length === 0 && state.domain.status === "verified", detail: `Resend: ${state.domain.status}` };
    },
    async run(ctx) {
      const state = await readDnsState(ctx, product, true);
      if (state.kind === "no-resend-key" || state.kind === "no-domain") {
        ctx.log(`No Resend domain to publish (deferred). Run: pnpm bootstrap domain ${product.id} once it exists.`);
        return;
      }
      if (state.kind === "no-cloudflare") return;
      if (state.kind === "no-zone") {
        // Plain log lines, not clack notes: a note wraps long values (the DKIM key) and breaks copy and paste.
        ctx.log(`Zone for ${product.domain} is not in this Cloudflare account. Create these records where its DNS lives, then run: ${redo}`);
        for (const record of state.domain.records) ctx.log(describe(record));
        return;
      }
      for (const record of state.different) ctx.log(`${record.type} ${record.name} already exists with another value: left alone`);
      for (const record of state.missing) {
        await state.client.createDnsRecord(state.zone.id, {
          type: record.type,
          name: fqdn(record.name, state.zone.name),
          content: record.value,
          ...(record.priority === undefined ? {} : { priority: record.priority }),
          proxied: false,
        });
        ctx.log(`  created ${record.type} ${fqdn(record.name, state.zone.name)}`);
      }
      const resend = (await resendClient(ctx, true, product.id))!;
      await resend.verifyDomain(state.domain.id);
      for (let attempt = 1; attempt <= POLLS; attempt++) {
        const status = (await resend.findDomain(product.domain))?.status ?? "unknown";
        ctx.log(`Resend verification: ${status} (${attempt}/${POLLS})`);
        if (status === "verified" || status === "failed") return;
        if (attempt < POLLS) await ctx.sleep(POLL_MS);
      }
      ctx.log(`Not verified yet: DNS can take a while to propagate. Run: ${redo} (later), or: pnpm bootstrap doctor ${product.id}`);
    },
  };
}

export function restrictedKeyStep(product: ProductIdentity): Step {
  const secret = productSecretName(product.id, "RESEND_API_KEY");
  return {
    id: "restricted-resend-key",
    title: `Resend key restricted to the domain (${secret})`,
    async check(ctx) {
      if (ctx.memory.resendDeferred) return { done: true, detail: "Resend domain deferred" };
      return { done: (await ctx.github.listSecrets(await secretScope(ctx, product.id))).includes(secret) };
    },
    async run(ctx) {
      const resend = await resendClient(ctx, true, product.id);
      const domain = await resend?.findDomain(product.domain);
      if (!resend || !domain) {
        ctx.log("No Resend domain yet, so no key either.");
        return;
      }
      // Secrets cannot be read back, so a redo makes a new key; the old one stays until deleted in the Resend dashboard.
      await ctx.github.setSecret(secret, await resend.createRestrictedKey({ name: product.id, domainId: domain.id }), await secretScope(ctx, product.id));
    },
  };
}

export type WorkerDomainState =
  | { kind: "no-cloudflare" }
  | { kind: "no-worker" }
  | { kind: "no-zone" }
  | { kind: "attached" | "detached"; client: CloudflareClient; accountId: string; zone: CloudflareZone };

/** Read-only; shared by the step and the doctor. The Custom Domain's hostname is the Product's `domain`. */
export async function readWorkerDomainState(ctx: StepContext, product: ProductIdentity, prompt: boolean): Promise<WorkerDomainState> {
  const cloudflare = await cloudflareHandle(ctx, prompt);
  if (!cloudflare) return { kind: "no-cloudflare" };
  const { client, accountId } = cloudflare;
  if (!(await client.workerExists(accountId, product.id))) return { kind: "no-worker" };
  const zone = await findZoneFor(client, product.domain);
  if (!zone) return { kind: "no-zone" };
  const attached = (await client.listWorkerDomains(accountId, product.id)).some((d) => d.hostname === product.domain);
  return { kind: attached ? "attached" : "detached", client, accountId, zone };
}

export function deployFirstMessage(productId: string): string {
  return `The Worker ${productId} does not exist yet: deploy the Product first, then run \`pnpm bootstrap domain ${productId} --redo worker-domain\`.`;
}

/**
 * Workers Custom Domains by API (`PUT /accounts/{id}/workers/domains`, docs "Attaching a Custom Domain to a Worker",
 * updated 2026-09-29), not by `routes` with `custom_domain: true` in wrangler.jsonc: that file belongs to the Product and
 * is regenerated with the id at deploy, and the API works right after the first deploy without another one.
 */
export function workerDomainStep(product: ProductIdentity): Step {
  return {
    id: "worker-domain",
    title: "Worker Custom Domain",
    async check(ctx) {
      const state = await readWorkerDomainState(ctx, product, false);
      if (state.kind === "no-cloudflare") return { done: false, detail: "export CLOUDFLARE_API_TOKEN to look it up" };
      if (state.kind === "no-worker") return { done: false, detail: "Worker not deployed yet" };
      if (state.kind === "no-zone") return { done: false, detail: "zone not in this Cloudflare account" };
      return { done: state.kind === "attached", detail: product.domain };
    },
    async run(ctx) {
      const state = await readWorkerDomainState(ctx, product, true);
      if (state.kind === "no-cloudflare") return;
      if (state.kind === "no-worker") return ctx.log(deployFirstMessage(product.id));
      if (state.kind === "no-zone") return ctx.log(`The zone of ${product.domain} is not in this Cloudflare account: attach the domain to the Worker by hand in the dashboard.`);
      if (state.kind === "attached") return;
      await state.client.attachWorkerDomain(state.accountId, { hostname: product.domain, service: product.id, zoneId: state.zone.id, zoneName: state.zone.name });
    },
  };
}

/** The Resend chain; `bootstrap product` runs only this part (the Worker does not exist before the first deploy). */
export function resendSteps(product: ProductIdentity): Step[] {
  return [resendDomainStep(product), dnsRecordsStep(product), restrictedKeyStep(product)];
}

export function domainSteps(product: ProductIdentity): Step[] {
  return [...resendSteps(product), workerDomainStep(product)];
}
