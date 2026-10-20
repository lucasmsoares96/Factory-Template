import { expect, test } from "vitest";
import { defineMessages, messagesFor, resolveLocale } from "../src/i18n/index.ts";

test("a Product's texts replace the Skeleton's only where it overrides them", () => {
  const overrides = defineMessages({ "pt-BR": { app: { title: "Exemplo" } } });

  const messages = messagesFor("pt-BR", overrides);

  expect(messages.app.title).toBe("Exemplo");
  expect(messages.home.title).toBe("Olá, {name}");
  expect(messagesFor("en", overrides).app.title).toBe("Skeleton");
});

test("the build locale defaults to English and rejects a locale the Skeleton does not ship", () => {
  expect(resolveLocale(undefined)).toBe("en");
  expect(resolveLocale("pt-BR")).toBe("pt-BR");
  expect(() => resolveLocale("fr")).toThrow('Unknown LOCALE "fr"');
});
