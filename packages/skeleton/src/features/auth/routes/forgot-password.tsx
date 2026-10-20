import { useForm } from "@tanstack/react-form";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "#ui/alert";
import { Button, buttonVariants } from "#ui/button";
import { Input } from "#ui/input";
import { Label } from "#ui/label";
import { RESET_PASSWORD_PATH, authClient, orThrow } from "../../../client/auth.ts";
import { AuthCard } from "../../../client/components/auth-card.tsx";
import { useErrorMessage, useMessages } from "../../../client/i18n.tsx";
import { format } from "../../../i18n/index.ts";

export const Route = createFileRoute("/forgot-password")({
  validateSearch: (search: Record<string, unknown>): { email?: string } => ({
    email: typeof search.email === "string" ? search.email : undefined,
  }),
  component: ForgotPassword,
});

// The API answers alike whether the email has an account or not, so the screen
// says the same either way.
function ForgotPassword() {
  const t = useMessages().auth.forgotPassword;
  const errorMessage = useErrorMessage();
  const search = Route.useSearch();
  const [error, setError] = useState<unknown>();
  const [sentTo, setSentTo] = useState<string>();
  const form = useForm({
    defaultValues: { email: search.email ?? "" },
    onSubmit: async ({ value }) => {
      setError(undefined);
      try {
        await orThrow(authClient.requestPasswordReset({ email: value.email, redirectTo: RESET_PASSWORD_PATH }));
      } catch (failure) {
        setError(failure);
        return;
      }
      setSentTo(value.email);
    },
  });

  return (
    <AuthCard title={t.title} description={t.description}>
      {sentTo ? (
        <p role="status" className="text-sm">
          {format(t.sent, { email: sentTo })}
        </p>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="email">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor={field.name}>{t.email}</Label>
                <Input
                  id={field.name}
                  type="email"
                  autoComplete="email"
                  required
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(error)}</AlertDescription>
            </Alert>
          ) : null}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t.submitting : t.submit}
              </Button>
            )}
          </form.Subscribe>
        </form>
      )}
      <Link to="/sign-in" className={buttonVariants({ variant: "link", size: "sm" })}>
        {t.backToSignIn}
      </Link>
    </AuthCard>
  );
}
