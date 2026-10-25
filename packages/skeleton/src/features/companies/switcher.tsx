import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { buttonVariants } from "#ui/button";
import { useListCompanies } from "../../gen/hooks/useListCompanies.ts";
import { useMessages } from "../../client/i18n.tsx";

/**
 * The signed-in shell's Company switcher: the user's Companies (the first page
 * of `GET /api/companies`), the active one being the Company of the URL.
 * Choosing another opens its page; New Company opens the creation form.
 */
export function CompanySwitcher() {
  const t = useMessages();
  const navigate = useNavigate();
  const { companyId } = useParams({ strict: false }) as { companyId?: string };
  const companies = useListCompanies();
  const items = companies.data?.items ?? [];

  return (
    <div className="flex items-center gap-2">
      {items.length > 0 ? (
        <>
          <label htmlFor="company-switcher" className="text-muted-foreground">
            {t.companies.switcher.label}
          </label>
          <select
            id="company-switcher"
            className="h-8 rounded-md border bg-background px-2"
            value={companyId ?? ""}
            onChange={(event) => void navigate({ to: "/c/$companyId", params: { companyId: event.target.value } })}
          >
            {companyId === undefined ? (
              <option value="" disabled>
                {t.companies.switcher.choose}
              </option>
            ) : null}
            {items.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
      <Link to="/c/new" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        {t.companies.switcher.new}
      </Link>
    </div>
  );
}
