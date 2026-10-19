import { en, type Messages } from "./en.ts";
import { ptBR } from "./pt-BR.ts";

export type { Messages };

/** Locales the Skeleton ships. A Product picks one at build time (`LOCALE`). */
export const locales = ["en", "pt-BR"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

const skeletonMessages: Record<Locale, Messages> = { en, "pt-BR": ptBR };

type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };

/** A Product's texts over the Skeleton's, per locale. Unknown keys fail `tsc`. */
export type MessageOverrides = { [L in Locale]?: DeepPartial<Messages> };

/** Types a Product's overrides (identity at runtime). */
export function defineMessages(overrides: MessageOverrides): MessageOverrides {
  return overrides;
}

export function isLocale(value: unknown): value is Locale {
  return locales.includes(value as Locale);
}

/** The build's locale: `value` (the `LOCALE` build variable) or `en`. Unknown values throw. */
export function resolveLocale(value: string | undefined): Locale {
  if (value === undefined || value === "") return defaultLocale;
  if (!isLocale(value)) throw new Error(`Unknown LOCALE "${value}". Use one of: ${locales.join(", ")}.`);
  return value;
}

/** The Skeleton's texts for `locale` with the Product's overrides on top. */
export function messagesFor(locale: Locale, overrides: MessageOverrides = {}): Messages {
  return merge(skeletonMessages[locale], overrides[locale] ?? {});
}

/** Fills a text's `{name}` placeholders: `format("Hi {name}", { name: "Ana" })`. */
export function format(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder);
}

function merge<T>(base: T, override: DeepPartial<T>): T {
  const result = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] =
      typeof value === "object" && value !== null && typeof current === "object" && current !== null
        ? merge(current, value)
        : value;
  }
  return result as T;
}
