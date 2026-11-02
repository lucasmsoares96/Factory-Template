#!/usr/bin/env bash
# Installs the pinned gitleaks into the directory given as $1 (default /usr/local/bin), checked against the sha256 of
# the release's checksums file. The secret scan of `publish` runs this one version (docs/factory-flows.md). Bump the
# version and both checksums together, after reading the release notes.
set -euo pipefail

GITLEAKS_VERSION=8.30.1
GITLEAKS_SHA256_X64=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
GITLEAKS_SHA256_ARM64=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080

dest="${1:-/usr/local/bin}"
case "$(uname -m)" in
  x86_64 | amd64) arch=x64; sha="$GITLEAKS_SHA256_X64" ;;
  aarch64 | arm64) arch=arm64; sha="$GITLEAKS_SHA256_ARM64" ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac
tarball="gitleaks_${GITLEAKS_VERSION}_linux_${arch}.tar.gz"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
curl -fsSL -o "$work/$tarball" "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${tarball}"
echo "${sha}  $work/$tarball" | sha256sum -c -
tar -xzf "$work/$tarball" -C "$work" gitleaks
install -m 0755 "$work/gitleaks" "$dest/gitleaks"
"$dest/gitleaks" version
