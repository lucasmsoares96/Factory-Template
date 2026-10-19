import { createContext, useContext, type ReactNode } from "react";
import type { Messages } from "../i18n/index.ts";
import { isErrorCode, type ErrorCode } from "../platform/error-codes.ts";

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

/** The `code` of an error the API answered with (Kubb's `ResponseError`), if known. */
export function errorCode(error: unknown): ErrorCode | undefined {
  if (typeof error !== "object" || error === null || !("data" in error)) return undefined;
  const { data } = error;
  if (typeof data !== "object" || data === null || !("code" in data)) return undefined;
  return isErrorCode(data.code) ? data.code : undefined;
}
