import { getHealthHandler, getHealthHandlerResponse503 } from "../../src/gen/msw/getHealthHandler.ts";
import { renderSpa } from "../spa/render.tsx";
import { expect, test } from "../spa/test.ts";

test("the home page shows the API status that GET /api/health returns", async () => {
  const { screen, t } = await renderSpa();

  await expect.element(screen.getByRole("heading", { name: t.home.title })).toBeVisible();
  await expect.element(screen.getByTestId("api-status")).toHaveTextContent(t.home.apiStatus.ok);
});

test("an API failure is shown translated by its code, never by the English message", async ({ worker }) => {
  worker.use(
    getHealthHandler(() =>
      getHealthHandlerResponse503({ code: "DATABASE_UNAVAILABLE", message: "The database is unavailable." }),
    ),
  );

  const { screen, t } = await renderSpa({ locale: "pt-BR" });

  await expect.element(screen.getByRole("alert")).toHaveTextContent(t.errors.DATABASE_UNAVAILABLE);
  await expect.element(screen.getByText("The database is unavailable.")).not.toBeInTheDocument();
});
