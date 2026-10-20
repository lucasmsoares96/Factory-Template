import { createFileRoute } from "@tanstack/react-router";
import { Card, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { useGetMe } from "../../../gen/hooks/useGetMe.ts";
import { useMessages } from "../../../client/i18n.tsx";
import { format } from "../../../i18n/index.ts";

// Under the signed-in layout, which has already loaded GET /api/me.
export const Route = createFileRoute("/_signed-in/")({ component: Home });

function Home() {
  const t = useMessages();
  const { data: me } = useGetMe();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{format(t.home.title, { name: me?.name ?? "" })}</h1>
        </CardTitle>
        <CardDescription>{format(t.home.description, { appName: t.app.title })}</CardDescription>
      </CardHeader>
    </Card>
  );
}
