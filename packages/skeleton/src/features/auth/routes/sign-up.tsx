import { useForm } from "@tanstack/react-form";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "#ui/alert";
import { Button } from "#ui/button";
import { Input } from "#ui/input";
import { Label } from "#ui/label";
import { EMAIL_VERIFIED_PATH, authClient, orThrow } from "../../../client/auth.ts";
import { AuthCard } from "../../../client/components/auth-card.tsx";
import { useErrorMessage, useMessages } from "../../../client/i18n.tsx";

export const Route = createFileRoute("/sign-up")({ component: SignUp });

function SignUp() {
  const t = useMessages().auth.signUp;
  const errorMessage = useErrorMessage();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>();
  const form = useForm({
    defaultValues: { name: "", email: "", password: "" },
    onSubmit: async ({ value }) => {
      setError(undefined);
      try {
        await orThrow(authClient.signUp.email({ ...value, callbackURL: EMAIL_VERIFIED_PATH }));
      } catch (failure) {
        setError(failure);
        return;
      }
      await navigate({ to: "/check-email", search: { email: value.email } });
    },
  });

  return (
    <AuthCard title={t.title} description={t.description}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field name="name">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor={field.name}>{t.name}</Label>
              <Input
                id={field.name}
                autoComplete="name"
                required
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </div>
          )}
        </form.Field>
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
                autoComplete="new-password"
                aria-describedby="password-hint"
                required
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
              <p id="password-hint" className="text-muted-foreground text-xs">
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
