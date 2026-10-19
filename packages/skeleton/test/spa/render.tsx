import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "vitest-browser-react";
import { createSpa } from "../../src/client/index.ts";
import { messagesFor, type Locale } from "../../src/i18n/index.ts";
import { routeTree } from "./routeTree.gen.ts";

/** Renders the Skeleton's SPA (real router and QueryClient) at `path`, in `locale`. */
export async function renderSpa({ path = "/", locale = "en" }: { path?: string; locale?: Locale } = {}) {
  const messages = messagesFor(locale);
  const { Spa, router } = createSpa({
    routeTree,
    messages,
    history: createMemoryHistory({ initialEntries: [path] }),
    queryClient: new QueryClient(),
  });
  const screen = await render(<Spa />);
  return { screen, router, t: messages };
}
