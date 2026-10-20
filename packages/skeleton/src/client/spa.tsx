import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter, type AnyRoute, type RouterHistory } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { messagesFor, resolveLocale, type MessageOverrides, type Messages } from "../i18n/index.ts";
import { MessagesProvider, errorCode } from "./i18n.tsx";

export type SpaOptions<TRouteTree extends AnyRoute> = {
  /** The composition's generated `routeTree.gen.ts`. */
  routeTree: TRouteTree;
  messages: Messages;
  /** Browser history by default; tests pass a memory history. */
  history?: RouterHistory;
  queryClient?: QueryClient;
};

/** One QueryClient per SPA. An answer from the API (it has a `code`) is final: no retry. */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: (failures, error) => errorCode(error) === undefined && failures < 2 },
    },
  });
}

/** The SPA: TanStack Router over the route tree, TanStack Query and the i18n texts. */
export function createSpa<TRouteTree extends AnyRoute>({
  routeTree,
  messages,
  history,
  queryClient = createQueryClient(),
}: SpaOptions<TRouteTree>) {
  const router = createRouter({ routeTree, history, context: { queryClient }, defaultPreload: "intent" });
  function Spa() {
    return (
      <StrictMode>
        <MessagesProvider messages={messages}>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </MessagesProvider>
      </StrictMode>
    );
  }
  return { router, Spa };
}

/**
 * A Product's `main.tsx`: renders the SPA into `#root` in the build's locale
 * (`LOCALE`, set by the Skeleton's Vite plugin) with the Product's texts on top.
 */
export function mountSpa<TRouteTree extends AnyRoute>({
  routeTree,
  messages,
}: {
  routeTree: TRouteTree;
  messages?: MessageOverrides;
}) {
  const locale = resolveLocale(import.meta.env.LOCALE);
  document.documentElement.lang = locale;
  const spa = createSpa({ routeTree, messages: messagesFor(locale, messages) });
  createRoot(document.getElementById("root")!).render(<spa.Spa />);
  return spa.router;
}
