import { useForm } from "@tanstack/react-form";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "#ui/alert";
import { Button, buttonVariants } from "#ui/button";
import { Input } from "#ui/input";
import { Label } from "#ui/label";
import { SIGN_IN_PATH, authClient, orThrow } from "../../../client/auth.ts";
import { AuthCard } from "../../../client/components/auth-card.tsx";
import { errorCode, useErrorMessage, useMessages } from "../../../client/i18n.tsx";

type ResetPasswordSearch = {
  /** Set by Better Auth when the emailed link's token is valid. */
  token?: string;
  /** Set by Better Auth when it refused the link (`INVALID_TOKEN`). */
  error?: string;
};

// The emailed link goes through `/api/auth/reset-password/<token>`, which checks
// the token and redirects here with `?token=` or `?error=`. Saving the new
// password ends every session the user had open.
export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => ({
    token: typeof search.token === "string" ? search.token : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const t = useMessages().auth.resetPassword;
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [error, setError] = useState<unknown>();
  const form = useForm({
    defaultValues: { newPassword: "" },
    onSubmit: async ({ value }) => {
      setError(undefined);
      try {
        await orThrow(authClient.resetPassword({ newPassword: value.newPassword, token: search.token }));
      } catch (failure) {
        setError(failure);
        return;
      }
      await navigate({ to: SIGN_IN_PATH, search: { passwordReset: true } });
    },
  });
  const requestNew = (
    <Link to="/forgot-password" className={buttonVariants({ variant: "outline" })}>
      {t.requestNew}
    </Link>
  );

  if (search.error || !search.token) {
    return (
      <AuthCard title={t.failedTitle}>
        <Alert variant="destructive">
          <AlertDescription>{errorMessage({ code: search.error ?? "INVALID_TOKEN" })}</AlertDescription>
        </Alert>
        {requestNew}
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t.title} description={t.description}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="newPassword">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor={field.name}>{t.password}</Label>
              <Input
                id={field.name}
                type="password"
                autoComplete="new-password"
                aria-describedby="new-password-hint"
                required
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
              <p id="new-password-hint" className="text-muted-foreground text-xs">
                {t.passwordHint}
              </p>
            </div>
          )}
        </form.Field>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(error)}</AlertDescription>
          </Alert>
        ) : null}
        {errorCode(error) === "INVALID_TOKEN" ? requestNew : null}
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t.submitting : t.submit}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </AuthCard>
  );
}
