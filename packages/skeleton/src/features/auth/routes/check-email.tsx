import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { Button } from "#ui/button";
import { authClient, emailVerifiedURL, orThrow } from "../../../client/auth.ts";
import { AuthCard } from "../../../client/components/auth-card.tsx";
import { useErrorMessage, useMessages } from "../../../client/i18n.tsx";
import { format } from "../../../i18n/index.ts";

export const Route = createFileRoute("/check-email")({
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === "string" ? search.email : "",
    // Where to go once verified and signed in: the verification link carries it.
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: CheckEmail,
});

function CheckEmail() {
  const messages = useMessages();
  const t = messages.auth.checkEmail;
  const errorMessage = useErrorMessage();
  const { email, redirect } = Route.useSearch();
  const resend = useMutation({
    mutationFn: () => orThrow(authClient.sendVerificationEmail({ email, callbackURL: emailVerifiedURL(redirect) })),
  });

  return (
    <AuthCard title={t.title} description={format(t.description, { email, appName: messages.app.title })}>
      {resend.isSuccess ? (
        <p role="status" className="text-sm">
          {t.resent}
        </p>
      ) : null}
      {resend.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(resend.error)}</AlertDescription>
        </Alert>
      ) : null}
      <Button variant="outline" disabled={!email || resend.isPending} onClick={() => resend.mutate()}>
        {resend.isPending ? t.resending : t.resend}
      </Button>
    </AuthCard>
  );
}
