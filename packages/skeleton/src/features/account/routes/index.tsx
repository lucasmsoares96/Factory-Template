import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "#ui/alert";
import { Button } from "#ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { Input } from "#ui/input";
import { Label } from "#ui/label";
import { getMeQueryKey, useGetMe } from "../../../gen/hooks/useGetMe.ts";
import { useUpdateMe } from "../../../gen/hooks/useUpdateMe.ts";
import { useErrorMessage, useMessages } from "../../../client/i18n.tsx";
import { format } from "../../../i18n/index.ts";

// Under the signed-in layout, which has already loaded GET /api/me.
export const Route = createFileRoute("/_signed-in/account/")({ component: Account });

/**
 * The signed-in user changes their name. The API is the only judge of a valid
 * name (it answers VALIDATION_FAILED, shown translated); its answer replaces
 * `GET /api/me` in the cache, so the name on top and the home page's title
 * change without a reload.
 */
function Account() {
  const t = useMessages();
  const errorMessage = useErrorMessage();
  const { data: me } = useGetMe();
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
      </CardContent>
    </Card>
  );
}
