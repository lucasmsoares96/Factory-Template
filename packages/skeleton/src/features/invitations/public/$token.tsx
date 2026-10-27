import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { Button, buttonVariants } from "#ui/button";
import { SIGN_IN_PATH, authClient, orThrow } from "../../../client/auth.ts";
import { AuthCard } from "../../../client/components/auth-card.tsx";
import { errorCode, useErrorMessage, useMessages } from "../../../client/i18n.tsx";
import { useAcceptInvitation } from "../../../gen/hooks/useAcceptInvitation.ts";
import { getCompanyQueryKey } from "../../../gen/hooks/useGetCompany.ts";
import { useGetInvitationByToken } from "../../../gen/hooks/useGetInvitationByToken.ts";
import { useGetMe } from "../../../gen/hooks/useGetMe.ts";
import { listCompaniesQueryKey } from "../../../gen/hooks/useListCompanies.ts";
import { format } from "../../../i18n/index.ts";
import { useRoleLabel } from "../../companies/role-label.ts";

// The link of an Invitation email. Public: a visitor sees what they are invited
// to, then signs up or signs in and comes back here (`redirect`) to accept.
export const Route = createFileRoute("/invitations/$token")({ component: AcceptInvitation });

function AcceptInvitation() {
  const t = useMessages().invitations.accept;
  const errorMessage = useErrorMessage();
  const roleLabel = useRoleLabel();
  const { token } = Route.useParams();
  const here = `/invitations/${token}`;
  const invitation = useGetInvitationByToken({ path: { token } });
  const me = useGetMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const accept = useAcceptInvitation({
    mutation: {
      onSuccess: async (company) => {
        queryClient.setQueryData(getCompanyQueryKey({ path: { companyId: company.id } }), company);
        await queryClient.invalidateQueries({ queryKey: listCompaniesQueryKey() });
        await navigate({ to: "/c/$companyId", params: { companyId: company.id } });
      },
    },
  });
  const switchAccount = useMutation({
    mutationFn: () => orThrow(authClient.signOut()),
    onSuccess: async () => {
      await navigate({ to: SIGN_IN_PATH, search: { redirect: here } });
      queryClient.clear();
    },
  });

  if (invitation.isError) {
    const code = errorCode(invitation.error);
    return (
      <AuthCard title={t.failedTitle}>
        <Alert variant="destructive">
          <AlertDescription>{code === "NOT_FOUND" ? t.notFound : errorMessage(invitation.error)}</AlertDescription>
        </Alert>
      </AuthCard>
    );
  }
  // Without a session `/api/me` answers 401: the visitor is anonymous, not failing.
  const signedOut = me.isError && errorCode(me.error) === "UNAUTHENTICATED";
  if (!invitation.data || (!me.data && !me.isError)) return null;
  const { companyId, companyName, email, role, alreadyMember } = invitation.data;
  if (alreadyMember) return <Navigate to="/c/$companyId" params={{ companyId }} replace />;

  const failure = accept.error ?? switchAccount.error ?? (signedOut ? undefined : me.error);
  return (
    <AuthCard
      title={format(t.title, { companyName })}
      description={format(t.description, { companyName, role: roleLabel(role) })}
    >
      <p data-testid="invited-email" className="text-sm">
        {format(t.invitedEmail, { email })}
      </p>
      {failure ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(failure)}</AlertDescription>
        </Alert>
      ) : null}
      {signedOut ? (
        <>
          <p className="text-muted-foreground text-sm">{t.signedOut}</p>
          <Link to="/sign-up" search={{ redirect: here }} className={buttonVariants()}>
            {t.signUp}
          </Link>
          <Link to="/sign-in" search={{ redirect: here }} className={buttonVariants({ variant: "outline" })}>
            {t.signIn}
          </Link>
        </>
      ) : me.data && me.data.email.toLowerCase() !== email ? (
        <>
          <Alert>
            <AlertDescription>{format(t.wrongAccount, { email: me.data.email, invited: email })}</AlertDescription>
          </Alert>
          <Button disabled={switchAccount.isPending} onClick={() => switchAccount.mutate()}>
            {t.switchAccount}
          </Button>
        </>
      ) : (
        <Button disabled={accept.isPending} onClick={() => accept.mutate({ path: { token } })}>
          {accept.isPending ? t.submitting : t.submit}
        </Button>
      )}
    </AuthCard>
  );
}
