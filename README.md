# Factory Template

A repository of Products plus the harness that builds them. See [AGENTS.md](AGENTS.md) for the map and [GLOSSARY.md](GLOSSARY.md) for the terms.

## Install

[proto](https://moonrepo.dev/docs/proto) is the only tool you install by hand. `.prototools` pins Node, pnpm and the GitHub CLI (`gh`); the `gh` plugin is `.proto/gh.toml`, which downloads the official `cli/cli` release and checks its checksum.

1. Install proto: `bash <(curl -fsSL https://moonrepo.dev/install/proto.sh)`.
2. In the clone, run `proto install`. If proto refuses the `gh` plugin because the configuration is not trusted, run `proto trust` once in the clone first: `[plugins]` is a security-sensitive setting, applied only to a trusted path.
3. Run `pnpm install`, then `pnpm bootstrap`.

Export variables that hold a secret with `read -s`, so the token stays out of the shell history:

```sh
read -s -p "GitHub token: " GITHUB_TOKEN; export GITHUB_TOKEN
```
