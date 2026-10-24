import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { Button, buttonVariants } from "#ui/button";
import { CompanySwitcher } from "../features/companies/switcher.tsx";
import { getMeQueryOptions, useGetMe } from "../gen/hooks/useGetMe.ts";
import { useGetNav } from "../gen/hooks/useGetNav.ts";
import { SIGN_IN_PATH, authClient, orThrow } from "./auth.ts";
import { errorCode, useErrorMessage, useMessages } from "./i18n.tsx";

/**
 * The layout of every page that needs a signed-in user (the home page, the
 * account page, and the Product's feature routes). Before any of them loads it
 * asks `GET /api/me`; without a session the visitor goes to the sign-in screen,
 * and comes back here after signing in. Its navigation shows home and the
 * features' `nav` entries (`GET /api/nav`): the Skeleton's and the Product's,
 * and the Company switcher.
 */
export const Route = createFileRoute("/_signed-in")({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(getMeQueryOptions());
    } catch (error) {
      if (errorCode(error) !== "UNAUTHENTICATED") throw error;
      throw redirect({ to: SIGN_IN_PATH, search: location.href === "/" ? {} : { redirect: location.href } });
    }
  },
  errorComponent: SignedInError,
  component: SignedIn,
});

function SignedIn() {
  const t = useMessages();
  const errorMessage = useErrorMessage();
  const me = useGetMe();
  const nav = useGetNav();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: () => orThrow(authClient.signOut()),
    onSuccess: async () => {
      await navigate({ to: SIGN_IN_PATH, search: { signedOut: true } });
      queryClient.clear();
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <nav aria-label={t.nav.label} className="flex flex-1 flex-wrap items-center gap-1">
          {[{ label: t.nav.home, to: "/" }, ...(nav.data?.entries ?? [])].map((entry) => (
            <Link
              key={entry.to}
              to={entry.to}
              activeOptions={{ exact: entry.to === "/" }}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              activeProps={{ className: "bg-muted" }}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
        <CompanySwitcher />
        <span data-testid="user-name" className="text-muted-foreground">
          {me.data?.name}
        </span>
        <Button variant="outline" size="sm" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          {t.auth.signOut}
        </Button>
      </div>
      {signOut.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(signOut.error)}</AlertDescription>
        </Alert>
      ) : null}
      <Outlet />
    </div>
  );
}

function SignedInError({ error }: { error: unknown }) {
  const errorMessage = useErrorMessage();
  return (
    <Alert variant="destructive">
      <AlertDescription>{errorMessage(error)}</AlertDescription>
    </Alert>
  );
}
