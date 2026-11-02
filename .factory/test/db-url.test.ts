import { describe, expect, it } from "vitest";
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
});
