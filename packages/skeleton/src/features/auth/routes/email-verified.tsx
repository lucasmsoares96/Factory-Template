import { Link, createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { buttonVariants } from "#ui/button";
import { AuthCard } from "../../../client/components/auth-card.tsx";
import { useErrorMessage, useMessages } from "../../../client/i18n.tsx";

// Better Auth checks the emailed link (`/api/auth/verify-email`) and redirects
// here, with `?error=<code>` when the link was refused.
export const Route = createFileRoute("/email-verified")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: EmailVerified,
});

function EmailVerified() {
  const t = useMessages().auth.emailVerified;
  const errorMessage = useErrorMessage();
  const { error } = Route.useSearch();

  if (error) {
    return (
      <AuthCard title={t.failedTitle}>
        <Alert variant="destructive">
          <AlertDescription>{errorMessage({ code: error })}</AlertDescription>
        </Alert>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t.title} description={t.description}>
      <Link to="/sign-in" className={buttonVariants()}>
        {t.signIn}
      </Link>
    </AuthCard>
  );
}
