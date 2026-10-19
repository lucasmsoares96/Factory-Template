// Compile-time checks of the i18n contract, run by `tsc` (the typecheck task).
// Each `@ts-expect-error` fails the build if the line below it starts to compile.
import { defineMessages, type Messages } from "../src/i18n/index.ts";
import { en } from "../src/i18n/en.ts";

// A locale that misses a key does not compile.
// @ts-expect-error `home.description` is missing
export const missingKey: Messages = { ...en, home: { title: "" } };

// A locale that misses the text for an API error code does not compile.
export const missingErrorCode: Messages = {
  ...en,
  // @ts-expect-error `errors.DATABASE_UNAVAILABLE` is missing
  errors: { NOT_FOUND: "", VALIDATION_FAILED: "", INTERNAL_ERROR: "", unexpected: "" },
};

// A Product may override any subset of texts, per locale...
export const overrides = defineMessages({ en: { app: { title: "Example" } }, "pt-BR": { home: { title: "Olá" } } });

// ...but not invent keys...
// @ts-expect-error `home.subtitle` is not a Skeleton text
defineMessages({ en: { home: { subtitle: "" } } });

// ...or locales the Skeleton does not ship.
// @ts-expect-error `fr` is not a locale
defineMessages({ fr: { app: { title: "" } } });
