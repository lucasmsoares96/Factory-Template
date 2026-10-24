import { HttpResponse } from "msw";
import { getMeHandler } from "../../src/gen/msw/getMeHandler.ts";
import { getNavHandler } from "../../src/gen/msw/getNavHandler.ts";
import { listConnectionsHandler } from "../../src/gen/msw/listConnectionsHandler.ts";
import { revokeConnectionHandler } from "../../src/gen/msw/revokeConnectionHandler.ts";
import { format, messagesFor } from "../../src/i18n/index.ts";
import { renderSpa } from "../spa/render.tsx";
import { expect, test } from "../spa/test.ts";

const ana = { id: "user-1", name: "Ana Souza", email: "ana@example.com" };
const nav = (t = messagesFor("en")) => ({ entries: [{ label: t.account.nav, to: "/account" }] });

type Connection = { id: string; appName: string; createdAt: string; access: "read" | "write" };

/** `GET` and `DELETE /api/connections` over a list, as the Worker does: a revoked Connection leaves the next read. */
function connectionsApi(initial: Connection[]) {
  let connections = [...initial];
  const revoked: string[] = [];
  return {
    revoked,
    handlers: [
      listConnectionsHandler(() => HttpResponse.json({ connections, nextCursor: null })),
      revokeConnectionHandler(({ params }) => {
        revoked.push(String(params.id));
        connections = connections.filter((connection) => connection.id !== params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    ],
  };
}

const claude: Connection = { id: "grant-1", appName: "Claude", createdAt: "2026-10-20T12:00:00.000Z", access: "write" };
const cursor: Connection = { id: "grant-2", appName: "Cursor", createdAt: "2026-09-03T12:00:00.000Z", access: "read" };

test("the account page leads to Connections, which lists each agent with its date and access", async ({ worker }) => {
  const api = connectionsApi([claude, cursor]);
  worker.use(getMeHandler(ana), getNavHandler(nav()), ...api.handlers);
  const { screen, router, t } = await renderSpa({ path: "/account" });

  await screen.getByRole("link", { name: t.account.connections.link }).click();

  await expect.element(screen.getByRole("heading", { name: t.account.connections.title })).toBeVisible();
  expect(router.state.location.pathname).toBe("/account/connections");
  const m = t.account.connections;
  const rows = screen.getByRole("listitem");
  await expect.element(rows.nth(0).getByText("Claude", { exact: true })).toBeVisible();
  await expect
    .element(rows.nth(0).getByText(`${format(m.connectedOn, { date: "Oct 20, 2026" })} · ${m.write}`, { exact: true }))
    .toBeVisible();
  await expect.element(rows.nth(1).getByText("Cursor", { exact: true })).toBeVisible();
  await expect
    .element(rows.nth(1).getByText(`${format(m.connectedOn, { date: "Sep 3, 2026" })} · ${m.read}`, { exact: true }))
    .toBeVisible();
});

test("revoking asks for confirmation first; once confirmed the agent leaves the list", async ({ worker }) => {
  const api = connectionsApi([claude, cursor]);
  worker.use(getMeHandler(ana), getNavHandler(nav()), ...api.handlers);
  const { screen, t } = await renderSpa({ path: "/account/connections" });

  const claudeRow = screen.getByRole("listitem").filter({ hasText: "Claude" });
  await claudeRow.getByRole("button", { name: t.account.connections.revoke }).click();
  const confirmation = screen.getByRole("alertdialog", { name: format(t.account.connections.confirmTitle, { app: "Claude" }) });
  await expect.element(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: t.account.connections.cancel }).click();
  await expect.element(confirmation).not.toBeInTheDocument();
  expect(api.revoked).toEqual([]);

  await claudeRow.getByRole("button", { name: t.account.connections.revoke }).click();
  await screen.getByRole("alertdialog").getByRole("button", { name: t.account.connections.confirm }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent(format(t.account.connections.revoked, { app: "Claude" }));
  await expect.element(screen.getByRole("listitem").filter({ hasText: "Claude" })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("listitem").filter({ hasText: "Cursor" })).toBeVisible();
  expect(api.revoked).toEqual(["grant-1"]);
});

test("without Connections, the page says there are none", async ({ worker }) => {
  const t = messagesFor("pt-BR");
  worker.use(getMeHandler(ana), getNavHandler(nav(t)), ...connectionsApi([]).handlers);
  const { screen } = await renderSpa({ path: "/account/connections", locale: "pt-BR" });

  await expect.element(screen.getByRole("heading", { name: t.account.connections.title })).toBeVisible();
  await expect.element(screen.getByText(t.account.connections.empty)).toBeVisible();
  expect(screen.getByRole("listitem").elements()).toHaveLength(0);
});
