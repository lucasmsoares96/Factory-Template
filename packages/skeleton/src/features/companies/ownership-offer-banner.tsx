import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "#ui/alert";
import { Button, buttonVariants } from "#ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { useAcceptOwnershipOffer } from "../../gen/hooks/useAcceptOwnershipOffer.ts";
import { getCompanyQueryKey } from "../../gen/hooks/useGetCompany.ts";
import { getOwnershipOfferQueryKey, useGetOwnershipOffer } from "../../gen/hooks/useGetOwnershipOffer.ts";
import { listCompaniesQueryKey } from "../../gen/hooks/useListCompanies.ts";
import { listMembersQueryKey } from "../../gen/hooks/useListMembers.ts";
import { errorCode, useErrorMessage, useMessages } from "../../client/i18n.tsx";
import { format } from "../../i18n/index.ts";

/** How many Seats a refused acceptance (`NOT_ENOUGH_SEATS`) says are short. */
function missingSeats(error: unknown): number | undefined {
  if (errorCode(error) !== "NOT_ENOUGH_SEATS" || typeof error !== "object" || error === null || !("data" in error)) return undefined;
  const { data } = error;
  return typeof data === "object" && data !== null && "missing" in data && typeof data.missing === "number" ? data.missing : undefined;
}

/**
 * The offer of the Company's ownership, shown to the Member it is offered to
 * (the page renders it for non-Owners; the API answers 404 to every Member but
 * the recipient, and the banner renders nothing). They
 * accept it here; with too few free Seats the API refuses and says how many are
 * short, and the banner links to Account › Plan.
 */
export function OwnershipOfferBanner({ companyId }: { companyId: string }) {
  const t = useMessages().ownershipOffer;
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const path = { companyId };
  const offer = useGetOwnershipOffer({ path }, { query: { retry: false } });
  const accept = useAcceptOwnershipOffer({
    mutation: {
      onSuccess: async (company) => {
        queryClient.setQueryData(getCompanyQueryKey({ path }), company);
        queryClient.removeQueries({ queryKey: getOwnershipOfferQueryKey({ path }) });
        await queryClient.invalidateQueries({ queryKey: listMembersQueryKey({ path }) });
        await queryClient.invalidateQueries({ queryKey: listCompaniesQueryKey() });
      },
    },
  });
  if (!offer.data) return null;
  const date = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: "medium" });
  const missing = missingSeats(accept.error);

  return (
    <Card data-testid="ownership-offer">
      <CardHeader>
        <CardTitle>
          <h2>{t.title}</h2>
        </CardTitle>
        <CardDescription>
          {format(t.description, { name: offer.data.offeredBy?.name ?? "", expires: date.format(new Date(offer.data.expiresAt)) })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {accept.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              {missing === undefined ? errorMessage(accept.error) : format(t.missing, { missing: String(missing) })}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={accept.isPending} onClick={() => accept.mutate({ path })}>
            {accept.isPending ? t.accepting : t.accept}
          </Button>
          {missing !== undefined ? (
            <Link to="/account/plan" className={buttonVariants({ variant: "link", size: "sm" })}>
              {t.managePlan}
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
