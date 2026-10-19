import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Outlet, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { Button } from "#ui/button";
import { getMeQueryOptions, useGetMe } from "../gen/hooks/useGetMe.ts";
import { SIGN_IN_PATH, authClient, orThrow } from "./auth.ts";
import { errorCode, useErrorMessage, useMessages } from "./i18n.tsx";

/**
 * The layout of every page that needs a signed-in user (the home page, and the
 * Product's feature routes). Before any of them loads it asks `GET /api/me`;
 * without a session the visitor goes to the sign-in screen, and comes back here
 * after signing in.
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
      <div className="flex items-center justify-end gap-3 text-sm">
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
