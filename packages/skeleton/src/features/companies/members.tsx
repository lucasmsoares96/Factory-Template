import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "#ui/alert";
import { Button } from "#ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { listMembers } from "../../gen/clients/listMembers.ts";
import { getCompanyQueryKey } from "../../gen/hooks/useGetCompany.ts";
import { getLastCompanyQueryKey } from "../../gen/hooks/useGetLastCompany.ts";
import { useGetMe } from "../../gen/hooks/useGetMe.ts";
import { listCompaniesQueryKey } from "../../gen/hooks/useListCompanies.ts";
import { listMembersQueryKey } from "../../gen/hooks/useListMembers.ts";
import { useChangeMemberRole } from "../../gen/hooks/useChangeMemberRole.ts";
import { useLeaveCompany } from "../../gen/hooks/useLeaveCompany.ts";
import { useRemoveMember } from "../../gen/hooks/useRemoveMember.ts";
import type { CompanyMember } from "../../gen/types/CompanyMember.ts";
import { useErrorMessage, useMessages } from "../../client/i18n.tsx";
import { format } from "../../i18n/index.ts";
import { useRoleLabel } from "./role-label.ts";

/**
 * The Company's Members, a page of `GET /api/companies/{companyId}/members` at
 * a time. The Owner (`isOwner`) also gets, on every other Member's row, the
 * choice of their role and Remove; nobody gets them on their own row. The API
 * refuses both to any other role (403 `FORBIDDEN`) and on one's own row.
 */
export function Members({ companyId, isOwner }: { companyId: string; isOwner: boolean }) {
  const t = useMessages();
  const m = t.companies.members;
  const errorMessage = useErrorMessage();
  const roleLabel = useRoleLabel();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const path = { companyId };
  const members = useInfiniteQuery({
    queryKey: [...listMembersQueryKey({ path }), "pages"],
    queryFn: ({ pageParam }) => listMembers({ path, query: pageParam ? { cursor: pageParam } : {} }),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const [done, setDone] = useState<string | null>(null);
  const refresh = { onSettled: () => queryClient.invalidateQueries({ queryKey: listMembersQueryKey({ path }) }) };
  const changeRole = useChangeMemberRole({ mutation: refresh });
  const remove = useRemoveMember({ mutation: refresh });
  const failed = [members, changeRole, remove].find((query) => query.isError);
  const busy = changeRole.isPending || remove.isPending;

  function startAction() {
    setDone(null);
    changeRole.reset();
    remove.reset();
  }

  async function onChangeRole(member: CompanyMember, role: string) {
    startAction();
    try {
      await changeRole.mutateAsync({ path: { companyId, userId: member.userId }, body: { role } });
    } catch {
      return;
    }
    setDone(format(m.roleChanged, { name: member.name, role: roleLabel(role) }));
  }

  async function onRemove(member: CompanyMember) {
    startAction();
    try {
      await remove.mutateAsync({ path: { companyId, userId: member.userId } });
    } catch {
      return;
    }
    setDone(format(m.removed, { name: member.name }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="members-title">{t.companies.page.members}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
        <table aria-labelledby="members-title" className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="py-2 font-medium">{t.companies.page.memberName}</th>
              <th scope="col" className="py-2 font-medium">{t.companies.page.memberEmail}</th>
              <th scope="col" className="py-2 font-medium">{t.companies.page.memberRole}</th>
              {isOwner ? (
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">{m.actions}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {members.data?.pages
              .flatMap((page) => page.items)
              .map((member) => {
                // Nobody changes or removes themselves: the Owner tries Leave instead, and is refused.
                const manageable = isOwner && me !== undefined && member.userId !== me.id;
                return (
                  <tr key={member.userId} className="border-t">
                    <td className="py-2">{member.name}</td>
                    <td className="py-2">{member.email}</td>
                    <td className="py-2">
                      {manageable ? (
                        <RoleChoice member={member} disabled={busy} onChange={(role) => void onChangeRole(member, role)} />
                      ) : (
                        roleLabel(member.role)
                      )}
                    </td>
                    {isOwner ? (
                      <td className="py-2">
                        {manageable ? (
                          <div className="flex justify-end">
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={busy}
                              aria-label={format(m.remove, { name: member.name })}
                              onClick={() => void onRemove(member)}
                            >
                              {m.removeButton}
                            </Button>
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
          </tbody>
        </table>
        {members.hasNextPage ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={members.isFetchingNextPage}
            onClick={() => void members.fetchNextPage()}
          >
            {t.companies.page.moreMembers}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * A Member's role, which the Owner changes on choosing another: the Skeleton's
 * roles but `owner`, plus the Member's own when the Product added it (shown as stored).
 */
function RoleChoice({ member, disabled, onChange }: { member: CompanyMember; disabled: boolean; onChange: (role: string) => void }) {
  const t = useMessages();
  const roleLabel = useRoleLabel();
  const assignable = Object.keys(t.companies.roles).filter((role) => role !== "owner");
  const roles = assignable.includes(member.role) ? assignable : [...assignable, member.role];

  return (
    <select
      aria-label={format(t.companies.members.roleOf, { name: member.name })}
      className="h-8 rounded-md border bg-background px-2"
      value={member.role}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {roles.map((role) => (
        <option key={role} value={role}>
          {roleLabel(role)}
        </option>
      ))}
    </select>
  );
}

/**
 * Leaves the Company: any Member may try, and the API refuses the Owner
 * (`OWNER_MUST_TRANSFER`, shown translated). Then the user goes to the
 * signed-in root, which opens another Company or, without one, asks to create one.
 */
export function LeaveCompany({ companyId }: { companyId: string }) {
  const t = useMessages().companies.leave;
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const path = { companyId };
  const leave = useLeaveCompany({
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t.title}</h2>
        </CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {leave.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(leave.error)}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          variant="destructive"
          className="self-start"
          disabled={leave.isPending}
          onClick={() => void leave.mutateAsync({ path }).catch(() => undefined)}
        >
          {leave.isPending ? t.submitting : t.submit}
        </Button>
      </CardContent>
    </Card>
  );
}
