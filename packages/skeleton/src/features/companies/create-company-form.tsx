import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { Button } from "#ui/button";
import { Input } from "#ui/input";
import { Label } from "#ui/label";
import { getCompanyQueryKey } from "../../gen/hooks/useGetCompany.ts";
import { useCreateCompany } from "../../gen/hooks/useCreateCompany.ts";
import { listCompaniesQueryKey } from "../../gen/hooks/useListCompanies.ts";
import { useErrorMessage, useMessages } from "../../client/i18n.tsx";

/**
 * Creates a Company and enters it: the user is its Owner. The API is the only
 * judge of a valid name (it answers VALIDATION_FAILED, shown translated).
 */
export function CreateCompanyForm() {
  const t = useMessages();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createCompany = useCreateCompany({
    mutation: {
      onSuccess: async (company) => {
        queryClient.setQueryData(getCompanyQueryKey({ path: { companyId: company.id } }), company);
        await queryClient.invalidateQueries({ queryKey: listCompaniesQueryKey() });
        await navigate({ to: "/c/$companyId", params: { companyId: company.id } });
      },
    },
  });
  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      await createCompany.mutateAsync({ body: { name: value.name } }).catch(() => undefined);
    },
  });

  return (
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
            <Label htmlFor="company-name">{t.companies.create.name}</Label>
            <Input
              id="company-name"
              autoComplete="organization"
              aria-describedby="company-name-hint"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
            <p id="company-name-hint" className="text-muted-foreground text-xs">
              {t.companies.create.nameHint}
            </p>
          </div>
        )}
      </form.Field>
      {createCompany.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(createCompany.error)}</AlertDescription>
        </Alert>
      ) : null}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" className="self-start" disabled={isSubmitting}>
            {isSubmitting ? t.companies.create.submitting : t.companies.create.submit}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
