import { Link, createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { buttonVariants } from "#ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { useGetCompany } from "../../../../gen/hooks/useGetCompany.ts";
import { useGetSeats } from "../../../../gen/hooks/useGetSeats.ts";
import { useListCompanies } from "../../../../gen/hooks/useListCompanies.ts";
import { useGetNav } from "../../../../gen/hooks/useGetNav.ts";
import { errorCode, useErrorMessage, useMessages } from "../../../../client/i18n.tsx";
import { format } from "../../../../i18n/index.ts";
import { CompanySettings } from "../../company-settings.tsx";
import { OwnershipOfferBanner } from "../../ownership-offer-banner.tsx";
import { Members } from "../../members.tsx";
import { InvitationsSection } from "../../../invitations/invitations-section.tsx";
import { useRoleLabel } from "../../role-label.ts";

// The active Company comes from the URL, so two tabs can work in two Companies.
export const Route = createFileRoute("/_signed-in/c/$companyId/")({ component: CompanyPage });

/**
 * The Company page: its name and the user's role, the features' `companyPage`
 * sections (`GET /api/nav`), the Members (with the Owner's actions on them), for
 * the Owner only the Invitations and the settings (rename, delete, offer the ownership).
 * A Member the ownership is offered to sees the offer first, to accept it.
 * Opening it makes it the Company the user lands on next time (the API records
 * it on `GET /api/companies/{companyId}`).
 */
function CompanyPage() {
  const t = useMessages();
  const errorMessage = useErrorMessage();
  const roleLabel = useRoleLabel();
  const { companyId } = Route.useParams();
  const company = useGetCompany({ path: { companyId } });
  const nav = useGetNav();
  const isOwner = company.data?.role === "owner";
  // Billing is off (404) where the Worker has no Stripe key: then there is no Seat to show.
  const seats = useGetSeats({ query: { enabled: isOwner, retry: false } });

  if (company.isError && errorCode(company.error) === "MEMBER_SUSPENDED") return <SuspendedAccess companyId={companyId} />;
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
          <CardDescription data-testid="company-role">{format(t.companies.page.role, { role: roleLabel(company.data.role) })}</CardDescription>
        </CardHeader>
        {isOwner && seats.data ? (
          <CardContent data-testid="company-seats" className="flex flex-wrap items-center gap-2 text-sm">
            <span data-testid="company-seats-usage">
              {seats.data.total === null
                ? format(t.billing.seatsUsageUnlimited, { used: String(seats.data.used) })
                : format(t.billing.seatsUsage, { used: String(seats.data.used), total: String(seats.data.total) })}
            </span>
            <Link to="/account/plan" className={buttonVariants({ variant: "link", size: "sm" })}>
              {t.billing.seatsManage}
            </Link>
          </CardContent>
        ) : null}
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
      {isOwner ? null : <OwnershipOfferBanner key={`offer-${companyId}`} companyId={companyId} />}
      <Members key={`members-${companyId}`} companyId={companyId} isOwner={company.data.role === "owner"} />
      {company.data.role === "owner" ? <InvitationsSection companyId={companyId} /> : null}
      {/* The Owner's actions; the API refuses them to any other role. A new key resets the forms in another Company. */}
      {company.data.role === "owner" ? <CompanySettings key={`settings-${companyId}`} company={company.data} /> : null}
    </div>
  );
}

/**
 * What a Suspended Member sees instead of the Company: the API answers 403 `MEMBER_SUSPENDED` on every route of the
 * Company. Their other Companies are untouched.
 */
function SuspendedAccess({ companyId }: { companyId: string }) {
  const t = useMessages();
  // The Company's name comes from the user's list (the switcher loads it), as the Company route itself refuses them.
  const companies = useListCompanies();
  const name = companies.data?.items.find((candidate) => candidate.id === companyId)?.name;

  return (
    <div className="flex flex-col gap-6">
      <Card data-testid="company-suspended">
        <CardHeader>
          <CardTitle>
            <h1>{name === undefined ? t.errors.MEMBER_SUSPENDED : format(t.companies.suspended.title, { name })}</h1>
          </CardTitle>
          <CardDescription>{t.companies.suspended.description}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
