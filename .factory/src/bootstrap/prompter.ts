import * as clack from "@clack/prompts";
import type { Prompter } from "./clients.ts";

function answer<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    clack.cancel("Cancelled. Nothing was kept locally; run `pnpm bootstrap` again to continue.");
    process.exit(130);
  }
  return value as T;
}

/** The interactive prompts of `@clack/prompts`. */
export const clackPrompter: Prompter = {
  note: (message) => clack.note(message),
  link: (message, url) => {
    process.stdout.write(`\n${message}\n${url}\n\n`);
  },
  text: async ({ message, initial }) => String(answer(await clack.text({ message, ...(initial === undefined ? {} : { initialValue: initial }) }))),
  password: async ({ message }) => String(answer(await clack.password({ message }))),
  select: async ({ message, options }) =>
    answer(await clack.select({ message, options: options.map((o) => ({ value: o.value, label: o.label })) as never })),
  confirm: async ({ message, initial }) => Boolean(answer(await clack.confirm({ message, ...(initial === undefined ? {} : { initialValue: initial }) }))),
  choose: async ({ message, options, onCancel }) => {
    const value = await clack.select({ message, options: options.map((o) => ({ value: o.value, label: o.label })) as never });
    return clack.isCancel(value) ? onCancel : (value as typeof onCancel);
  },
  spinner: (message) => {
    const spin = clack.spinner();
    spin.start(message);
    return { update: (next) => spin.message(next), stop: (last) => spin.stop(last) };
  },
};
