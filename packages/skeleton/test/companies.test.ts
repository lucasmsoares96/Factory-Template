import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { migrateDatabase } from "../src/node/migrate.ts";
import { mockResend } from "../src/node/resend-mock.ts";
import { createTestAuth } from "./support/auth.ts";
import { createEmptyDatabase } from "./support/database.ts";
import { startTestWorker, type TestWorker } from "./support/worker.ts";
import { createDeletingCompanies, createUndeletableCompanies } from "./worker/events.ts";

// Seam 1: the Worker over HTTP. Every test brings its own users and Companies.

const resend = mockResend(() => {});
let db: Awaited<ReturnType<typeof createEmptyDatabase>>;
let worker: TestWorker;
let testAuth: Awaited<ReturnType<typeof createTestAuth>>;

beforeAll(async () => {
  db = await createEmptyDatabase();
  await migrateDatabase({ databaseUrl: db.url });
  worker = await startTestWorker({ databaseUrl: db.url });
  testAuth = await createTestAuth({ databaseUrl: db.url, baseURL: worker.origin });
  await db.query(createDeletingCompanies);
  await db.query(createUndeletableCompanies);
});
afterAll(async () => {
  await testAuth?.close();
  await worker?.close();
  resend.close();
  await db?.drop();
});

async function signedInUser(name = "Ana Souza") {
  const user = await testAuth.saveUser(
    testAuth.createUser({ name, email: `user-${randomUUID()}@example.com`, emailVerified: true }),
  );
  const headers = await testAuth.getAuthHeaders({ userId: user.id });
  return { user, cookie: headers.get("cookie")! };
}

function api(path: string, { cookie, method = "GET", body }: { cookie?: string; method?: string; body?: unknown } = {}) {
  return worker.fetch(path, {
    method,
    headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function createCompany(cookie: string, name = "Acme") {
  const response = await api("/api/companies", { cookie, method: "POST", body: { name } });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; name: string; role: string; createdAt: string };
}

test("POST /api/companies creates a Company with a random id and makes its creator the Owner", async () => {
  const { user, cookie } = await signedInUser();

  const response = await api("/api/companies", { cookie, method: "POST", body: { name: "  Acme  " } });

  expect(response.status).toBe(201);
  const company = (await response.json()) as { id: string };
  expect(company).toEqual({ id: expect.any(String), name: "Acme", role: "owner", createdAt: expect.any(String) });
  expect(company.id).not.toContain("Acme");
  expect(await db.query(`SELECT user_id, role FROM skeleton.members WHERE company_id = '${company.id}'`)).toEqual([
    { user_id: user.id, role: "owner" },
  ]);
});

test("POST /api/companies answers 400 VALIDATION_FAILED for a missing, blank or too long name, and creates nothing", async () => {
  const { user, cookie } = await signedInUser();

  for (const body of [{}, { name: "" }, { name: "   " }, { name: "a".repeat(101) }, { name: 42 }]) {
    const response = await api("/api/companies", { cookie, method: "POST", body });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "VALIDATION_FAILED", message: "The request is invalid." });
  }
  expect(await db.query(`SELECT 1 FROM skeleton.members WHERE user_id = '${user.id}'`)).toEqual([]);
  expect((await createCompany(cookie, "a".repeat(100))).name).toBe("a".repeat(100));
});

test("POST /api/companies answers 401 UNAUTHENTICATED without a session", async () => {
  const response = await api("/api/companies", { method: "POST", body: { name: "Acme" } });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
});

test("a user creates as many Companies as they want, and names may repeat, even across users", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");

  const created = [await createCompany(ana.cookie, "Acme"), await createCompany(ana.cookie, "Acme"), await createCompany(bruno.cookie, "Acme")];

  expect(new Set(created.map((company) => company.id)).size).toBe(3);
  expect(created.map((company) => [company.name, company.role])).toEqual([
    ["Acme", "owner"],
    ["Acme", "owner"],
    ["Acme", "owner"],
  ]);
});

test("creating a Company runs every feature's memberJoined for its Owner", async () => {
  const { user, cookie } = await signedInUser();

  const company = await createCompany(cookie);

  // The test composition's `notes` feature records each event in `public.joined_members`.
  expect(await db.query(`SELECT user_id FROM public.joined_members WHERE company_id = '${company.id}'`)).toEqual([
    { user_id: user.id },
  ]);
});

test("the database keeps a single Owner per Company and a single Member per Company and user", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie);

  await expect(
    db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${company.id}', '${bruno.user.id}', 'owner')`),
  ).rejects.toThrow(/members_one_owner_idx/);
  await expect(
    db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${company.id}', '${ana.user.id}', 'employee')`),
  ).rejects.toThrow(/members_pkey/);
  await db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${company.id}', '${bruno.user.id}', 'employee')`);
  await expect(
    db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${company.id}', '${bruno.user.id}', 'employee')`),
  ).rejects.toThrow(/members_pkey/);
  await expect(
    db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${company.id}', '${randomUUID()}', 'nobody')`),
  ).rejects.toThrow(/foreign key/);
});

test("deleting a user deletes their Members, and the Company stays", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);

  await db.query(`DELETE FROM skeleton.users WHERE id = '${bruno.user.id}'`);

  expect(await db.query(`SELECT user_id FROM skeleton.members WHERE company_id = '${company.id}'`)).toEqual([
    { user_id: ana.user.id },
  ]);
});

/** Makes a user a Member of a Company (Invitations come later: the test writes the row itself). */
function join(companyId: string, userId: string, role = "employee") {
  return db.query(`INSERT INTO skeleton.members (company_id, user_id, role) VALUES ('${companyId}', '${userId}', '${role}')`);
}

type Page<T> = { items: T[]; nextCursor: string | null };

test("GET /api/companies lists only the user's Companies, with their role, in the order they joined", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const first = await createCompany(ana.cookie, "First");
  const brunos = await createCompany(bruno.cookie, "Bruno's");
  await createCompany(bruno.cookie, "Not Ana's");
  await join(brunos.id, ana.user.id);

  const response = await api("/api/companies", { cookie: ana.cookie });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    items: [
      { id: first.id, name: "First", role: "owner", createdAt: first.createdAt },
      { id: brunos.id, name: "Bruno's", role: "employee", createdAt: brunos.createdAt },
    ],
    nextCursor: null,
  });
});

test("GET /api/companies answers 50 per page by default and walks every page with the cursor", async () => {
  const { cookie } = await signedInUser();
  const created: string[] = [];
  for (let i = 0; i < 52; i++) created.push((await createCompany(cookie, `Company ${i}`)).id);

  const first = (await (await api("/api/companies", { cookie })).json()) as Page<{ id: string }>;
  expect(first.items).toHaveLength(50);
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = (await (await api(`/api/companies?cursor=${first.nextCursor}`, { cookie })).json()) as Page<{ id: string }>;
  expect(second).toEqual({ items: [expect.objectContaining({ id: created[50] }), expect.objectContaining({ id: created[51] })], nextCursor: null });
  expect([...first.items, ...second.items].map((company) => company.id)).toEqual(created);

  const small = (await (await api("/api/companies?limit=2", { cookie })).json()) as Page<{ id: string }>;
  expect(small.items.map((company) => company.id)).toEqual(created.slice(0, 2));
  const next = (await (await api(`/api/companies?limit=2&cursor=${small.nextCursor}`, { cookie })).json()) as Page<{ id: string }>;
  expect(next.items.map((company) => company.id)).toEqual(created.slice(2, 4));
});

test("GET /api/companies answers 400 VALIDATION_FAILED for a limit out of range or a cursor it never answered", async () => {
  const { cookie } = await signedInUser();

  for (const query of ["limit=0", "limit=101", "limit=many", "cursor=nonsense"]) {
    const response = await api(`/api/companies?${query}`, { cookie });
    expect(response.status, query).toBe(400);
    expect(await response.json()).toEqual({ code: "VALIDATION_FAILED", message: "The request is invalid." });
  }
});

test("GET /api/companies/{companyId} answers the Company with the user's role", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);

  const response = await api(`/api/companies/${company.id}`, { cookie: bruno.cookie });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...company, role: "employee" });
});

test("a Company of which the user is not a Member answers 404 NOT_FOUND, exactly like one that does not exist", async () => {
  const ana = await signedInUser();
  const mallory = await signedInUser("Mallory");
  const company = await createCompany(ana.cookie);

  for (const path of [`/api/companies/${company.id}`, `/api/companies/${company.id}/members`, `/api/companies/${company.id}/notes/welcome`]) {
    const foreign = await api(path, { cookie: mallory.cookie });
    const missing = await api(path.replace(company.id, randomUUID()), { cookie: ana.cookie });
    expect([foreign.status, missing.status], path).toEqual([404, 404]);
    expect(await foreign.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
    expect(await missing.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
  }
  expect((await api(`/api/companies/${company.id}`)).status).toBe(401);
});

test("GET /api/companies/{companyId}/members lists the Members with name, email and role, page by page", async () => {
  const ana = await signedInUser("Ana Souza");
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);

  const response = await api(`/api/companies/${company.id}/members`, { cookie: bruno.cookie });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    items: [
      { userId: ana.user.id, name: "Ana Souza", email: ana.user.email, role: "owner" },
      { userId: bruno.user.id, name: "Bruno Lima", email: bruno.user.email, role: "employee" },
    ],
    nextCursor: null,
  });
  const first = (await (await api(`/api/companies/${company.id}/members?limit=1`, { cookie: ana.cookie })).json()) as Page<{ userId: string }>;
  expect(first.items.map((member) => member.userId)).toEqual([ana.user.id]);
  const second = (await (
    await api(`/api/companies/${company.id}/members?limit=1&cursor=${first.nextCursor}`, { cookie: ana.cookie })
  ).json()) as Page<{ userId: string }>;
  expect(second).toEqual({ items: [expect.objectContaining({ userId: bruno.user.id })], nextCursor: null });
});

test("GET /api/companies/{companyId}/members pages Members who joined in the same millisecond by user id, each once", async () => {
  const ana = await signedInUser();
  const company = await createCompany(ana.cookie);
  const others = await Promise.all(["Bruno Lima", "Carla Dias", "Davi Rocha"].map((name) => signedInUser(name)));
  for (const { user } of others) await join(company.id, user.id);
  const sameMillisecond = "2026-10-24T12:00:00.123Z";
  await db.query(`UPDATE skeleton.members SET created_at = '${sameMillisecond}' WHERE company_id = '${company.id}'`);

  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `limit=1&cursor=${cursor}` : "limit=1";
    const page = (await (await api(`/api/companies/${company.id}/members?${query}`, { cookie: ana.cookie })).json()) as Page<{
      userId: string;
    }>;
    seen.push(...page.items.map((member) => member.userId));
    cursor = page.nextCursor;
  } while (cursor && seen.length < 10);

  // The tie order is the database's collation of the ids; what matters is that no Member repeats or goes missing.
  expect(seen).toHaveLength(4);
  expect([...seen].sort()).toEqual([ana.user.id, ...others.map(({ user }) => user.id)].sort());
});

test("GET /api/me/last-company answers the Company opened last, the first joined before any, and 404 without one", async () => {
  const { cookie } = await signedInUser();

  const none = await api("/api/me/last-company", { cookie });
  expect(none.status).toBe(404);
  expect(await none.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });

  const first = await createCompany(cookie, "First");
  const second = await createCompany(cookie, "Second");
  expect(await (await api("/api/me/last-company", { cookie })).json()).toEqual(first);

  await api(`/api/companies/${second.id}`, { cookie });
  expect(await (await api("/api/me/last-company", { cookie })).json()).toEqual(second);
  await api(`/api/companies/${first.id}`, { cookie });
  expect(await (await api("/api/me/last-company", { cookie })).json()).toEqual(first);
});

test("a Product's route under /api/companies/{companyId} gets the Member and role from the Skeleton's check", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie);
  await join(company.id, bruno.user.id);

  // The test composition's `notes` feature answers what `requireMember` resolved.
  const owner = await api(`/api/companies/${company.id}/notes/welcome`, { cookie: ana.cookie });
  const employee = await api(`/api/companies/${company.id}/notes/welcome`, { cookie: bruno.cookie });

  expect(owner.status).toBe(200);
  expect(await owner.json()).toEqual({ companyId: company.id, userId: ana.user.id, role: "owner", skeletonRole: "owner" });
  expect(await employee.json()).toEqual({ companyId: company.id, userId: bruno.user.id, role: "employee", skeletonRole: "employee" });
});

test("a role the Product adds to member_roles counts as Employee on the Skeleton's routes", async () => {
  await db.query(`INSERT INTO skeleton.member_roles (id) VALUES ('manager') ON CONFLICT DO NOTHING`);
  const ana = await signedInUser();
  const carla = await signedInUser("Carla Dias");
  const company = await createCompany(ana.cookie);
  await join(company.id, carla.user.id, "manager");

  expect(await (await api(`/api/companies/${company.id}`, { cookie: carla.cookie })).json()).toEqual({ ...company, role: "manager" });
  expect((await (await api("/api/companies", { cookie: carla.cookie })).json()) as Page<unknown>).toMatchObject({
    items: [{ id: company.id, role: "manager" }],
  });
  const members = (await (await api(`/api/companies/${company.id}/members`, { cookie: carla.cookie })).json()) as Page<{ role: string }>;
  expect(members.items.map((member) => member.role)).toEqual(["owner", "manager"]);
  expect(await (await api(`/api/companies/${company.id}/notes/welcome`, { cookie: carla.cookie })).json()).toMatchObject({
    role: "manager",
    skeletonRole: "employee",
  });
});

test("every Company route is described in the OpenAPI document under /api/companies/{companyId}", async () => {
  const document = (await (await worker.fetch("/api/openapi.json")).json()) as {
    paths: Record<string, Record<string, { operationId: string; responses: object }>>;
  };

  const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.values(methods).map((operation) => [operation.operationId, path, Object.keys(operation.responses).sort()]),
  );
  expect(operations).toEqual(
    expect.arrayContaining([
      ["createCompany", "/api/companies", ["201", "400", "401"]],
      ["listCompanies", "/api/companies", ["200", "400", "401"]],
      ["getLastCompany", "/api/me/last-company", ["200", "401", "404"]],
      ["getCompany", "/api/companies/{companyId}", ["200", "401", "404"]],
      ["listMembers", "/api/companies/{companyId}/members", ["200", "400", "401", "404"]],
      ["renameCompany", "/api/companies/{companyId}", ["200", "400", "401", "403", "404"]],
      ["deleteCompany", "/api/companies/{companyId}", ["204", "400", "401", "403", "404"]],
      ["transferOwnership", "/api/companies/{companyId}/transfer-ownership", ["200", "400", "401", "403", "404"]],
    ]),
  );
});

test("PATCH /api/companies/{companyId} renames the Company for its Owner, and its id and URL stay the same", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);

  const response = await api(`/api/companies/${company.id}`, { cookie: ana.cookie, method: "PATCH", body: { name: "  Acme Corp  " } });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...company, name: "Acme Corp" });
  expect(await (await api(`/api/companies/${company.id}`, { cookie: bruno.cookie })).json()).toEqual({
    ...company,
    name: "Acme Corp",
    role: "employee",
  });
});

test("PATCH /api/companies/{companyId} answers 403 FORBIDDEN to an Employee or a Product's role, and the name stays", async () => {
  await db.query(`INSERT INTO skeleton.member_roles (id) VALUES ('manager') ON CONFLICT DO NOTHING`);
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);
  await join(company.id, carla.user.id, "manager");

  for (const { cookie } of [bruno, carla]) {
    const response = await api(`/api/companies/${company.id}`, { cookie, method: "PATCH", body: { name: "Mine" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "Your role in this Company does not allow this." });
  }
  expect(await db.query(`SELECT name FROM skeleton.companies WHERE id = '${company.id}'`)).toEqual([{ name: "Acme" }]);
});

test("PATCH /api/companies/{companyId} answers 400 VALIDATION_FAILED for an invalid name, and 404 to a non-Member", async () => {
  const ana = await signedInUser();
  const mallory = await signedInUser("Mallory");
  const company = await createCompany(ana.cookie, "Acme");

  for (const body of [{}, { name: "" }, { name: "   " }, { name: "a".repeat(101) }, { name: 42 }]) {
    const response = await api(`/api/companies/${company.id}`, { cookie: ana.cookie, method: "PATCH", body });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "VALIDATION_FAILED", message: "The request is invalid." });
  }
  const foreign = await api(`/api/companies/${company.id}`, { cookie: mallory.cookie, method: "PATCH", body: { name: "Mine" } });
  expect(foreign.status).toBe(404);
  expect(await db.query(`SELECT name FROM skeleton.companies WHERE id = '${company.id}'`)).toEqual([{ name: "Acme" }]);
});

test("PATCH and DELETE /api/companies/{companyId} answer 401 UNAUTHENTICATED without a session", async () => {
  const ana = await signedInUser();
  const company = await createCompany(ana.cookie, "Acme");

  for (const [method, body] of [["PATCH", { name: "Mine" }], ["DELETE", { name: "Acme" }]] as const) {
    const response = await api(`/api/companies/${company.id}`, { method, body });
    expect(response.status, method).toBe(401);
    expect(await response.json()).toEqual({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  }
  expect(await db.query(`SELECT name FROM skeleton.companies WHERE id = '${company.id}'`)).toEqual([{ name: "Acme" }]);
});

test("DELETE /api/companies/{companyId} answers 400 CONFIRMATION_MISMATCH for a name other than the current one, and deletes nothing", async () => {
  const ana = await signedInUser();
  const company = await createCompany(ana.cookie, "Acme");
  await api(`/api/companies/${company.id}`, { cookie: ana.cookie, method: "PATCH", body: { name: "Acme Corp" } });

  for (const name of ["Acme", "acme corp", "Globex"]) {
    const response = await api(`/api/companies/${company.id}`, { cookie: ana.cookie, method: "DELETE", body: { name } });
    expect(response.status, name).toBe(400);
    expect(await response.json()).toEqual({
      code: "CONFIRMATION_MISMATCH",
      message: "The confirmation does not match the Company's name.",
    });
  }
  const missing = await api(`/api/companies/${company.id}`, { cookie: ana.cookie, method: "DELETE", body: {} });
  expect(missing.status).toBe(400);
  expect(await missing.json()).toEqual({ code: "VALIDATION_FAILED", message: "The request is invalid." });
  expect((await api(`/api/companies/${company.id}`, { cookie: ana.cookie })).status).toBe(200);
  expect(await db.query(`SELECT 1 FROM public.deleting_companies WHERE company_id = '${company.id}'`)).toEqual([]);
});

test("DELETE /api/companies/{companyId} answers 403 FORBIDDEN to an Employee or a Product's role, and 404 to a non-Member", async () => {
  await db.query(`INSERT INTO skeleton.member_roles (id) VALUES ('manager') ON CONFLICT DO NOTHING`);
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  const mallory = await signedInUser("Mallory");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);
  await join(company.id, carla.user.id, "manager");

  for (const { cookie } of [bruno, carla]) {
    const response = await api(`/api/companies/${company.id}`, { cookie, method: "DELETE", body: { name: "Acme" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "Your role in this Company does not allow this." });
  }
  const foreign = await api(`/api/companies/${company.id}`, { cookie: mallory.cookie, method: "DELETE", body: { name: "Acme" } });
  expect(foreign.status).toBe(404);
  expect(await db.query(`SELECT count(*)::int AS members FROM skeleton.members WHERE company_id = '${company.id}'`)).toEqual([
    { members: 3 },
  ]);
});

test("DELETE /api/companies/{companyId} runs every feature's companyDeleting in order, then deletes the Company and its Members", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie, "Acme");
  const other = await createCompany(ana.cookie, "Globex");
  await join(company.id, bruno.user.id);

  const response = await api(`/api/companies/${company.id}`, { cookie: ana.cookie, method: "DELETE", body: { name: "  Acme  " } });

  expect(response.status).toBe(204);
  // The test composition's features record each event, with the Members the Company still had then.
  expect(
    await db.query(`SELECT feature, members FROM public.deleting_companies WHERE company_id = '${company.id}' ORDER BY seq`),
  ).toEqual([
    { feature: "notes", members: 2 },
    { feature: "archive", members: 2 },
  ]);
  expect(await db.query(`SELECT 1 FROM skeleton.companies WHERE id = '${company.id}'`)).toEqual([]);
  expect(await db.query(`SELECT 1 FROM skeleton.members WHERE company_id = '${company.id}'`)).toEqual([]);
  expect(await db.query(`SELECT name FROM skeleton.companies WHERE id = '${other.id}'`)).toEqual([{ name: "Globex" }]);
  // The former Members find no trace of it.
  for (const { cookie } of [ana, bruno]) {
    for (const path of [`/api/companies/${company.id}`, `/api/companies/${company.id}/members`, `/api/companies/${company.id}/notes/welcome`]) {
      const gone = await api(path, { cookie });
      expect(gone.status, path).toBe(404);
      expect(await gone.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
    }
  }
  expect(((await (await api("/api/companies", { cookie: bruno.cookie })).json()) as Page<unknown>).items).toEqual([]);
  expect(await (await api("/api/me/last-company", { cookie: ana.cookie })).json()).toEqual(other);
});

test("DELETE /api/companies/{companyId} deletes nothing when a feature's companyDeleting throws, the earlier features' work included", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);
  // The test composition's last feature, `archive`, throws for this Company, after `notes` recorded its event.
  await db.query(`INSERT INTO public.undeletable_companies VALUES ('${company.id}')`);

  const response = await api(`/api/companies/${company.id}`, { cookie: ana.cookie, method: "DELETE", body: { name: "Acme" } });

  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ code: "INTERNAL_ERROR" });
  expect(await db.query(`SELECT 1 FROM public.deleting_companies WHERE company_id = '${company.id}'`)).toEqual([]);
  expect(await db.query(`SELECT count(*)::int AS members FROM skeleton.members WHERE company_id = '${company.id}'`)).toEqual([
    { members: 2 },
  ]);
  expect(await (await api(`/api/companies/${company.id}`, { cookie: bruno.cookie })).json()).toEqual({ ...company, role: "employee" });
});

function transfer(companyId: string, cookie: string | undefined, body: unknown) {
  return api(`/api/companies/${companyId}/transfer-ownership`, { cookie, method: "POST", body });
}

async function rolesOf(companyId: string) {
  const rows = (await db.query(`SELECT user_id, role FROM skeleton.members WHERE company_id = '${companyId}'`)) as {
    user_id: string;
    role: string;
  }[];
  return Object.fromEntries(rows.map(({ user_id, role }) => [user_id, role]));
}

test("POST /api/companies/{companyId}/transfer-ownership makes the Member the Owner and the former Owner an Employee", async () => {
  await db.query(`INSERT INTO skeleton.member_roles (id) VALUES ('manager') ON CONFLICT DO NOTHING`);
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id, "manager");
  await join(company.id, carla.user.id);

  const response = await transfer(company.id, ana.cookie, { userId: bruno.user.id, name: "  Acme  " });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...company, role: "employee" });
  expect(await rolesOf(company.id)).toEqual({ [ana.user.id]: "employee", [bruno.user.id]: "owner", [carla.user.id]: "employee" });
  expect(await db.query(`SELECT count(*)::int AS owners FROM skeleton.members WHERE company_id = '${company.id}' AND role = 'owner'`)).toEqual([
    { owners: 1 },
  ]);
});

test("after a transfer the new Owner has every Owner's action, and the former Owner none", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);
  expect((await transfer(company.id, ana.cookie, { userId: bruno.user.id, name: "Acme" })).status).toBe(200);

  // The former Owner is an Employee now: nothing the Owner does is theirs any more.
  expect((await api(`/api/companies/${company.id}`, { cookie: ana.cookie, method: "PATCH", body: { name: "Mine" } })).status).toBe(403);
  expect((await transfer(company.id, ana.cookie, { userId: ana.user.id, name: "Acme" })).status).toBe(403);
  expect((await api(`/api/companies/${company.id}/invitations`, { cookie: ana.cookie })).status).toBe(403);

  // The new Owner renames, invites, gives the Company back, and could delete it.
  expect(await (await api(`/api/companies/${company.id}`, { cookie: bruno.cookie })).json()).toEqual({ ...company, role: "owner" });
  expect((await api(`/api/companies/${company.id}`, { cookie: bruno.cookie, method: "PATCH", body: { name: "Acme Corp" } })).status).toBe(200);
  const invited = await api(`/api/companies/${company.id}/invitations`, {
    cookie: bruno.cookie,
    method: "POST",
    body: { email: `guest-${randomUUID()}@example.com`, role: "employee" },
  });
  expect(invited.status).toBe(201);
  expect((await transfer(company.id, bruno.cookie, { userId: ana.user.id, name: "Acme Corp" })).status).toBe(200);
  expect(await rolesOf(company.id)).toEqual({ [ana.user.id]: "owner", [bruno.user.id]: "employee" });
  expect((await api(`/api/companies/${company.id}`, { cookie: ana.cookie, method: "DELETE", body: { name: "Acme Corp" } })).status).toBe(204);
});

test("POST /api/companies/{companyId}/transfer-ownership answers 400 CONFIRMATION_MISMATCH for a name other than the current one, and nothing changes", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);
  await api(`/api/companies/${company.id}`, { cookie: ana.cookie, method: "PATCH", body: { name: "Acme Corp" } });

  for (const name of ["Acme", "acme corp", "Globex"]) {
    const response = await transfer(company.id, ana.cookie, { userId: bruno.user.id, name });
    expect(response.status, name).toBe(400);
    expect(await response.json()).toEqual({
      code: "CONFIRMATION_MISMATCH",
      message: "The confirmation does not match the Company's name.",
    });
  }
  for (const body of [{ userId: bruno.user.id }, { name: "Acme Corp" }, { userId: 42, name: "Acme Corp" }]) {
    const response = await transfer(company.id, ana.cookie, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "VALIDATION_FAILED", message: "The request is invalid." });
  }
  expect(await rolesOf(company.id)).toEqual({ [ana.user.id]: "owner", [bruno.user.id]: "employee" });
});

test("POST /api/companies/{companyId}/transfer-ownership answers 404 NOT_FOUND for someone who is not a Member, and refuses the Owner themself", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const mallory = await signedInUser("Mallory");
  const company = await createCompany(ana.cookie, "Acme");
  const other = await createCompany(mallory.cookie, "Globex");
  await join(company.id, bruno.user.id);
  await join(other.id, bruno.user.id);

  for (const userId of [mallory.user.id, randomUUID()]) {
    const response = await transfer(company.id, ana.cookie, { userId, name: "Acme" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
  }
  const self = await transfer(company.id, ana.cookie, { userId: ana.user.id, name: "Acme" });
  expect(self.status).toBe(400);
  expect(await self.json()).toEqual({ code: "VALIDATION_FAILED", message: "The request is invalid." });
  expect(await rolesOf(company.id)).toEqual({ [ana.user.id]: "owner", [bruno.user.id]: "employee" });
  expect(await rolesOf(other.id)).toEqual({ [mallory.user.id]: "owner", [bruno.user.id]: "employee" });
});

test("POST /api/companies/{companyId}/transfer-ownership answers 403 FORBIDDEN to an Employee or a Product's role, 404 to a non-Member and 401 without a session", async () => {
  await db.query(`INSERT INTO skeleton.member_roles (id) VALUES ('manager') ON CONFLICT DO NOTHING`);
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  const mallory = await signedInUser("Mallory");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);
  await join(company.id, carla.user.id, "manager");

  for (const { cookie, user } of [bruno, carla]) {
    const response = await transfer(company.id, cookie, { userId: user.id, name: "Acme" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FORBIDDEN", message: "Your role in this Company does not allow this." });
  }
  expect((await transfer(company.id, mallory.cookie, { userId: mallory.user.id, name: "Acme" })).status).toBe(404);
  const anonymous = await transfer(company.id, undefined, { userId: bruno.user.id, name: "Acme" });
  expect(anonymous.status).toBe(401);
  expect(await anonymous.json()).toEqual({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  expect(await rolesOf(company.id)).toEqual({ [ana.user.id]: "owner", [bruno.user.id]: "employee", [carla.user.id]: "manager" });
});

test("two transfers at once leave the Company with exactly one Owner", async () => {
  const ana = await signedInUser();
  const bruno = await signedInUser("Bruno Lima");
  const carla = await signedInUser("Carla Dias");
  const company = await createCompany(ana.cookie, "Acme");
  await join(company.id, bruno.user.id);
  await join(company.id, carla.user.id);

  const responses = await Promise.all(
    [bruno, carla].map(({ user }) => transfer(company.id, ana.cookie, { userId: user.id, name: "Acme" })),
  );

  expect(responses.map((response) => response.status).sort()).toEqual([200, 403]);
  const roles = Object.values(await rolesOf(company.id)).sort();
  expect(roles).toEqual(["employee", "employee", "owner"]);
  expect((await rolesOf(company.id))[ana.user.id]).toBe("employee");
});
