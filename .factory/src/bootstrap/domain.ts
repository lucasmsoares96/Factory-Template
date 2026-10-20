import type { CloudflareClient, CloudflareDnsRecord, CloudflareZone, ResendClient, ResendDnsRecord, ResendDomain } from "./clients.ts";
import { promptMainToken } from "./common.ts";
import type { ProductIdentity, Step, StepContext } from "./steps.ts";

/** `<ID>_NAME`: the prefix every per-Product secret carries, e.g. `my-app` + `RESEND_API_KEY` = `MY_APP_RESEND_API_KEY`. */
export function productSecretName(productId: string, name: string): string {
  return `${productId.toUpperCase().replace(/-/g, "_")}_${name}`;
}

/** The Resend key of this run: memory, then the environment, then (when allowed) a prompt. Never stored. */
async function resendClient(ctx: StepContext, prompt: boolean): Promise<ResendClient | undefined> {
  let key = ctx.memory.resendKey ?? (ctx.env.RESEND_API_KEY || undefined);
  if (!key && prompt) {
    key = (await ctx.prompter.password({ id: "resend-key", message: "Paste a full-access Resend API key (not stored)" })).trim();
  }
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
  if (!token && prompt) token = await promptMainToken(ctx, { message: "Paste the Cloudflare API token (not stored)", showLink: true });
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

export function resendDomainStep(product: ProductIdentity): Step {
  return {
    id: "resend-domain",
    title: "Resend sending domain",
    async check(ctx) {
      const resend = await resendClient(ctx, false);
      if (!resend) return { done: false, detail: "export RESEND_API_KEY to look it up" };
      const found = await resend.findDomain(product.domain);
      return { done: found !== null, detail: found ? `${found.name}: ${found.status}` : undefined };
    },
    async run(ctx) {
      const resend = await resendClient(ctx, true);
      if (!resend) return;
      if ((await resend.findDomain(product.domain)) !== null) return;
      const action = await ctx.prompter.select({
        id: "resend-domain-action",
        message: `Create ${product.domain} in Resend now? Skipping keeps ${product.id} on the outbox, with no real email.`,
        options: [
          { value: "create", label: "Create it now" },
          { value: "skip", label: "Skip for now" },
        ],
      });
      if (action === "skip") {
        ctx.memory.resendDeferred = true;
        ctx.log(`Resend domain deferred: ${product.id} keeps the outbox. Run: pnpm bootstrap domain ${product.id} when the domain is ready.`);
        return;
      }
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
  const resend = await resendClient(ctx, prompt);
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
      if (state.kind === "no-resend-key") return { done: false, detail: "export RESEND_API_KEY to look it up" };
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
      const resend = (await resendClient(ctx, true))!;
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
      return { done: (await ctx.github.listSecrets()).includes(secret) };
    },
    async run(ctx) {
      const resend = await resendClient(ctx, true);
      const domain = await resend?.findDomain(product.domain);
      if (!resend || !domain) {
        ctx.log("No Resend domain yet, so no key either.");
        return;
      }
      // Secrets cannot be read back, so a redo makes a new key; the old one stays until deleted in the Resend dashboard.
      await ctx.github.setSecret(secret, await resend.createRestrictedKey({ name: product.id, domainId: domain.id }));
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

export function domainSteps(product: ProductIdentity): Step[] {
  return [resendDomainStep(product), dnsRecordsStep(product), restrictedKeyStep(product), workerDomainStep(product)];
}
