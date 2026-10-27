import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "#ui/alert";
import { Button } from "#ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { Input } from "#ui/input";
import { Label } from "#ui/label";
import { getCompanyQueryKey } from "../../gen/hooks/useGetCompany.ts";
import { getLastCompanyQueryKey } from "../../gen/hooks/useGetLastCompany.ts";
import { listCompaniesQueryKey } from "../../gen/hooks/useListCompanies.ts";
import { listMembersQueryKey } from "../../gen/hooks/useListMembers.ts";
import { useDeleteCompany } from "../../gen/hooks/useDeleteCompany.ts";
import { useRenameCompany } from "../../gen/hooks/useRenameCompany.ts";
import { useTransferOwnership } from "../../gen/hooks/useTransferOwnership.ts";
import { useErrorMessage, useMessages } from "../../client/i18n.tsx";
import { format } from "../../i18n/index.ts";
import { useMembers } from "./members.tsx";

type Company = { id: string; name: string };

/**
 * The Owner's actions on the Company page: rename it, transfer its ownership
 * and delete it. The page shows them to the Owner only; the API refuses anyone
 * else (403 `FORBIDDEN`).
 */
export function CompanySettings({ company }: { company: Company }) {
  const t = useMessages().companies.settings;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t.title}</h2>
        </CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-8">
        <RenameCompany company={company} />
        <TransferOwnership company={company} />
        <DeleteCompany company={company} />
      </CardContent>
    </Card>
  );
}

/**
 * Renames the Company; its id, and so its URL, stay. The API is the only judge
 * of a valid name; its answer replaces the Company in the cache, so the page's
 * title changes without a reload, and the switcher reloads its list.
 */
function RenameCompany({ company }: { company: Company }) {
  const t = useMessages().companies.settings.rename;
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const renameCompany = useRenameCompany({
    mutation: {
      onSuccess: async (renamed) => {
        queryClient.setQueryData(getCompanyQueryKey({ path: { companyId: renamed.id } }), renamed);
        await queryClient.invalidateQueries({ queryKey: listCompaniesQueryKey() });
      },
    },
  });
  const [saved, setSaved] = useState(false);
  const form = useForm({
    defaultValues: { name: company.name },
    onSubmit: async ({ value }) => {
      setSaved(false);
      try {
        const renamed = await renameCompany.mutateAsync({ path: { companyId: company.id }, body: { name: value.name } });
        // The name as saved, without the spaces around it.
        form.setFieldValue("name", renamed.name);
      } catch {
        return;
      }
      setSaved(true);
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
            <Label htmlFor="rename-company-name">{t.name}</Label>
            <Input
              id="rename-company-name"
              autoComplete="organization"
              aria-describedby="rename-company-name-hint"
              value={field.state.value}
              onChange={(event) => {
                setSaved(false);
                field.handleChange(event.target.value);
              }}
              onBlur={field.handleBlur}
            />
            <p id="rename-company-name-hint" className="text-muted-foreground text-xs">
              {t.nameHint}
            </p>
          </div>
        )}
      </form.Field>
      {renameCompany.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(renameCompany.error)}</AlertDescription>
        </Alert>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm">
          {t.saved}
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
  );
}

/**
 * Makes another Member the Owner once the Owner picks them and types the
 * Company's name (the API checks it again: `CONFIRMATION_MISMATCH`). The API
 * answers the Company with the user's new role, which hides these settings, and
 * the Members table reloads with the new roles.
 */
function TransferOwnership({ company }: { company: Company }) {
  const t = useMessages().companies.settings.transfer;
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const path = { companyId: company.id };
  const members = useMembers(company.id);
  // The Owner is the caller: every other Member may receive the Company.
  const candidates = (members.data?.pages ?? []).flatMap((page) => page.items).filter((member) => member.role !== "owner");
  const transferOwnership = useTransferOwnership({
    mutation: {
      onSuccess: async (transferred) => {
        queryClient.setQueryData(getCompanyQueryKey({ path }), transferred);
        await queryClient.invalidateQueries({ queryKey: listMembersQueryKey({ path }) });
        await queryClient.invalidateQueries({ queryKey: listCompaniesQueryKey() });
      },
    },
  });
  const form = useForm({
    defaultValues: { userId: "", name: "" },
    onSubmit: async ({ value }) => {
      await transferOwnership.mutateAsync({ path, body: { userId: value.userId, name: value.name } }).catch(() => undefined);
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
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">{t.title}</h3>
        <p className="text-muted-foreground text-sm">{t.description}</p>
      </div>
      <form.Field name="userId">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="transfer-ownership-recipient">{t.recipient}</Label>
            <select
              id="transfer-ownership-recipient"
              className="h-8 rounded-md border bg-background px-2"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            >
              <option value="" disabled>
                {t.choose}
              </option>
              {candidates.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {format(t.member, { name: member.name, email: member.email })}
                </option>
              ))}
            </select>
          </div>
        )}
      </form.Field>
      <form.Field name="name">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="transfer-ownership-name">{format(t.confirm, { name: company.name })}</Label>
            <Input
              id="transfer-ownership-name"
              autoComplete="off"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
          </div>
        )}
      </form.Field>
      {transferOwnership.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(transferOwnership.error)}</AlertDescription>
        </Alert>
      ) : null}
      <form.Subscribe
        selector={(state) => [state.isSubmitting, state.values.userId !== "" && state.values.name.trim() === company.name] as const}
      >
        {([isSubmitting, ready]) => (
          <Button type="submit" variant="destructive" className="self-start" disabled={isSubmitting || !ready}>
            {isSubmitting ? t.submitting : t.submit}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

/**
 * Deletes the Company for good, once the Owner types its name (the API checks
 * it again: `CONFIRMATION_MISMATCH`). Then the user goes to the signed-in root,
 * which opens another Company or, without one, asks to create one.
 */
function DeleteCompany({ company }: { company: Company }) {
  const t = useMessages().companies.settings.delete;
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const path = { companyId: company.id };
  const deleteCompany = useDeleteCompany({
    mutation: {
      onSuccess: async () => {
        queryClient.removeQueries({ queryKey: getLastCompanyQueryKey() });
        await queryClient.invalidateQueries({ queryKey: listCompaniesQueryKey() });
        await navigate({ to: "/" });
        queryClient.removeQueries({ queryKey: getCompanyQueryKey({ path }) });
        queryClient.removeQueries({ queryKey: listMembersQueryKey({ path }) });
      },
    },
  });
  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      await deleteCompany.mutateAsync({ path, body: { name: value.name } }).catch(() => undefined);
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
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">{t.title}</h3>
        <p className="text-muted-foreground text-sm">{t.description}</p>
      </div>
      <form.Field name="name">
        {(field) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="delete-company-name">{format(t.confirm, { name: company.name })}</Label>
            <Input
              id="delete-company-name"
              autoComplete="off"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
            />
          </div>
        )}
      </form.Field>
      {deleteCompany.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(deleteCompany.error)}</AlertDescription>
        </Alert>
      ) : null}
      <form.Subscribe selector={(state) => [state.isSubmitting, state.values.name.trim() === company.name] as const}>
        {([isSubmitting, confirmed]) => (
          <Button type="submit" variant="destructive" className="self-start" disabled={isSubmitting || !confirmed}>
            {isSubmitting ? t.submitting : t.submit}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
