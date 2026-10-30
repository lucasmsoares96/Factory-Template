import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import type { McpTool } from "../src/platform/mcp/tool.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";

// Seam 3: changing the Plan over HTTP, on the fake Stripe that runs inside the Worker
// (Free 1 Seat, Pro 3 for 19.00 a month or 190.00 a year, Team 10 for 49.00 or 490.00).

let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;
let testAuth: Awaited<ReturnType<typeof createTestAuth>>;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url, vars: { STRIPE_FAKE: "true", STRIPE_WEBHOOK_SECRET: "whsec_test", EMAIL_TRANSPORT: "outbox" } });
  testAuth = await createTestAuth({ databaseUrl: db.url, baseURL: worker.origin });
});
afterAll(async () => {
  await testAuth?.close();
  await worker?.close();
  await db?.drop();
});
beforeEach(async () => {
  await worker.post("/api/fake-stripe/control/reset", {});
});

const PRO = "prod_fake_pro";
const TEAM = "prod_fake_team";
const DAY = 24 * 60 * 60;

type Person = Awaited<ReturnType<typeof signedInUser>>;

async function signedInUser(name = "Ana Souza") {
  const user = await testAuth.saveUser(testAuth.createUser({ name, email: `user-${randomUUID()}@example.com`, emailVerified: true }));
  const headers = await testAuth.getAuthHeaders({ userId: user.id });
  return { user, cookie: headers.get("cookie")! };
}

type PlanState = {
  plan: { id: string; name: string; seats: number | null; minSeats: number | null };
  subscription: {
    status: string;
    interval: "month" | "year";
    seats: number | null;
    periodEnd: string;
    scheduledChange: { plan: string; interval: string; seats: number | null; at: string | null } | null;
  } | null;
};

async function planOf(cookie: string) {
  const response = await worker.fetch("/api/billing/plan", { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json()) as PlanState;
}

async function seatsOf(cookie: string) {
  const response = await worker.fetch("/api/billing/seats", { headers: { cookie } });
  expect(response.status).toBe(200);
  return ((await response.json()) as { total: number | null }).total;
}

const pathOf = (url: string) => new URL(url).pathname;

/** Checkout for `plan`, paid. */
async function subscribe(cookie: string, plan: string, extra: Record<string, unknown> = {}) {
  const opened = await worker.post("/api/billing/subscribe", { plan, ...extra }, { cookie });
  expect(opened.status).toBe(200);
  const { url } = (await opened.json()) as { url: string };
  expect((await worker.fetch(`${pathOf(url)}/pay`, { method: "POST", redirect: "manual" })).status).toBe(303);
}

const preview = (cookie: string, body: Record<string, unknown>) => worker.post("/api/billing/change/impact", body, { cookie });
const change = (cookie: string, body: Record<string, unknown>) => worker.post("/api/billing/change", body, { cookie });

type Done = { url: string; timing: "now" | "period_end"; effectiveAt: string | null };

/** Asks for the change and answers the page Stripe would show. */
async function changeAndOpen(cookie: string, body: Record<string, unknown>) {
  const response = await change(cookie, body);
  expect(response.status).toBe(200);
  return (await response.json()) as Done;
}

const portal = (done: Done, action: "pay" | "authenticate" | "decline") => worker.fetch(`${pathOf(done.url)}/${action}`, { method: "POST", redirect: "manual" });
const advance = (seconds: number) => worker.post("/api/fake-stripe/control/advance", { seconds });
const authenticate = (subscription: string, passes: boolean) => worker.post("/api/fake-stripe/control/authenticate", { subscription, passes });

async function stripeSubscriptionOf(person: Person) {
  const [row] = await db.query<{ stripe_subscription_id: string }>(`select stripe_subscription_id from skeleton.subscriptions where reference_id = '${person.user.id}'`);
  return row!.stripe_subscription_id;
}

/** A Company of the Owner with `count` Members, who joined one minute apart. */
async function companyWithMembers(owner: Person, count: number) {
  const response = await worker.post("/api/companies", { name: "Acme" }, { cookie: owner.cookie });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const members: Person[] = [];
  for (let index = 0; index < count; index += 1) {
    const member = await signedInUser(`Member ${index + 1}`);
    await db.query(
      `INSERT INTO skeleton.members (company_id, user_id, role, created_at) VALUES ('${id}', '${member.user.id}', 'employee', '${new Date(Date.parse("2026-01-01T00:00:00Z") + (index + 1) * 60_000).toISOString()}')`,
    );
    members.push(member);
  }
  return { id, members };
}

const accessOf = async (companyId: string, person: Person) => (await worker.fetch(`/api/companies/${companyId}`, { headers: { cookie: person.cookie } })).status;

test("moving up to a bigger Plan is immediate: Stripe's page shows the prorated amount and the Seats rise once the payment is confirmed", async () => {
  const ana = await signedInUser();
  await subscribe(ana.cookie, PRO);
  expect(await seatsOf(ana.cookie)).toBe(3);

  const done = await changeAndOpen(ana.cookie, { plan: TEAM });

  expect(done).toMatchObject({ timing: "now", effectiveAt: null });
  const page = await worker.fetch(pathOf(done.url), { headers: { accept: "text/html" } });
  const html = await page.text();
  expect(html).toContain("fake-portal-due");
  expect(html).toMatch(/Due today: [1-3]\d\.\d\d USD/);
  // Nothing changed until the payment is confirmed.
  expect(await seatsOf(ana.cookie)).toBe(3);
  const paid = await portal(done, "pay");
  expect(paid.status).toBe(303);
  expect(new URL(paid.headers.get("location")!).pathname).toBe("/account/plan");
  expect(await seatsOf(ana.cookie)).toBe(10);
  expect(await planOf(ana.cookie)).toMatchObject({ plan: { name: "Team" }, subscription: { status: "active", scheduledChange: null } });
});

test("a declined card leaves the Plan and the Seats as they were", async () => {
  const ana = await signedInUser();
  await subscribe(ana.cookie, PRO);
  const done = await changeAndOpen(ana.cookie, { plan: TEAM });

  const declined = await portal(done, "decline");

  expect(declined.status).toBe(303);
  expect(await (await worker.fetch(`${pathOf(declined.headers.get("location")!)}?declined=1`)).text()).toContain("fake-portal-declined");
  expect(await seatsOf(ana.cookie)).toBe(3);
  expect((await planOf(ana.cookie)).plan.name).toBe("Pro");
});

test("with the bank's confirmation pending the Seats stay as they are until it passes", async () => {
  const ana = await signedInUser();
  await subscribe(ana.cookie, PRO);
  const stripeId = await stripeSubscriptionOf(ana);
  const done = await changeAndOpen(ana.cookie, { plan: TEAM });

  await portal(done, "authenticate");

  expect(await seatsOf(ana.cookie)).toBe(3);
  expect((await planOf(ana.cookie)).plan.name).toBe("Pro");
  const [stripeSubscription] = await db.query<{ pending: boolean }>(`select body->'pending_update' is not null as pending from skeleton.fake_stripe where id = '${stripeId}'`);
  expect(stripeSubscription?.pending).toBe(true);

  expect((await authenticate(stripeId, true)).status).toBe(200);
  expect(await seatsOf(ana.cookie)).toBe(10);
  expect((await planOf(ana.cookie)).plan.name).toBe("Team");
});

test("when the bank's confirmation fails the Seats never change", async () => {
  const ana = await signedInUser();
  await subscribe(ana.cookie, PRO);
  const done = await changeAndOpen(ana.cookie, { plan: TEAM });
  await portal(done, "authenticate");

  expect((await authenticate(await stripeSubscriptionOf(ana), false)).status).toBe(200);

  expect(await seatsOf(ana.cookie)).toBe(3);
  expect((await planOf(ana.cookie)).plan.name).toBe("Pro");
});

test("moving down is scheduled: the preview names the date and who loses access, and the Seats fall at the end of the paid period", async () => {
  const ana = await signedInUser();
  await subscribe(ana.cookie, TEAM);
  const company = await companyWithMembers(ana, 5);
  const invited = await worker.post(`/api/companies/${company.id}/invitations`, { email: `guest-${randomUUID()}@example.com`, role: "employee" }, { cookie: ana.cookie });
  expect(invited.status).toBe(201);
  const { subscription } = await planOf(ana.cookie);

  const previewed = await preview(ana.cookie, { plan: PRO });

  expect(previewed.status).toBe(200);
  // 7 Seats are taken (Ana, 5 Members, 1 Invitation) and the Plan gives 3: the Invitation goes first, then 3 Members.
  expect(await previewed.json()).toEqual({ timing: "period_end", effectiveAt: subscription!.periodEnd, seatsAfter: 3, used: 7, peopleLosingAccess: 3 });
  expect(await seatsOf(ana.cookie)).toBe(10);

  const done = await changeAndOpen(ana.cookie, { plan: PRO });

  expect(done).toMatchObject({ timing: "period_end", effectiveAt: subscription!.periodEnd });
  expect(await seatsOf(ana.cookie)).toBe(10);
  expect((await planOf(ana.cookie)).subscription?.scheduledChange).toMatchObject({ plan: PRO, interval: "month", at: subscription!.periodEnd });
  for (const member of company.members) expect(await accessOf(company.id, member)).toBe(200);

  await advance(31 * DAY);

  expect(await planOf(ana.cookie)).toMatchObject({ plan: { name: "Pro" }, subscription: { status: "active", scheduledChange: null } });
  expect(await seatsOf(ana.cookie)).toBe(3);
  // The suspension acts: the people who joined first keep their access.
  expect(await Promise.all(company.members.map((member) => accessOf(company.id, member)))).toEqual([200, 200, 403, 403, 403]);
});

test("a drop that leaves everybody a Seat warns nobody", async () => {
  const ana = await signedInUser();
  await subscribe(ana.cookie, TEAM);
  await companyWithMembers(ana, 1);

  const previewed = await preview(ana.cookie, { plan: PRO });

  expect(await previewed.json()).toMatchObject({ timing: "period_end", seatsAfter: 3, used: 2, peopleLosingAccess: 0 });
});

test("scheduling a different change replaces the one before it", async () => {
  const ana = await signedInUser();
  await subscribe(ana.cookie, TEAM);
  await changeAndOpen(ana.cookie, { plan: PRO });
  expect((await planOf(ana.cookie)).subscription?.scheduledChange).toMatchObject({ plan: PRO, interval: "month" });

  // A Plan below the current one, paid by the year: a mix of a rise and a drop, so scheduled too.
  await changeAndOpen(ana.cookie, { plan: PRO, interval: "year" });

  expect((await planOf(ana.cookie)).subscription?.scheduledChange).toMatchObject({ plan: PRO, interval: "year" });
});

test("monthly to yearly is immediate and credits what is left of the month; yearly to monthly waits for the end of the paid year", async () => {
  const ana = await signedInUser();
  await subscribe(ana.cookie, PRO);

  const up = await changeAndOpen(ana.cookie, { plan: PRO, interval: "year" });

  expect(up).toMatchObject({ timing: "now" });
  await portal(up, "pay");
  const yearly = await planOf(ana.cookie);
  expect(yearly).toMatchObject({ plan: { name: "Pro" }, subscription: { interval: "year" } });
  expect(Date.parse(yearly.subscription!.periodEnd)).toBeGreaterThan(Date.now() + 360 * DAY * 1000);

  const down = await changeAndOpen(ana.cookie, { plan: PRO, interval: "month" });

  expect(down).toMatchObject({ timing: "period_end", effectiveAt: yearly.subscription!.periodEnd });
  expect((await planOf(ana.cookie)).subscription).toMatchObject({ interval: "year", scheduledChange: { plan: PRO, interval: "month" } });
  await advance(200 * DAY);
  expect((await planOf(ana.cookie)).subscription).toMatchObject({ interval: "year" });
  await advance(170 * DAY);
  expect((await planOf(ana.cookie)).subscription).toMatchObject({ interval: "month", scheduledChange: null });
});

test("a rise mixed with a drop waits for the end of the period", async () => {
  const ana = await signedInUser();
  await subscribe(ana.cookie, PRO);
  await portal(await changeAndOpen(ana.cookie, { plan: PRO, interval: "year" }), "pay");

  // A bigger Plan, but paid by the month instead of the year.
  const previewed = await preview(ana.cookie, { plan: TEAM, interval: "month" });

  expect(await previewed.json()).toMatchObject({ timing: "period_end", seatsAfter: 10 });
});

// A Plan priced per Seat: Team becomes one (Pro is the biggest fixed Plan, with 3 Seats, so the minimum is 4).

async function perSeatTeam() {
  expect((await worker.post("/api/fake-stripe/control/products", { id: TEAM, metadata: { kind: "per_seat", seats: "" } })).status).toBe(200);
}

test("a Plan priced per Seat sells at least one Seat more than the biggest fixed Plan; the person picks how many", async () => {
  await perSeatTeam();
  const ana = await signedInUser();
  expect((await planOf(ana.cookie)) as unknown).toBeTruthy();
  const state = (await (await worker.fetch("/api/billing/plan", { headers: { cookie: ana.cookie } })).json()) as { plans: { id: string; minSeats: number | null }[] };
  expect(state.plans.map((plan) => [plan.id, plan.minSeats])).toEqual([["prod_fake_free", null], [PRO, null], [TEAM, 4]]);

  const below = await worker.post("/api/billing/subscribe", { plan: TEAM, seats: 3 }, { cookie: ana.cookie });

  expect(below.status).toBe(400);
  expect(await below.json()).toMatchObject({ code: "SEATS_BELOW_MINIMUM" });
  expect(await seatsOf(ana.cookie)).toBe(1);
  await subscribe(ana.cookie, TEAM, { seats: 6 });
  expect(await planOf(ana.cookie)).toMatchObject({ plan: { name: "Team" }, subscription: { seats: 6 } });
  expect(await seatsOf(ana.cookie)).toBe(6);
});

test("without a number, a Plan priced per Seat starts at its minimum", async () => {
  await perSeatTeam();
  const ana = await signedInUser();

  await subscribe(ana.cookie, TEAM);

  expect(await seatsOf(ana.cookie)).toBe(4);
});

test("buying more Seats is immediate once paid; buying fewer waits for the end of the period; below the minimum is refused", async () => {
  await perSeatTeam();
  const ana = await signedInUser();
  await subscribe(ana.cookie, TEAM, { seats: 6 });

  const more = await changeAndOpen(ana.cookie, { plan: TEAM, seats: 9 });

  expect(more.timing).toBe("now");
  expect(await seatsOf(ana.cookie)).toBe(6);
  await portal(more, "pay");
  expect(await seatsOf(ana.cookie)).toBe(9);

  const fewer = await changeAndOpen(ana.cookie, { plan: TEAM, seats: 5 });

  expect(fewer.timing).toBe("period_end");
  expect(await seatsOf(ana.cookie)).toBe(9);
  expect((await planOf(ana.cookie)).subscription?.scheduledChange).toMatchObject({ plan: TEAM, seats: 5 });
  expect((await change(ana.cookie, { plan: TEAM, seats: 3 })).status).toBe(400);
  await advance(31 * DAY);
  expect(await seatsOf(ana.cookie)).toBe(5);
});

test("moving from a fixed Plan to one priced per Seat needs the Seats above the minimum", async () => {
  await perSeatTeam();
  const ana = await signedInUser();
  await subscribe(ana.cookie, PRO);

  const refused = await change(ana.cookie, { plan: TEAM, seats: 2 });
  const accepted = await changeAndOpen(ana.cookie, { plan: TEAM, seats: 5 });

  expect(refused.status).toBe(400);
  expect(await refused.json()).toMatchObject({ code: "SEATS_BELOW_MINIMUM" });
  expect(accepted.timing).toBe("now");
  await portal(accepted, "pay");
  expect(await seatsOf(ana.cookie)).toBe(5);
});

test("a change that asks for what the person already has, a missing Plan or an interval the Plan lacks is refused", async () => {
  const ana = await signedInUser();
  expect((await change(ana.cookie, { plan: TEAM })).status).toBe(409);
  expect(await (await change(ana.cookie, { plan: TEAM })).json()).toMatchObject({ code: "NOT_SUBSCRIBED" });
  await subscribe(ana.cookie, PRO);

  const same = await change(ana.cookie, { plan: PRO });
  const unknown = await change(ana.cookie, { plan: "prod_unknown" });
  const free = await change(ana.cookie, { plan: "prod_fake_free" });
  const noBody = await change(ana.cookie, {});
  const signedOut = await worker.post("/api/billing/change", { plan: TEAM });

  expect(same.status).toBe(409);
  expect(await same.json()).toMatchObject({ code: "ALREADY_ON_PLAN" });
  expect(unknown.status).toBe(404);
  expect(free.status).toBe(404);
  expect(noBody.status).toBe(400);
  expect(signedOut.status).toBe(401);
  await worker.post("/api/fake-stripe/control/products", { id: TEAM, metadata: {} });
  expect((await preview(ana.cookie, { plan: PRO, seats: 1.5 })).status).toBe(400);
});

test("the routes that change the Plan are not MCP tools", async () => {
  const tools = JSON.parse(readFileSync(new URL("./worker/mcp-tools.gen.json", import.meta.url), "utf8")) as McpTool[];
  const document = (await (await worker.fetch("/api/openapi.json")).json()) as { paths: Record<string, Record<string, Record<string, unknown>>> };

  for (const path of ["/api/billing/change", "/api/billing/change/impact"]) expect(document.paths[path]?.post?.["x-mcp"], path).toBe(false);
  expect(tools.map((tool) => tool.name)).not.toContain("changePlan");
  expect(tools.map((tool) => tool.name)).not.toContain("previewPlanChange");
});
