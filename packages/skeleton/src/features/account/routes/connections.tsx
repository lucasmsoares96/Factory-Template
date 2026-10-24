import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Alert, AlertDescription } from "#ui/alert";
import { Button } from "#ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#ui/card";
import { listConnections } from "../../../gen/clients/listConnections.ts";
import { listConnectionsQueryKey } from "../../../gen/hooks/useListConnections.ts";
import { useRevokeConnection } from "../../../gen/hooks/useRevokeConnection.ts";
import type { Connection } from "../../../gen/types/Connection.ts";
import { useErrorMessage, useMessages } from "../../../client/i18n.tsx";
import { format } from "../../../i18n/index.ts";

export const Route = createFileRoute("/_signed-in/account/connections")({ component: Connections });

/**
 * The AI agents the signed-in user connected over MCP, a page of
 * `GET /api/connections` at a time. Revoking one asks first; once
 * `DELETE /api/connections/{id}` answers, the list is read again.
 */
function Connections() {
  const t = useMessages();
  const m = t.account.connections;
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const connections = useInfiniteQuery({
    queryKey: [...listConnectionsQueryKey(), "pages"],
    queryFn: ({ pageParam, signal }) => listConnections({ query: pageParam ? { cursor: pageParam } : {}, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<string | null>(null);
  const revoke = useRevokeConnection({
    mutation: { onSettled: () => queryClient.invalidateQueries({ queryKey: listConnectionsQueryKey() }) },
  });
  const items = connections.data?.pages.flatMap((page) => page.connections) ?? [];

  async function confirmRevoke(connection: Connection) {
    setRevoked(null);
    try {
      await revoke.mutateAsync({ path: { id: connection.id } });
    } catch {
      return;
    }
    setConfirming(null);
    setRevoked(connection.appName);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{m.title}</h1>
        </CardTitle>
        <CardDescription>{format(m.description, { appName: t.app.title })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {revoked ? (
          <p role="status" className="text-sm">
            {format(m.revoked, { app: revoked })}
          </p>
        ) : null}
        {connections.isError || revoke.isError ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(connections.error ?? revoke.error)}</AlertDescription>
          </Alert>
        ) : null}
        {connections.isSuccess && items.length === 0 ? <p className="text-muted-foreground text-sm">{m.empty}</p> : null}
        {items.length > 0 ? (
          <ul className="flex flex-col divide-y">
            {items.map((connection) => (
              <ConnectionItem
                key={connection.id}
                connection={connection}
                confirming={confirming === connection.id}
                revoking={revoke.isPending}
                onRevoke={() => {
                  revoke.reset();
                  setConfirming(connection.id);
                }}
                onCancel={() => setConfirming(null)}
                onConfirm={() => void confirmRevoke(connection)}
              />
            ))}
          </ul>
        ) : null}
        {connections.hasNextPage ? (
          <Button
            variant="outline"
            className="self-start"
            disabled={connections.isFetchingNextPage}
            onClick={() => void connections.fetchNextPage()}
          >
            {m.more}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConnectionItem({
  connection,
  confirming,
  revoking,
  onRevoke,
  onCancel,
  onConfirm,
}: {
  connection: Connection;
  confirming: boolean;
  revoking: boolean;
  onRevoke: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const m = useMessages().account.connections;
  const { title } = useMessages().app;
  const id = useId();
  // The SPA sets the page's language to the build locale.
  const date = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: "medium" }).format(
    new Date(connection.createdAt),
  );

  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-1 flex-col">
          <span className="font-medium">{connection.appName}</span>
          <span className="text-muted-foreground text-sm">
            {format(m.connectedOn, { date })} · {connection.access === "write" ? m.write : m.read}
          </span>
        </div>
        {confirming ? null : (
          <Button variant="destructive" size="sm" onClick={onRevoke}>
            {m.revoke}
          </Button>
        )}
      </div>
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-description`}
          className="flex flex-col gap-3 rounded-lg border p-3"
        >
          <p id={`${id}-title`} className="font-medium">
            {format(m.confirmTitle, { app: connection.appName })}
          </p>
          <p id={`${id}-description`} className="text-muted-foreground text-sm">
            {format(m.confirmDescription, { app: connection.appName, appName: title })}
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={revoking} onClick={onConfirm}>
              {revoking ? m.revoking : m.confirm}
            </Button>
            <Button variant="outline" size="sm" autoFocus disabled={revoking} onClick={onCancel}>
              {m.cancel}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
