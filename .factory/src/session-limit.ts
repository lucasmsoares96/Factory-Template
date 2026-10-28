import { z } from "zod";
import type { FactoryConfig } from "./config.ts";
import { messages } from "./messages.ts";
import { fence } from "./report.ts";
import { SessionLimitError, type AgentSessionError, type Stage } from "./seams/agent.ts";

/**
 * A session that failed in a run: its agent's own message and, at the account's usage limit, when the run starts again.
 * A limit pauses the run (no Escalation): the item waits under the `sessionLimit` label, its marked comment says the
 * reset time, and `pnpm factory resume` (cron) starts the same work again once `resumeAt` has passed.
 */

const HOUR = 3_600_000;

export const sessionFailureSchema = z.object({
  stage: z.enum(["development", "review", "pull-request", "triage", "retro"]),
  /** The session's error, as the agent adapter reported it. */
  message: z.string(),
  /** Null for any failure but the usage limit. */
  limit: z
    .object({
      /** The reset time as the agent wrote it (`3:20pm (UTC)`); null when it gave none. */
      resetsAt: z.string().nullable(),
      /** When the work may start again: the reset, or an hour after the limit when the reset cannot be read. */
      resumeAt: z.iso.datetime(),
    })
    .nullable(),
});

export type SessionFailure = z.infer<typeof sessionFailureSchema>;

/** The record of a failed session, at `now` (ms). */
export function sessionFailure(stage: Stage, error: AgentSessionError, now: number): SessionFailure {
  if (!(error instanceof SessionLimitError)) return { stage, message: error.message, limit: null };
  const reset = error.resetsAt === null ? null : resetTime(error.resetsAt, now);
  return { stage, message: error.message, limit: { resetsAt: error.resetsAt, resumeAt: new Date(reset ?? now + HOUR).toISOString() } };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const RESET = /(?:\b([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?\b(\d{1,2})(?::(\d{2}))?\s*([ap]m)\b(?:\s*\(([^)]+)\))?/i;

/**
 * The instant of a reset time as Claude Code writes it: `3pm`, `3:20pm (UTC)`, `Nov 3, 5pm (America/Sao_Paulo)`. A
 * time of day is its next occurrence after `now`; no zone is UTC (the runner's). Null when it cannot be read.
 */
export function resetTime(text: string, now: number): number | null {
  const match = text.match(RESET);
  if (!match) return null;
  const [, monthName, dayText, hourText, minuteText, meridiem, zone = "UTC"] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const h24 = (hour % 12) + (meridiem!.toLowerCase() === "pm" ? 12 : 0);
  const today = wallClock(now, zone);
  if (today === null) return null;
  if (monthName === undefined) {
    const at = (day: number) => instant({ ...today, day, hour: h24, minute }, zone);
    const first = at(today.day);
    return first !== null && first <= now ? at(today.day + 1) : first;
  }
  const month = MONTHS.indexOf(monthName.toLowerCase());
  if (month < 0) return null;
  const at = (year: number) => instant({ year, month, day: Number(dayText), hour: h24, minute }, zone);
  const thisYear = at(today.year);
  // A date long past is next year's (a reset in January read in December).
  return thisYear !== null && thisYear < now - 12 * HOUR ? at(today.year + 1) : thisYear;
}

interface WallClock {
  year: number;
  /** 0-based. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** The wall clock of `zone` at instant `t`; null for a zone Intl does not know. */
function wallClock(t: number, zone: string): WallClock | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(t);
  } catch {
    return null;
  }
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month") - 1, day: part("day"), hour: part("hour"), minute: part("minute") };
}

/** The instant the wall clock of `zone` shows `wall` (day overflow allowed); null for an unknown zone. */
function instant(wall: WallClock, zone: string): number | null {
  const asUtc = Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute);
  const offset = (t: number) => {
    const seen = wallClock(t, zone);
    return seen === null ? null : Date.UTC(seen.year, seen.month, seen.day, seen.hour, seen.minute) - Math.floor(t / 60_000) * 60_000;
  };
  const first = offset(asUtc);
  if (first === null) return null;
  // Once more at the guess, in case it fell on the other side of a DST change.
  const second = offset(asUtc - first) ?? first;
  return asUtc - second;
}

/** The tag of the comment that says an item waits for the reset; the JSON after it is what `resume` restarts. */
export const SESSION_LIMIT_MARKER = "<!-- factory:session-limit";

/**
 * What waits and how it starts again. `issue`: the issue flow, from `head` when it kept commits. `pr-feedback`,
 * `update-branch`: the round on the issue's pull request `pr`. `update-pr`: the update of `pr`, keyed by the pull
 * request alone. `triage`: the Triage of the issue. `retro`: the automatic Retro of the issue (and `pr`).
 */
export const waitSchema = z.object({
  flow: z.enum(["issue", "pr-feedback", "update-branch", "update-pr", "triage", "retro"]),
  resumeAt: z.iso.datetime(),
  head: z.string().regex(/^[0-9a-f]{40,64}$/).nullable().default(null),
  pr: z.number().int().positive().nullable().default(null),
});

export type Wait = z.infer<typeof waitSchema>;

export function waitMarker(wait: Wait): string {
  return `${SESSION_LIMIT_MARKER} ${JSON.stringify(wait)} -->`;
}

/** The wait a comment's marker carries; null when it has none or it does not parse. */
export function parseWait(body: string): Wait | null {
  const json = body.match(new RegExp(`${SESSION_LIMIT_MARKER} (\\{[^\\n]*?\\}) -->`))?.[1];
  if (json === undefined) return null;
  try {
    const parsed = waitSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** `2026-10-28 15:20 UTC`. */
export function utcMinute(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/** The comment of a paused item: marker, what stopped and when it starts again, what happens to the work, the session's message. */
export function sessionLimitComment(input: { wait: Wait; failure: SessionFailure; next: string; runUrl: string | null }, config: FactoryConfig): string {
  const m = messages(config.language);
  const { wait, failure } = input;
  const manual = wait.flow === "issue" ? m.sessionLimitRestartIssue(config.labels.sessionLimit, config.labels.readyForAgent) : m.sessionLimitCancel(config.labels.sessionLimit);
  const lines = [waitMarker(wait), m.sessionLimitTitle(STAGE_NAMES[failure.stage], failure.limit?.resetsAt ?? null, utcMinute(wait.resumeAt)), "", input.next, "", manual, "", fence(failure.message, "text")];
  if (input.runUrl) lines.push("", m.workflowRun(input.runUrl));
  return lines.join("\n");
}

const STAGE_NAMES: Record<SessionFailure["stage"], string> = { development: "Development", review: "Review", "pull-request": "Pull Request Stage", triage: "Triage", retro: "Retro" };

export function stageName(stage: SessionFailure["stage"]): string {
  return STAGE_NAMES[stage];
}

/** The tag an Escalation of a failed session carries: the retry continues from the commits it kept at `head`. */
export function continueMarker(head: string): string {
  return `<!-- factory:continue ${head} -->`;
}

/** The head a `continueMarker` names; null when the text has none. */
export function continuedHead(body: string): string | null {
  return body.match(/<!-- factory:continue ([0-9a-f]{40,64}) -->/)?.[1] ?? null;
}
