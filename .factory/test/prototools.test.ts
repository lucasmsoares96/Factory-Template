import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Seam 2: the proto files are read as data.
const repo = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");

describe("proto toolchain", () => {
  const prototools = read(".prototools");

  it("pins an exact gh version through the plugin kept in the repo", () => {
    expect(prototools).toMatch(/^gh = "\d+\.\d+\.\d+"$/m);
    expect(prototools).toMatch(/^gh = "file:\/\/\.\/\.proto\/gh\.toml"$/m);
  });

  it("still pins Node and pnpm", () => {
    expect(prototools).toMatch(/^node = "\d+\.\d+\.\d+"$/m);
    expect(prototools).toMatch(/^pnpm = "\d+\.\d+\.\d+"$/m);
  });

  it("downloads the official cli/cli release and checks its checksum", () => {
    const plugin = read(".proto/gh.toml");
    expect(plugin).toContain('download-url = "https://github.com/cli/cli/releases/download/v{version}/{download_file}"');
    expect(plugin).toContain('checksum-url = "https://github.com/cli/cli/releases/download/v{version}/{checksum_file}"');
    expect(plugin).toMatch(/checksum-file = "gh_\{version\}_checksums\.txt"/);
  });

  it("documents the install steps in the README", () => {
    const readme = read("README.md");
    for (const step of ["proto install", "proto trust", "pnpm bootstrap", "read -s"]) expect(readme).toContain(step);
  });
});
