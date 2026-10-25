import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { useMessages } from "../../../client/i18n.tsx";
import { CreateCompanyForm } from "../create-company-form.tsx";

// Opened from the Company switcher's New Company.
export const Route = createFileRoute("/_signed-in/c/new")({ component: NewCompany });

function NewCompany() {
  const t = useMessages();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t.companies.create.title}</h1>
        </CardTitle>
        <CardDescription>{t.companies.create.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <CreateCompanyForm />
      </CardContent>
    </Card>
  );
}
