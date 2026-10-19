import { createContext, useContext, type ReactNode } from "react";
import type { Messages } from "../i18n/index.ts";
import { isKnownErrorCode, type KnownErrorCode } from "../platform/error-codes.ts";

const MessagesContext = createContext<Messages | null>(null);

export function MessagesProvider({ messages, children }: { messages: Messages; children: ReactNode }) {
  return <MessagesContext value={messages}>{children}</MessagesContext>;
}

/** The build locale's texts, with the Product's overrides on top. */
export function useMessages(): Messages {
  const messages = useContext(MessagesContext);
  if (!messages) throw new Error("useMessages() needs a <MessagesProvider> (createSpa adds it).");
  return messages;
}

/**
 * Translates an API failure by its stable `code` (the English `message` is never
 * shown). Anything else, such as a network failure, gets the generic text.
 */
export function useErrorMessage(): (error: unknown) => string {
  const { errors } = useMessages();
  return (error) => {
    const code = errorCode(error);
    return code ? errors[code] : errors.unexpected;
  };
}

/**
 * The `code` of an error the API answered with, if known: Kubb's `ResponseError`
 * (`{ data: { code } }`) or a Better Auth client error (`{ code }`).
 */
export function errorCode(error: unknown): KnownErrorCode | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const body = "data" in error ? error.data : error;
  if (typeof body !== "object" || body === null || !("code" in body)) return undefined;
  return isKnownErrorCode(body.code) ? body.code : undefined;
}
