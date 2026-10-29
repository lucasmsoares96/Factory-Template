import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BASE_ENV, pick } from "../env.ts";
import { GH_AUTH_ENV, GH_NETWORK_ENV } from "../adapters/github/gh.ts";
import type { ToolsClient } from "./clients.ts";

/** Runs `command args`; `inherit` hands the terminal over. Resolves with stdout; rejects when the command is missing or exits non-zero. */
export type ToolRun = (command: string, args: string[], options: { env: Record<string, string>; inherit?: boolean }) => Promise<string>;

export const runTool: ToolRun = (command, args, { env, inherit }) =>
  new Promise((resolve, reject) => {
    if (inherit) {
      const child = spawn(command, args, { env, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve("") : reject(new Error(`${command} ${args[0]} failed (exit ${code}).`))));
      return;
    }
    execFile(command, args, { env, maxBuffer: 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });

const PROTOTOOLS = resolve(import.meta.dirname, "../../../.prototools");

/** `tool = "version"` lines of the top level of a `.prototools` file (the sections below it are plugins, not pins). */
export function parsePrototools(text: string): Record<string, string> {
  const pins: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) break;
    const match = /^([\w-]+)\s*=\s*"([^"]+)"/.exec(trimmed);
    if (match) pins[match[1]!] = match[2]!;
  }
  return pins;
}

/**
 * Node, pnpm and `gh` on this machine. `gh` gets its own sign-in and network variables (a login lives under HOME);
 * `proto` and the others get the base ones. Nothing here writes to the repo.
 */
export class ToolsCli implements ToolsClient {
  private readonly run: ToolRun;
  private readonly env: Record<string, string>;
  private readonly ghEnv: Record<string, string>;
  private readonly readPins: () => string;
  private readonly node: string;

  constructor(options: { env?: Record<string, string | undefined>; run?: ToolRun; readPins?: () => string; nodeVersion?: string } = {}) {
    const parent = options.env ?? process.env;
    this.env = pick(parent, BASE_ENV);
    this.ghEnv = { ...this.env, ...pick(parent, [...GH_AUTH_ENV, ...GH_NETWORK_ENV]) };
    this.run = options.run ?? runTool;
    this.readPins = options.readPins ?? (() => readFileSync(PROTOTOOLS, "utf8"));
    this.node = options.nodeVersion ?? process.version;
  }

  async pinned(): Promise<{ node?: string; pnpm?: string }> {
    const pins = parsePrototools(this.readPins());
    return { ...(pins.node ? { node: pins.node } : {}), ...(pins.pnpm ? { pnpm: pins.pnpm } : {}) };
  }

  async nodeVersion(): Promise<string> {
    return this.node.replace(/^v/, "");
  }

  async pnpmVersion(): Promise<string | undefined> {
    try {
      return (await this.run("pnpm", ["--version"], { env: this.env })).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async ghInstalled(): Promise<boolean> {
    try {
      await this.run("gh", ["--version"], { env: this.ghEnv });
      return true;
    } catch {
      return false;
    }
  }

  async ghAuthenticated(): Promise<boolean> {
    try {
      await this.run("gh", ["auth", "status"], { env: this.ghEnv });
      return true;
    } catch {
      return false;
    }
  }

  async installGh(): Promise<void> {
    await this.run("proto", ["install", "gh"], { env: this.env, inherit: true });
  }

  async loginGh(): Promise<void> {
    await this.run("gh", ["auth", "login", "--web"], { env: this.ghEnv, inherit: true });
  }
}
