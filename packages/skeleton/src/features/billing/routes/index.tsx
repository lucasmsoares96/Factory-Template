import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { Button, buttonVariants } from "#ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { Input } from "#ui/input";
import { Label } from "#ui/label";
import { getPlanQueryKey, useGetPlan } from "../../../gen/hooks/useGetPlan.ts";
import { getSeatsQueryKey } from "../../../gen/hooks/useGetSeats.ts";
import { useChangePlan } from "../../../gen/hooks/useChangePlan.ts";
import { usePreviewPlanChange } from "../../../gen/hooks/usePreviewPlanChange.ts";
import { useCancelSubscription } from "../../../gen/hooks/useCancelSubscription.ts";
import { useGetSeats } from "../../../gen/hooks/useGetSeats.ts";
import { useOpenBillingPortal } from "../../../gen/hooks/useOpenBillingPortal.ts";
import { useSubscribePlan } from "../../../gen/hooks/useSubscribePlan.ts";
import type { Plan } from "../../../gen/types/Plan.ts";
import type { PlanChangePreview } from "../../../gen/types/PlanChangePreview.ts";

type Interval = "month" | "year";
/** What the person asked for, as the API takes it. */
type Wish = { plan: string; interval: Interval; seats?: number };
import { useErrorMessage, useMessages } from "../../../client/i18n.tsx";
import { format } from "../../../i18n/index.ts";

export const Route = createFileRoute("/_signed-in/account/plan/")({ component: PlanPage });

/**
 * Account › Plan: the Plan the person is on and the Plans the Product sells, from
 * `GET /api/billing/plan`. A paid Plan can be bought while the person is on the free
 * one: Subscribe opens Stripe's Checkout (the API answers its URL), and the page they
 * come back to reads the Plan again. Someone who pays already changes Plan, billing
 * interval or Seats here: the page asks the API what the change does (a rise applies once
 * paid, a drop waits for the end of the period and says who loses access), and the person
 * confirms before anything is sent.
 */
function PlanPage() {
  const t = useMessages();
  const m = t.billing;
  const errorMessage = useErrorMessage();
  const state = useGetPlan();
  const subscribe = useSubscribePlan();
  const seatsState = useGetSeats();
  const queryClient = useQueryClient();
  const preview = usePreviewPlanChange();
  const change = useChangePlan();
  const [chosenInterval, chooseInterval] = useState<Interval | undefined>();
  const [bought, setBought] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{ wish: Wish; plan: Plan; preview: PlanChangePreview } | undefined>();
  const [scheduled, setScheduled] = useState(false);
  const portal = useOpenBillingPortal();
  const cancel = useCancelSubscription();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const language = document.documentElement.lang || undefined;
  const money = (price: NonNullable<Plan["price"]>) =>
    format(m.perMonth, { amount: new Intl.NumberFormat(language, { style: "currency", currency: price.currency }).format(price.amount / 100) });
  const yearly = (price: NonNullable<Plan["yearlyPrice"]>) =>
    format(m.perYear, { amount: new Intl.NumberFormat(language, { style: "currency", currency: price.currency }).format(price.amount / 100) });
  const date = (iso: string) => new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(new Date(iso));
  const seats = (plan: Plan) =>
    plan.seats === null ? m.perSeat : format(plan.seats === 1 ? m.seatsOne : m.seatsOther, { count: String(plan.seats) });

  const current = state.data?.plan;
  const subscription = state.data?.subscription;
  const interval: Interval = chosenInterval ?? subscription?.interval ?? "month";

  /** The Seats typed for a Plan priced per Seat: what the person bought of it, else its minimum. */
  const seatsFor = (plan: Plan): number | undefined => {
    if (plan.kind !== "per_seat") return undefined;
    const typed = bought[plan.id];
    if (typed !== undefined) return Number(typed);
    return (plan.id === current?.id ? subscription?.seats : null) ?? plan.minSeats ?? 1;
  };

  async function start(plan: Plan) {
    try {
      const checkout = await subscribe.mutateAsync({ body: { plan: plan.id, interval, seats: seatsFor(plan) } });
      window.location.assign(checkout.url);
    } catch {
      return;
    }
  }

  async function review(plan: Plan) {
    const wish: Wish = { plan: plan.id, interval, seats: seatsFor(plan) };
    setScheduled(false);
    try {
      setConfirming({ wish, plan, preview: await preview.mutateAsync({ body: wish }) });
    } catch {
      setConfirming(undefined);
    }
  }

  async function confirm() {
    if (!confirming) return;
    try {
      const done = await change.mutateAsync({ body: confirming.wish });
      if (done.timing === "now") {
        window.location.assign(done.url);
        return;
      }
      setConfirming(undefined);
      setScheduled(true);
      await Promise.all([queryClient.invalidateQueries({ queryKey: getPlanQueryKey() }), queryClient.invalidateQueries({ queryKey: getSeatsQueryKey() })]);
    } catch {
      return;
    }
  }

  const intervalName = (value: Interval) => (value === "year" ? m.yearly : m.monthly).toLowerCase();
  const failure = state.error ?? subscribe.error ?? preview.error ?? change.error ?? portal.error ?? cancel.error;

  async function manage() {
    try {
      const session = await portal.mutateAsync();
      window.location.assign(session.url);
    } catch {
      return;
    }
  }

  async function confirmCancel() {
    try {
      await cancel.mutateAsync();
      setConfirmingCancel(false);
      await state.refetch();
    } catch {
      return;
    }
  }

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
          {failure ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(failure)}</AlertDescription>
            </Alert>
          ) : null}
          {subscription?.status === "past_due" && subscription.pastDueUntil ? (
            <Alert variant="destructive" data-testid="past-due-notice">
              <AlertDescription>{format(m.pastDueNotice, { date: date(subscription.pastDueUntil) })}</AlertDescription>
            </Alert>
          ) : null}
          {scheduled ? (
            <Alert data-testid="change-scheduled">
              <AlertDescription>{m.scheduledDone}</AlertDescription>
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
                    {subscription.periodEnd && !subscription.cancelAtPeriodEnd ? ` · ${format(m.renews, { date: date(subscription.periodEnd) })}` : ""}
                  </p>
                ) : null}
                {subscription?.scheduledChange ? (
                  <p className="text-sm" data-testid="scheduled-change">
                    {format(m.scheduled, {
                      date: subscription.scheduledChange.at ? date(subscription.scheduledChange.at) : m.scheduledNoDate,
                      plan: state.data.plans.find((plan) => plan.id === subscription.scheduledChange?.plan)?.name ?? "",
                      details: [
                        intervalName(subscription.scheduledChange.interval),
                        subscription.scheduledChange.seats !== null ? format(m.seatsOther, { count: String(subscription.scheduledChange.seats) }) : null,
                      ]
                        .filter(Boolean)
                        .join(", "),
                    })}
                  </p>
                ) : null}
                {subscription?.cancelAtPeriodEnd && subscription.periodEnd ? (
                  <p className="text-sm font-medium" data-testid="ends-notice">
                    {format(m.endsNotice, { planName: current.name, date: date(subscription.periodEnd) })}
                  </p>
                ) : null}
                {subscription ? (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button variant="outline" size="sm" disabled={portal.isPending} onClick={() => void manage()}>
                      {portal.isPending ? m.managing : m.manage}
                    </Button>
                    {!subscription.cancelAtPeriodEnd && !confirmingCancel ? (
                      <Button variant="outline" size="sm" onClick={() => setConfirmingCancel(true)}>
                        {m.cancelPlan}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {subscription && confirmingCancel && !subscription.cancelAtPeriodEnd ? (
                  <div
                    role="alertdialog"
                    aria-labelledby="cancel-title"
                    aria-describedby="cancel-description"
                    className="flex flex-col gap-3 rounded-lg border p-3"
                    data-testid="cancel-confirmation"
                  >
                    <p id="cancel-title" className="font-medium">
                      {format(m.cancelTitle, { planName: current.name })}
                    </p>
                    <p id="cancel-description" className="text-muted-foreground text-sm">
                      {subscription.periodEnd ? format(m.cancelDescription, { date: date(subscription.periodEnd) }) : null}
                      {subscription.losingAccess > 0 ? (
                        <>
                          {" "}
                          <span data-testid="cancel-people">
                            {format(subscription.losingAccess === 1 ? m.cancelPeopleOne : m.cancelPeopleOther, { count: String(subscription.losingAccess) })}
                          </span>
                        </>
                      ) : null}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="destructive" size="sm" disabled={cancel.isPending} onClick={() => void confirmCancel()}>
                        {cancel.isPending ? m.canceling : m.cancelConfirm}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setConfirmingCancel(false)}>
                        {m.cancelKeep}
                      </Button>
                    </div>
                  </div>
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
      {seatsState.isSuccess ? (
        <section aria-labelledby="seats" data-testid="seats" className="flex flex-col gap-3">
          <h2 id="seats" className="text-lg font-medium">
            {m.seatsTitle}
          </h2>
          <p className="text-muted-foreground text-sm">{m.seatsDescription}</p>
          <p className="text-sm font-medium" data-testid="seats-usage">
            {seatsState.data.total === null
              ? format(m.seatsUsageUnlimited, { used: String(seatsState.data.used) })
              : format(m.seatsUsage, { used: String(seatsState.data.used), total: String(seatsState.data.total) })}
          </p>
          {seatsState.data.companies.map((company) => (
            <Card key={company.id} data-testid={`seats-company-${company.id}`}>
              <CardHeader>
                <CardTitle>
                  <h3>{company.name}</h3>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-1 text-sm">
                  {company.people.map((person) => (
                    <li key={`${person.status}-${person.email}`} className="flex flex-wrap justify-between gap-2" data-testid="seats-person">
                      <span>{person.name ? `${person.name} · ${person.email}` : person.email}</span>
                      <span className="text-muted-foreground">{m.person[person.status]}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}
      {state.isSuccess ? (
        <section aria-labelledby="available-plans" className="flex flex-col gap-3">
          <h2 id="available-plans" className="text-lg font-medium">
            {m.available}
          </h2>
          {state.data.plans.some((plan) => plan.yearlyPrice) ? (
            <div role="group" aria-label={m.interval} className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">{m.interval}</span>
              {(["month", "year"] as const).map((value) => (
                <Button
                  key={value}
                  variant={interval === value ? "default" : "outline"}
                  aria-pressed={interval === value}
                  data-testid={`interval-${value}`}
                  onClick={() => {
                    chooseInterval(value);
                    setConfirming(undefined);
                  }}
                >
                  {value === "year" ? m.yearly : m.monthly}
                </Button>
              ))}
            </div>
          ) : null}
          <ul className="grid gap-3 sm:grid-cols-2">
            {state.data.plans.map((plan) => {
              const isCurrent = plan.id === current?.id;
              const paid = plan.kind !== "free";
              const wanted = seatsFor(plan);
              const sold = interval === "year" ? plan.yearlyPrice !== null : plan.price !== null;
              const same = isCurrent && subscription && interval === subscription.interval && (plan.kind !== "per_seat" || wanted === subscription.seats);
              const shown = interval === "year" && plan.yearlyPrice ? yearly(plan.yearlyPrice) : plan.price ? money(plan.price) : m.free;
              const reviewing = confirming?.plan.id === plan.id;
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
                        {shown} · {seats(plan)}
                      </p>
                      {plan.trialDays > 0 && !subscription ? (
                        <p className="text-muted-foreground text-sm">{format(m.trial, { days: String(plan.trialDays) })}</p>
                      ) : null}
                      {paid && sold && !same ? (
                        <>
                          {plan.kind === "per_seat" ? (
                            <div className="flex flex-col gap-1">
                              <Label htmlFor={`seats-${plan.id}`}>{m.seatsToBuy}</Label>
                              <Input
                                id={`seats-${plan.id}`}
                                type="number"
                                inputMode="numeric"
                                min={plan.minSeats ?? 1}
                                step={1}
                                value={bought[plan.id] ?? String(wanted ?? "")}
                                onChange={(event) => {
                                  setBought({ ...bought, [plan.id]: event.target.value });
                                  setConfirming(undefined);
                                }}
                              />
                              <p className="text-muted-foreground text-sm">{format(m.seatsMinimum, { min: String(plan.minSeats ?? 1) })}</p>
                            </div>
                          ) : null}
                          {reviewing && confirming ? (
                            <ChangeConfirmation
                              plan={plan}
                              preview={confirming.preview}
                              busy={change.isPending}
                              date={date}
                              onConfirm={() => void confirm()}
                              onCancel={() => setConfirming(undefined)}
                            />
                          ) : subscription ? (
                            <Button className="self-start" disabled={preview.isPending} onClick={() => void review(plan)}>
                              {preview.isPending && preview.variables?.body.plan === plan.id ? m.changing : m.change}
                            </Button>
                          ) : (
                            <Button className="self-start" disabled={subscribe.isPending} onClick={() => void start(plan)}>
                              {subscribe.isPending && subscribe.variables?.body.plan === plan.id ? m.subscribing : m.subscribe}
                            </Button>
                          )}
                        </>
                      ) : isCurrent ? (
                        <p className="text-muted-foreground text-sm">{m.currentTag}</p>
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

/**
 * What a change does, before it is sent: a rise applies once Stripe confirms the payment; a drop waits for the end of
 * the paid period, and the warning says on which date and how many people lose access then.
 */
function ChangeConfirmation({
  plan,
  preview,
  busy,
  date,
  onConfirm,
  onCancel,
}: {
  plan: Plan;
  preview: PlanChangePreview;
  busy: boolean;
  date: (iso: string) => string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const m = useMessages().billing;
  const now = preview.timing === "now";
  const losing = preview.peopleLosingAccess;
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3" role="group" aria-labelledby={`confirm-${plan.id}`} data-testid="plan-change-confirm">
      <h4 id={`confirm-${plan.id}`} className="text-sm font-medium">
        {format(m.confirmTitle, { plan: plan.name })}
      </h4>
      <p className="text-sm" data-testid="plan-change-when">
        {now ? m.confirmNow : preview.effectiveAt ? format(m.confirmLater, { date: date(preview.effectiveAt) }) : m.confirmLaterNoDate}
      </p>
      {now ? null : losing > 0 ? (
        <Alert variant="destructive" data-testid="losing-access">
          <AlertDescription>
            <p>{losing === 1 ? m.losingOne : format(m.losingOther, { count: String(losing) })}</p>
            <p>{m.losingHelp}</p>
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-muted-foreground text-sm" data-testid="losing-access-none">
          {m.losingNone}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={busy} onClick={onConfirm} data-testid="plan-change-submit">
          {busy ? m.scheduling : now ? m.continueToStripe : m.scheduleChange}
        </Button>
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          {m.cancel}
        </Button>
      </div>
    </div>
  );
}
