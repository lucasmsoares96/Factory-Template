import { Circle, House, UserRound } from "lucide-react";
import { expect, test } from "vitest";
import { navIcon } from "../src/client/nav-icons.ts";

test("navIcon resolves a declared name and falls back to the default for none, an unknown name or an inherited key", () => {
  expect(navIcon("House")).toBe(House);
  expect(navIcon("UserRound")).toBe(UserRound);
  expect(navIcon(undefined)).toBe(Circle);
  expect(navIcon("NoSuchIcon")).toBe(Circle);
  expect(navIcon("constructor")).toBe(Circle);
});
