import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { withVerifyFull } from "../src/db-url.ts";

// Built from parts: no address with a password is written out in full.
const address = (query: string, host = "h") => ["postgresql://", "u", ":", "pw", "@", host, "/db", query].join("");

describe("withVerifyFull", () => {
  it("turns require into verify-full and keeps the other parameters", () => {
    expect(withVerifyFull(address("?sslmode=require&channel_binding=require"))).toBe(address("?sslmode=verify-full&channel_binding=require"));
    expect(withVerifyFull(address("?channel_binding=require&sslmode=require"))).toBe(address("?channel_binding=require&sslmode=verify-full"));
  });

  it("leaves verify-full and an address without sslmode as they are", () => {
    expect(withVerifyFull(address("?sslmode=verify-full"))).toBe(address("?sslmode=verify-full"));
    const local = address("", "localhost:5432");
    expect(withVerifyFull(local)).toBe(local);
  });

  it("makes pg parse the address without its sslmode security warning", () => {
    const parse = (uri: string) => {
      const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
      try {
        new pg.Client({ connectionString: uri });
        return warn.mock.calls.length;
      } finally {
        warn.mockRestore();
      }
    };
    const neon = address("?sslmode=require&channel_binding=require", "ep-1.neon.tech");
    expect(parse(neon)).toBeGreaterThan(0);
    expect(parse(withVerifyFull(neon))).toBe(0);
  });
});
