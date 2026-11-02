import { Outlet, createRootRouteWithContext, useMatches } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { useMessages } from "./i18n.tsx";

export type RouterContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RouterContext>()({ component: Root });

/**
 * The public screens (sign-in, invitation) sit in a narrow column under a
 * title bar; the signed-in area (`_signed-in`) brings its own sidebar layout
 * and uses the whole width.
 */
function Root() {
  const t = useMessages();
  const signedIn = useMatches({ select: (matches) => matches.some((match) => match.routeId === "/_signed-in") });
  if (signedIn) {
    return (
      <div className="min-h-svh bg-background text-foreground">
        <Outlet />
      </div>
    );
  }
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4 font-semibold">{t.app.title}</div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
