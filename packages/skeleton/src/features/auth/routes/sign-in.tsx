import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "#ui/alert";
import { Button, buttonVariants } from "#ui/button";
import { Input } from "#ui/input";
import { Label } from "#ui/label";
import { getMeQueryKey } from "../../../gen/hooks/useGetMe.ts";
import { authClient, orThrow, safeRedirect } from "../../../client/auth.ts";
import { AuthCard } from "../../../client/components/auth-card.tsx";
import { errorCode, useErrorMessage, useMessages } from "../../../client/i18n.tsx";

type SignInSearch = {
  /** Where to go once signed in (the page the visitor was sent here from). */
  redirect?: string;
  /** Set by the sign-out button. */
  signedOut?: true;
};

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
    signedOut: search.signedOut === true ? true : undefined,
  }),
  component: SignIn,
});

function SignIn() {
  const t = useMessages().auth.signIn;
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const [error, setError] = useState<unknown>();
  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      setError(undefined);
      try {
        await orThrow(authClient.signIn.email(value));
      } catch (failure) {
        setError(failure);
        return;
      }
      // The visitor's earlier 401 must not stand for the new session.
      queryClient.removeQueries({ queryKey: getMeQueryKey() });
      await navigate({ href: safeRedirect(search.redirect) });
    },
  });

  return (
    <AuthCard title={t.title} description={t.description}>
      {search.signedOut && !error ? (
        <p role="status" className="text-sm">
          {t.signedOut}
        </p>
      ) : null}
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
        <form.Field name="password">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor={field.name}>{t.password}</Label>
              <Input
                id={field.name}
                type="password"
                autoComplete="current-password"
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
        {errorCode(error) === "EMAIL_NOT_VERIFIED" ? (
          <Link
            to="/check-email"
            search={{ email: form.getFieldValue("email") }}
            className={buttonVariants({ variant: "outline" })}
          >
            {t.verifyEmail}
          </Link>
        ) : null}
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t.submitting : t.submit}
            </Button>
          )}
        </form.Subscribe>
      </form>
      <p className="text-muted-foreground text-sm">
        {t.noAccount}{" "}
        <Link to="/sign-up" className={buttonVariants({ variant: "link", size: "sm" })}>
          {t.signUp}
        </Link>
      </p>
    </AuthCard>
  );
}
