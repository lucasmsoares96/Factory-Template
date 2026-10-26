import { useForm } from "@tanstack/react-form";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, AlertDescription } from "#ui/alert";
import { Button } from "#ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { Input } from "#ui/input";
import { Label } from "#ui/label";
import { listInvitations } from "../../gen/clients/listInvitations.ts";
import { useCancelInvitation } from "../../gen/hooks/useCancelInvitation.ts";
import { useCreateInvitation } from "../../gen/hooks/useCreateInvitation.ts";
import { listInvitationsQueryKey } from "../../gen/hooks/useListInvitations.ts";
import { useResendInvitation } from "../../gen/hooks/useResendInvitation.ts";
import type { Invitation } from "../../gen/types/Invitation.ts";
import { useErrorMessage, useMessages } from "../../client/i18n.tsx";
import { format } from "../../i18n/index.ts";
import { useRoleLabel } from "../companies/role-label.ts";

/**
 * The Owner's Invitations, a section of the Company page: the form that invites
 * an address with a role, and the pending Invitations, a page of
 * `GET /api/companies/{companyId}/invitations` at a time, each with Resend and
 * Cancel. The Company page shows it to the Owner only; the API refuses anyone else.
 */
export function InvitationsSection({ companyId }: { companyId: string }) {
  const t = useMessages();
  const m = t.invitations;
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const path = { companyId };
  const pending = useInfiniteQuery({
    queryKey: [...listInvitationsQueryKey({ path }), "pages"],
    queryFn: ({ pageParam, signal }) => listInvitations({ path, query: pageParam ? { cursor: pageParam } : {}, signal }),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const [done, setDone] = useState<string | null>(null);
  const refresh = { onSettled: () => queryClient.invalidateQueries({ queryKey: listInvitationsQueryKey({ path }) }) };
  const create = useCreateInvitation({ mutation: refresh });
  const resend = useResendInvitation({ mutation: refresh });
  const cancel = useCancelInvitation({ mutation: refresh });
  const failed = [pending, create, resend, cancel].find((query) => query.isError);
  const items = pending.data?.pages.flatMap((page) => page.items) ?? [];

  function startAction() {
    setDone(null);
    for (const mutation of [create, resend, cancel]) mutation.reset();
  }

  async function act(invitation: Invitation, action: "resend" | "cancel") {
    startAction();
    const mutation = action === "resend" ? resend : cancel;
    try {
      await mutation.mutateAsync({ path: { companyId, invitationId: invitation.id } });
    } catch {
      return;
    }
    setDone(format(action === "resend" ? m.resent : m.canceled, { email: invitation.email }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{m.title}</h2>
        </CardTitle>
        <CardDescription>{m.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <InviteForm
          submit={async (body) => {
            startAction();
            try {
              await create.mutateAsync({ path, body });
            } catch {
              return false;
            }
            setDone(format(m.sent, { email: body.email }));
            return true;
          }}
        />
        {done ? (
          <p role="status" className="text-sm">
            {done}
          </p>
        ) : null}
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(failed.error)}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-col gap-2">
          <h3 id="pending-invitations-title" className="font-medium">
            {m.pending}
          </h3>
          {pending.isSuccess && items.length === 0 ? <p className="text-muted-foreground text-sm">{m.empty}</p> : null}
          {items.length > 0 ? (
            <PendingTable
              items={items}
              busy={resend.isPending || cancel.isPending}
              onResend={(invitation) => void act(invitation, "resend")}
              onCancel={(invitation) => void act(invitation, "cancel")}
            />
          ) : null}
          {pending.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={pending.isFetchingNextPage}
              onClick={() => void pending.fetchNextPage()}
            >
              {m.more}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** The roles an Invitation may carry: the Skeleton's, never `owner`. */
function invitableRoles(roles: Record<string, string>) {
  return Object.keys(roles).filter((role) => role !== "owner");
}

/**
 * Invites an address with a role. The API is the only judge of a valid email
 * and role (it answers VALIDATION_FAILED, shown translated); the form clears
 * once the Invitation is sent.
 */
function InviteForm({ submit }: { submit: (body: { email: string; role: string }) => Promise<boolean> }) {
  const t = useMessages();
  const roleLabel = useRoleLabel();
  const roles = invitableRoles(t.companies.roles);
  const form = useForm({
    defaultValues: { email: "", role: roles[0] ?? "employee" },
    onSubmit: async ({ value, formApi }) => {
      if (await submit(value)) formApi.reset();
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
      <div className="flex flex-wrap items-end gap-4">
        <form.Field name="email">
          {(field) => (
            <div className="flex min-w-64 flex-1 flex-col gap-2">
              <Label htmlFor="invitation-email">{t.invitations.email}</Label>
              <Input
                id="invitation-email"
                type="email"
                autoComplete="off"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="role">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="invitation-role">{t.invitations.role}</Label>
              <select
                id="invitation-role"
                className="h-8 rounded-md border bg-background px-2"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              >
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </form.Field>
      </div>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" className="self-start" disabled={isSubmitting}>
            {isSubmitting ? t.invitations.submitting : t.invitations.submit}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

function PendingTable({
  items,
  busy,
  onResend,
  onCancel,
}: {
  items: Invitation[];
  busy: boolean;
  onResend: (invitation: Invitation) => void;
  onCancel: (invitation: Invitation) => void;
}) {
  const m = useMessages().invitations;
  const roleLabel = useRoleLabel();
  // The SPA sets the page's language to the build locale.
  const date = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: "medium" });

  return (
    <table aria-labelledby="pending-invitations-title" className="w-full text-left text-sm">
      <thead className="text-muted-foreground">
        <tr>
          <th scope="col" className="py-2 pr-4 font-medium">{m.email}</th>
          <th scope="col" className="py-2 pr-4 font-medium">{m.role}</th>
          <th scope="col" className="py-2 pr-4 font-medium">{m.invitedBy}</th>
          <th scope="col" className="py-2 pr-4 font-medium">{m.expires}</th>
          <th scope="col" className="py-2 font-medium">
            <span className="sr-only">{m.actions}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((invitation) => (
          <tr key={invitation.id} className="border-t">
            <td className="py-2 pr-4">{invitation.email}</td>
            <td className="py-2 pr-4">{roleLabel(invitation.role)}</td>
            <td className="py-2 pr-4">{invitation.invitedBy?.name ?? m.deletedInviter}</td>
            <td className="py-2 pr-4">{date.format(new Date(invitation.expiresAt))}</td>
            <td className="py-2 pr-4">
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => onResend(invitation)}>
                  {m.resend}
                </Button>
                <Button variant="destructive" size="sm" disabled={busy} onClick={() => onCancel(invitation)}>
                  {m.cancel}
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
