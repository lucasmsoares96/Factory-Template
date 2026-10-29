import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeStripe } from "../src/bootstrap/fake/fakes.ts";
import { declaredEntitlements, parseEntitlements } from "../src/bootstrap/entitlements.ts";
import { findUnplaced, noticeMarker, postNotices, readResults, type EntitlementResult, type NoticeForge } from "../src/ci/entitlements.ts";

const KEY = "rk_live_real1";

/** A production account with plans `free` and `pro`; `pro` sets the Entitlements in `granted`. */
async function production(granted: Record<string, boolean | number>) {
  const stripe = new FakeStripe();
  stripe.keys.add(KEY);
  const client = stripe.forKey(KEY);
  for (const key of ["free", "pro"]) {
    await client.ensurePlan("example", { key, name: key, kind: key === "free" ? "free" : "fixed", seats: 1, trialDays: 0, currency: "usd", prices: [] });
  }
  await client.ensureEntitlements("example", "pro", granted);
  return client;
}

class FakeForge implements NoticeForge {
  readonly comments_: Record<number, { id: number; body: string }[]> = {};
  pulls: number[] = [];
  private next = 0;
  async mergedPulls() {
    return this.pulls;
  }
  async comments(pr: number) {
    return this.comments_[pr] ?? [];
  }
  async createComment(pr: number, body: string) {
    (this.comments_[pr] ??= []).push({ id: ++this.next, body });
  }
  async updateComment(id: number, body: string) {
    for (const list of Object.values(this.comments_)) for (const comment of list) if (comment.id === id) comment.body = body;
  }
}

describe("declared Entitlements, read as data", () => {
  it("reads the names in billing({ entitlements }) and ignores comments", () => {
    expect(parseEntitlements(`import { billing } from "x";\nexport default [\n  // billing({ entitlements: ["old"] }),\n  billing({ entitlements: ["reports", 'projects'] }),\n];`)).toEqual(["reports", "projects"]);
  });

  it("finds none when billing is not listed or the list is not literal", () => {
    expect(parseEntitlements("export default [notes()];")).toEqual([]);
    expect(parseEntitlements("billing({ entitlements: NAMES })")).toEqual([]);
  });

  it("reads the example Product of this repository", () => {
    expect(declaredEntitlements(join(import.meta.dirname, "../.."), "example")).toEqual(["reports", "projects"]);
    expect(declaredEntitlements(join(import.meta.dirname, "../.."), "nobody")).toEqual([]);
  });
});

describe("the main deploy's Entitlement check", () => {
  it("names the declared Entitlements that no production plan sets", async () => {
    const client = await production({ reports: true });

    expect(await findUnplaced(client, "example", ["reports", "relatorios"])).toEqual({ product: "example", missing: ["relatorios"] });
  });

  it("counts an Entitlement that a plan sets to off as placed", async () => {
    const client = await production({ reports: false });

    expect((await findUnplaced(client, "example", ["reports"])).missing).toEqual([]);
  });

  it("asks Stripe nothing when the code declares none", async () => {
    const client = { listPlans: async () => Promise.reject(new Error("should not be called")) };

    expect(await findUnplaced(client, "example", [])).toEqual({ product: "example", missing: [] });
  });
});

describe("the comment on the merged PR", () => {
  const result: EntitlementResult = { product: "example", missing: ["relatorios"] };

  it("comments with the command to run when an Entitlement is in no plan", async () => {
    const forge = new FakeForge();
    forge.pulls = [42];

    const written = await postNotices(forge, { sha: "abc", language: "en", results: [result] });

    expect(written).toEqual(["#42 example"]);
    const [comment] = forge.comments_[42]!;
    expect(comment!.body).toContain("`relatorios`");
    expect(comment!.body).toContain("pnpm bootstrap billing example --redo entitlements");
    expect(comment!.body).toContain("<!-- factory -->");
  });

  it("writes in the language of FACTORY_LANGUAGE", async () => {
    const forge = new FakeForge();
    forge.pulls = [42];

    await postNotices(forge, { sha: "abc", language: "pt-BR", results: [{ product: "example", missing: ["relatorios", "export"] }] });

    expect(forge.comments_[42]![0]!.body).toContain("Os Entitlements `relatorios`, `export` ainda não estão em nenhum plano; rode `pnpm bootstrap billing example --redo entitlements`.");
  });

  it("does not comment when no Entitlement lacks a plan, or when the commit has no merged PR", async () => {
    const forge = new FakeForge();
    forge.pulls = [42];
    expect(await postNotices(forge, { sha: "abc", language: "en", results: [{ product: "example", missing: [] }] })).toEqual([]);
    expect(await postNotices(forge, { sha: "abc", language: "en", results: [] })).toEqual([]);
    expect(forge.comments_).toEqual({});

    forge.pulls = [];
    expect(await postNotices(forge, { sha: "abc", language: "en", results: [result] })).toEqual([]);
  });

  it("edits its own comment on a rerun instead of adding another", async () => {
    const forge = new FakeForge();
    forge.pulls = [42];
    await postNotices(forge, { sha: "abc", language: "en", results: [result] });

    await postNotices(forge, { sha: "abc", language: "en", results: [result] });
    expect(forge.comments_[42]).toHaveLength(1);

    await postNotices(forge, { sha: "abc", language: "en", results: [{ product: "example", missing: ["relatorios", "export"] }] });
    expect(forge.comments_[42]).toHaveLength(1);
    expect(forge.comments_[42]![0]!.body).toContain("`export`");
    expect(forge.comments_[42]![0]!.body).toContain(noticeMarker("example"));
  });

  it("refuses a name that could carry Markdown or a mention into the comment", async () => {
    const forge = new FakeForge();
    forge.pulls = [42];

    expect(await postNotices(forge, { sha: "abc", language: "en", results: [{ product: "example", missing: ["x`](http://evil)@all"] }] })).toEqual([]);
    expect(forge.comments_).toEqual({});
  });

  it("reads the result files the check left, one folder per Product", () => {
    const dir = mkdtempSync(join(tmpdir(), "entitlements-"));
    mkdirSync(join(dir, "entitlements-example"));
    writeFileSync(join(dir, "entitlements-example/entitlements.json"), JSON.stringify(result));
    mkdirSync(join(dir, "entitlements-broken"));
    writeFileSync(join(dir, "entitlements-broken/entitlements.json"), "{nope");

    try {
      expect(readResults(dir)).toEqual([result]);
      expect(readResults(join(dir, "missing"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
