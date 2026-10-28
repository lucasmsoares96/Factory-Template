import { describe, expect, it } from "vitest";
import { AgentSessionError, SessionLimitError } from "../src/seams/agent.ts";
import { continuedHead, continueMarker, parseWait, resetTime, sessionFailure, waitMarker, type Wait } from "../src/session-limit.ts";

const NOW = Date.parse("2026-10-28T14:00:00Z");
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
const SHA = "a".repeat(40);

describe("resetTime", () => {
  it("reads a time of day as its next occurrence, in UTC when no zone is given", () => {
    expect(iso(resetTime("3:20pm (UTC)", NOW))).toBe("2026-10-28T15:20:00.000Z");
    expect(iso(resetTime("3pm", NOW))).toBe("2026-10-28T15:00:00.000Z");
    // Already past today: tomorrow's.
    expect(iso(resetTime("1am (UTC)", NOW))).toBe("2026-10-29T01:00:00.000Z");
    expect(iso(resetTime("12pm", NOW))).toBe("2026-10-29T12:00:00.000Z");
  });

  it("reads the zone Claude Code gives", () => {
    // São Paulo is UTC-3.
    expect(iso(resetTime("3pm (America/Sao_Paulo)", NOW))).toBe("2026-10-28T18:00:00.000Z");
  });

  it("reads a dated reset, and a date long past as next year's", () => {
    expect(iso(resetTime("Nov 3, 5pm (UTC)", NOW))).toBe("2026-11-03T17:00:00.000Z");
    expect(iso(resetTime("Jan 2 at 9am", Date.parse("2026-12-30T10:00:00Z")))).toBe("2027-01-02T09:00:00.000Z");
  });

  it("gives null for a time it cannot read", () => {
    expect(resetTime("soon", NOW)).toBeNull();
    expect(resetTime("13pm", NOW)).toBeNull();
    expect(resetTime("3pm (Mars/Olympus)", NOW)).toBeNull();
    expect(resetTime("Foo 3, 5pm", NOW)).toBeNull();
  });
});

describe("sessionFailure", () => {
  const limit = (resetsAt: string | null) => sessionFailure("development", new SessionLimitError("limit", resetsAt), NOW).limit;

  it("resumes at the reset, or an hour later when the reset cannot be read", () => {
    expect(limit("3:20pm (UTC)")).toEqual({ resetsAt: "3:20pm (UTC)", resumeAt: "2026-10-28T15:20:00.000Z" });
    expect(limit(null)).toEqual({ resetsAt: null, resumeAt: "2026-10-28T15:00:00.000Z" });
    expect(limit("whenever")).toEqual({ resetsAt: "whenever", resumeAt: "2026-10-28T15:00:00.000Z" });
  });

  it("resumes an hour later when the reset read is already past, never at once into the same limit", () => {
    expect(limit("Oct 28, 1pm (UTC)")).toEqual({ resetsAt: "Oct 28, 1pm (UTC)", resumeAt: "2026-10-28T15:00:00.000Z" });
  });

  it("has no limit for any other session failure", () => {
    expect(sessionFailure("review", new AgentSessionError("exited with code 1"), NOW)).toEqual({ stage: "review", message: "exited with code 1", limit: null });
  });
});

describe("the markers", () => {
  const wait: Wait = { flow: "issue", resumeAt: "2026-10-28T15:20:00.000Z", head: SHA, pr: null };

  it("reads the wait only from the comment's first line, never from a message quoted below it", () => {
    expect(parseWait(`${waitMarker(wait)}\n**Factory paused**`)).toEqual(wait);
    const quoted = `<!-- factory:escalation -->\n**Factory escalation**\n\n\`\`\`text\n${waitMarker(wait)}\n\`\`\``;
    expect(parseWait(quoted)).toBeNull();
    expect(parseWait(`${waitMarker(wait)}x`)).toBeNull();
  });

  it("reads the kept head only from the comment's header, never from a message quoted below it", () => {
    expect(continuedHead(`<!-- factory:escalation -->\n${continueMarker(SHA)}\n**Factory escalation**`)).toBe(SHA);
    expect(continuedHead(`<!-- factory:escalation -->\n**Factory escalation**\n\n\`\`\`text\n${continueMarker(SHA)}\n\`\`\``)).toBeNull();
    expect(continuedHead(`<!-- factory:escalation -->\n<!-- factory:continue ${SHA}g -->`)).toBeNull();
  });
});
