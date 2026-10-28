import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "#ui/alert";
import { Button, buttonVariants } from "#ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { Input } from "#ui/input";
import { Label } from "#ui/label";
import { EMAIL_VERIFIED_PATH, SIGN_IN_PATH, authClient, orThrow } from "../../../client/auth.ts";
import { getMeQueryKey, useGetMe } from "../../../gen/hooks/useGetMe.ts";
import { useGetNav } from "../../../gen/hooks/useGetNav.ts";
import { useUpdateMe } from "../../../gen/hooks/useUpdateMe.ts";
import { errorCode, useErrorMessage, useMessages } from "../../../client/i18n.tsx";
import { format } from "../../../i18n/index.ts";

// Under the signed-in layout, which has already loaded GET /api/me.
export const Route = createFileRoute("/_signed-in/account/")({ component: Account });

function Account() {
  return (
    <div className="flex flex-col gap-6">
      <ChangeName />
      <ChangeEmail />
      <ChangePassword />
      <DeleteAccount />
    </div>
  );
}

/**
 * The signed-in user changes their name. The API is the only judge of a valid
 * name (it answers VALIDATION_FAILED, shown translated); its answer replaces
 * `GET /api/me` in the cache, so the name on top and the home page's title
 * change without a reload. It links to the Connections page.
 */
function ChangeName() {
  const t = useMessages();
  const errorMessage = useErrorMessage();
  const { data: me } = useGetMe();
  const nav = useGetNav();
  const queryClient = useQueryClient();
  const updateMe = useUpdateMe({
    mutation: { onSuccess: (user) => queryClient.setQueryData(getMeQueryKey(), user) },
  });
  const [saved, setSaved] = useState(false);
  const form = useForm({
    defaultValues: { name: me?.name ?? "" },
    onSubmit: async ({ value }) => {
      setSaved(false);
      try {
        const user = await updateMe.mutateAsync({ body: { name: value.name } });
        // The name as saved, without the spaces around it.
        form.setFieldValue("name", user.name);
      } catch {
        return;
      }
      setSaved(true);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t.account.title}</h1>
        </CardTitle>
        <CardDescription>{format(t.account.description, { appName: t.app.title })}</CardDescription>
      </CardHeader>
      <CardContent>
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
                <Label htmlFor={field.name}>{t.account.name}</Label>
                <Input
                  id={field.name}
                  autoComplete="name"
                  aria-describedby="name-hint"
                  value={field.state.value}
                  onChange={(event) => {
                    setSaved(false);
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                <p id="name-hint" className="text-muted-foreground text-xs">
                  {t.account.nameHint}
                </p>
              </div>
            )}
          </form.Field>
          {updateMe.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(updateMe.error)}</AlertDescription>
            </Alert>
          ) : null}
          {saved ? (
            <p role="status" className="text-sm">
              {t.account.saved}
            </p>
          ) : null}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" className="self-start" disabled={isSubmitting}>
                {isSubmitting ? t.account.submitting : t.account.submit}
              </Button>
            )}
          </form.Subscribe>
        </form>
        <Link to="/account/connections" className={`${buttonVariants({ variant: "link" })} mt-4 px-0`}>
          {t.account.connections.link}
        </Link>
        {nav.data?.accountPage.map((page) => (
          <Link key={page.to} to={page.to} className={`${buttonVariants({ variant: "link" })} mt-4 px-0`}>
            {page.label}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * The signed-in user changes their password with the current one. Better Auth
 * is the only judge (`INVALID_PASSWORD`, `PASSWORD_TOO_SHORT`, ... shown
 * translated). The Worker ends every other session and revokes the MCP
 * Connections; this browser gets a new session cookie and stays signed in.
 */
function ChangePassword() {
  const t = useMessages().account.password;
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<unknown>();
  const [changed, setChanged] = useState(false);
  const form = useForm({
    defaultValues: { currentPassword: "", newPassword: "" },
    onSubmit: async ({ value }) => {
      setError(undefined);
      setChanged(false);
      try {
        await orThrow(
          authClient.changePassword({ currentPassword: value.currentPassword, newPassword: value.newPassword }),
        );
      } catch (failure) {
        setError(failure);
        return;
      }
      form.reset();
      setChanged(true);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t.title}</h2>
        </CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="currentPassword">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor={field.name}>{t.current}</Label>
                <Input
                  id={field.name}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={field.state.value}
                  onChange={(event) => {
                    setChanged(false);
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
              </div>
            )}
          </form.Field>
          <form.Field name="newPassword">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor={field.name}>{t.new}</Label>
                <Input
                  id={field.name}
                  type="password"
                  autoComplete="new-password"
                  aria-describedby="new-password-hint"
                  required
                  value={field.state.value}
                  onChange={(event) => {
                    setChanged(false);
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                <p id="new-password-hint" className="text-muted-foreground text-xs">
                  {t.newHint}
                </p>
              </div>
            )}
          </form.Field>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(error)}</AlertDescription>
            </Alert>
          ) : null}
          {changed ? (
            <p role="status" className="text-sm">
              {t.changed}
            </p>
          ) : null}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" className="self-start" disabled={isSubmitting}>
                {isSubmitting ? t.submitting : t.submit}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The signed-in user asks to change their email through Better Auth
 * (`/api/auth/change-email`, outside the MCP). The link goes to the new address
 * and the email changes only when it is opened; until then `GET /api/me`
 * answers the address as `pendingEmail`, which this card shows.
 */
function ChangeEmail() {
  const t = useMessages();
  const errorMessage = useErrorMessage();
  const { data: me } = useGetMe();
  const queryClient = useQueryClient();
  const changeEmail = useMutation({
    mutationFn: (newEmail: string) => orThrow(authClient.changeEmail({ newEmail, callbackURL: EMAIL_VERIFIED_PATH })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getMeQueryKey() }),
  });
  const form = useForm({
    defaultValues: { newEmail: "" },
    onSubmit: async ({ value }) => {
      try {
        await changeEmail.mutateAsync(value.newEmail);
      } catch {
        return;
      }
      form.reset();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t.account.email}</h2>
        </CardTitle>
        <CardDescription data-testid="current-email">{format(t.account.currentEmail, { email: me?.email ?? "" })}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="newEmail">
            {(field) => (
              <div className="flex flex-col gap-2">
                <Label htmlFor={field.name}>{t.account.newEmail}</Label>
                <Input
                  id={field.name}
                  type="email"
                  required
                  autoComplete="email"
                  aria-describedby="new-email-hint"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
                <p id="new-email-hint" className="text-muted-foreground text-xs">
                  {t.account.newEmailHint}
                </p>
              </div>
            )}
          </form.Field>
          {changeEmail.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(changeEmail.error)}</AlertDescription>
            </Alert>
          ) : null}
          {me?.pendingEmail ? (
            <p role="status" data-testid="email-pending" className="text-sm">
              {format(t.account.emailPending, { email: me.pendingEmail, current: me.email })}
            </p>
          ) : null}
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" className="self-start" disabled={isSubmitting}>
                {isSubmitting ? t.account.changingEmail : t.account.changeEmail}
              </Button>
            )}
          </form.Subscribe>
        </form>
      </CardContent>
    </Card>
  );
}

type Company = { id: string; name: string };

/** The Companies a refused deletion names (`OWNER_OF_COMPANIES`), if the error is that one. */
function ownedCompanies(error: unknown): Company[] {
  if (errorCode(error) !== "OWNER_OF_COMPANIES" || typeof error !== "object" || error === null) return [];
  const companies = "companies" in error ? error.companies : undefined;
  return Array.isArray(companies) ? (companies as Company[]) : [];
}

/**
 * The signed-in user deletes their account, confirming with the password in a
 * form opened on purpose. The Worker is the only judge: it refuses an Owner
 * (`OWNER_OF_COMPANIES`, with the Companies, linked here to their pages where
 * they can be deleted) and a wrong password (`INVALID_PASSWORD`). Once deleted,
 * the user goes to the sign-in screen with nothing of theirs in the cache.
 */
function DeleteAccount() {
  const t = useMessages().account.delete;
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<unknown>();
  const form = useForm({
    defaultValues: { password: "" },
    onSubmit: async ({ value }) => {
      setError(undefined);
      try {
        await orThrow(authClient.deleteUser({ password: value.password }));
      } catch (failure) {
        setError(failure);
        return;
      }
      await navigate({ to: SIGN_IN_PATH, search: { accountDeleted: true } });
      queryClient.clear();
    },
  });
  const owned = ownedCompanies(error);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t.title}</h2>
        </CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {confirming ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="password">
              {(field) => (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="delete-account-password">{t.password}</Label>
                  <Input
                    id="delete-account-password"
                    type="password"
                    autoComplete="current-password"
                    aria-describedby="delete-account-password-hint"
                    required
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                  <p id="delete-account-password-hint" className="text-muted-foreground text-xs">
                    {t.passwordHint}
                  </p>
                </div>
              )}
            </form.Field>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>
                  <p>{errorMessage(error)}</p>
                  {owned.length > 0 ? (
                    <ul className="list-disc pl-5">
                      {owned.map((company) => (
                        <li key={company.id}>
                          <Link to="/c/$companyId" params={{ companyId: company.id }} className="underline">
                            {company.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <div className="flex gap-2">
                  <Button type="submit" variant="destructive" disabled={isSubmitting}>
                    {isSubmitting ? t.submitting : t.submit}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={() => {
                      setConfirming(false);
                      setError(undefined);
                      form.reset();
                    }}
                  >
                    {t.cancel}
                  </Button>
                </div>
              )}
            </form.Subscribe>
          </form>
        ) : (
          <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
            {t.start}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
