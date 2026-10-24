import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { Button, buttonVariants } from "#ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { listMembers } from "../../../../gen/clients/listMembers.ts";
import { useGetCompany } from "../../../../gen/hooks/useGetCompany.ts";
import { useGetNav } from "../../../../gen/hooks/useGetNav.ts";
import { listMembersQueryKey } from "../../../../gen/hooks/useListMembers.ts";
import { useErrorMessage, useMessages } from "../../../../client/i18n.tsx";
import { format } from "../../../../i18n/index.ts";
import { useRoleLabel } from "../../role-label.ts";

// The active Company comes from the URL, so two tabs can work in two Companies.
export const Route = createFileRoute("/_signed-in/c/$companyId/")({ component: CompanyPage });

/**
 * The Company page: its name and the user's role, the features' `companyPage`
 * sections (`GET /api/nav`) and the Members. Opening it makes it the Company the
 * user lands on next time (the API records it on `GET /api/companies/{companyId}`).
 */
function CompanyPage() {
  const t = useMessages();
  const errorMessage = useErrorMessage();
  const roleLabel = useRoleLabel();
  const { companyId } = Route.useParams();
  const company = useGetCompany({ path: { companyId } });
  const nav = useGetNav();

  if (company.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(company.error)}</AlertDescription>
      </Alert>
    );
  }
  if (!company.data) return null;
  const sections = nav.data?.companyPage ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{company.data.name}</h1>
          </CardTitle>
          <CardDescription>{format(t.companies.page.role, { role: roleLabel(company.data.role) })}</CardDescription>
        </CardHeader>
        {sections.length > 0 ? (
          <CardContent>
            <nav aria-label={t.companies.page.sections} className="flex flex-wrap gap-1">
              {sections.map((section) => (
                <Link
                  key={section.to}
                  to={`/c/${companyId}${section.to}` as string}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  {section.label}
                </Link>
              ))}
            </nav>
          </CardContent>
        ) : null}
      </Card>
      <Members companyId={companyId} />
    </div>
  );
}

function Members({ companyId }: { companyId: string }) {
  const t = useMessages();
  const errorMessage = useErrorMessage();
  const roleLabel = useRoleLabel();
  const path = { companyId };
  const members = useInfiniteQuery({
    queryKey: [...listMembersQueryKey({ path }), "pages"],
    queryFn: ({ pageParam }) => listMembers({ path, query: pageParam ? { cursor: pageParam } : {} }),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 id="members-title">{t.companies.page.members}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {members.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(members.error)}</AlertDescription>
          </Alert>
        ) : null}
        <table aria-labelledby="members-title" className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="py-2 font-medium">{t.companies.page.memberName}</th>
              <th scope="col" className="py-2 font-medium">{t.companies.page.memberEmail}</th>
              <th scope="col" className="py-2 font-medium">{t.companies.page.memberRole}</th>
            </tr>
          </thead>
          <tbody>
            {members.data?.pages
              .flatMap((page) => page.items)
              .map((member) => (
                <tr key={member.userId} className="border-t">
                  <td className="py-2">{member.name}</td>
                  <td className="py-2">{member.email}</td>
                  <td className="py-2">{roleLabel(member.role)}</td>
                </tr>
              ))}
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
