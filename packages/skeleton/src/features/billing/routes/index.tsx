import { Link, createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { Button, buttonVariants } from "#ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { useGetPlan } from "../../../gen/hooks/useGetPlan.ts";
import { useSubscribePlan } from "../../../gen/hooks/useSubscribePlan.ts";
import type { Plan } from "../../../gen/types/Plan.ts";
import { useErrorMessage, useMessages } from "../../../client/i18n.tsx";
import { format } from "../../../i18n/index.ts";

export const Route = createFileRoute("/_signed-in/account/plan/")({ component: PlanPage });

/**
 * Account › Plan: the Plan the person is on and the Plans the Product sells, from
 * `GET /api/billing/plan`. A fixed monthly Plan can be bought while the person is
 * on the free one: Subscribe opens Stripe's Checkout (the API answers its URL), and
 * the page they come back to reads the Plan again.
 */
function PlanPage() {
  const t = useMessages();
  const m = t.billing;
  const errorMessage = useErrorMessage();
  const state = useGetPlan();
  const subscribe = useSubscribePlan();
  const language = document.documentElement.lang || undefined;
  const money = (price: NonNullable<Plan["price"]>) =>
    format(m.perMonth, { amount: new Intl.NumberFormat(language, { style: "currency", currency: price.currency }).format(price.amount / 100) });
  const date = (iso: string) => new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(iso));
  const seats = (plan: Plan) =>
    plan.seats === null ? m.perSeat : format(plan.seats === 1 ? m.seatsOne : m.seatsOther, { count: String(plan.seats) });

  async function start(plan: Plan) {
    try {
      const checkout = await subscribe.mutateAsync({ body: { plan: plan.id } });
      window.location.assign(checkout.url);
    } catch {
      return;
    }
  }

  const current = state.data?.plan;
  const subscription = state.data?.subscription;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{m.title}</h1>
          </CardTitle>
          <CardDescription>{format(m.description, { appName: t.app.title })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {state.isError || subscribe.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(state.error ?? subscribe.error)}</AlertDescription>
            </Alert>
          ) : null}
          {state.isSuccess ? (
            current ? (
              <section aria-labelledby="current-plan" data-testid="current-plan" className="flex flex-col gap-1">
                <h2 id="current-plan" className="text-muted-foreground text-sm">
                  {m.current}
                </h2>
                <p className="text-lg font-medium" data-testid="current-plan-name">
                  {current.name}
                </p>
                <p className="text-muted-foreground text-sm">{seats(current)}</p>
                {subscription ? (
                  <p className="text-sm">
                    {m.status[subscription.status]}
                    {subscription.periodEnd
                      ? ` · ${format(subscription.cancelAtPeriodEnd ? m.ends : m.renews, { date: date(subscription.periodEnd) })}`
                      : ""}
                  </p>
                ) : null}
              </section>
            ) : (
              <p className="text-muted-foreground text-sm">{m.none}</p>
            )
          ) : null}
          <Link to="/account" className={`${buttonVariants({ variant: "link" })} px-0 self-start`}>
            {m.backToAccount}
          </Link>
        </CardContent>
      </Card>
      {state.isSuccess ? (
        <section aria-labelledby="available-plans" className="flex flex-col gap-3">
          <h2 id="available-plans" className="text-lg font-medium">
            {m.available}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {state.data.plans.map((plan) => {
              const isCurrent = plan.id === current?.id;
              const canBuy = plan.kind === "fixed" && !subscription;
              return (
                <li key={plan.id} data-testid={`plan-${plan.id}`}>
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <h3>{plan.name}</h3>
                      </CardTitle>
                      {plan.description ? <CardDescription>{plan.description}</CardDescription> : null}
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <p className="text-sm">
                        {plan.price ? money(plan.price) : m.free} · {seats(plan)}
                      </p>
                      {plan.trialDays > 0 && !subscription ? (
                        <p className="text-muted-foreground text-sm">{format(m.trial, { days: String(plan.trialDays) })}</p>
                      ) : null}
                      {isCurrent ? (
                        <p className="text-muted-foreground text-sm">{m.currentTag}</p>
                      ) : canBuy ? (
                        <Button className="self-start" disabled={subscribe.isPending} onClick={() => void start(plan)}>
                          {subscribe.isPending && subscribe.variables?.body.plan === plan.id ? m.subscribing : m.subscribe}
                        </Button>
                      ) : plan.kind === "per_seat" ? (
                        <p className="text-muted-foreground text-sm">{m.seatPlansSoon}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
