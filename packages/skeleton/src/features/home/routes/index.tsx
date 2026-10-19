import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription } from "#ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { useGetHealth } from "../../../gen/hooks/useGetHealth.ts";
import { useErrorMessage, useMessages } from "../../../client/i18n.tsx";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const t = useMessages();
  const errorMessage = useErrorMessage();
  const health = useGetHealth();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t.home.title}</h1>
        </CardTitle>
        <CardDescription>{t.home.apiStatusLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        {health.isPending ? (
          <p className="text-muted-foreground">{t.home.checking}</p>
        ) : health.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(health.error)}</AlertDescription>
          </Alert>
        ) : (
          <p data-testid="api-status">{t.home.apiStatus[health.data.status]}</p>
        )}
      </CardContent>
    </Card>
  );
}
