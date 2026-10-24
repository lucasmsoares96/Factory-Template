import { createFileRoute, redirect } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { getLastCompanyQueryOptions } from "../../../gen/hooks/useGetLastCompany.ts";
import { useGetMe } from "../../../gen/hooks/useGetMe.ts";
import { errorCode, useMessages } from "../../../client/i18n.tsx";
import { CreateCompanyForm } from "../../companies/create-company-form.tsx";
import { format } from "../../../i18n/index.ts";

// Under the signed-in layout, which has already loaded GET /api/me.
export const Route = createFileRoute("/_signed-in/")({
  // The signed-in root is where the user works: the Company they used last, or
  // the first they joined. Only a user without a Company stays here.
  beforeLoad: async ({ context }) => {
    let companyId: string;
    try {
      ({ id: companyId } = await context.queryClient.fetchQuery(getLastCompanyQueryOptions()));
    } catch (error) {
      if (errorCode(error) === "NOT_FOUND") return;
      throw error;
    }
    throw redirect({ to: "/c/$companyId", params: { companyId } });
  },
  component: Home,
});

/** A user in no Company yet: create one, or wait for an invitation. */
function Home() {
  const t = useMessages();
  const { data: me } = useGetMe();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{format(t.home.title, { name: me?.name ?? "" })}</h1>
        </CardTitle>
        <CardDescription>{t.home.noCompany}</CardDescription>
      </CardHeader>
      <CardContent>
        <CreateCompanyForm />
      </CardContent>
    </Card>
  );
}
