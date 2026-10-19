#!/usr/bin/env bash
# Installs the Factory toolchain on Ubuntu 24.04, as root: Node (checksum
# verified), pnpm through corepack, Claude Code, git and Playwright's Chromium,
# plus the `factory` user (uid 1001). No Docker CLI: the agent never drives Docker.
set -euo pipefail

: "${NODE_VERSION:?}" "${PNPM_VERSION:?}" "${PLAYWRIGHT_VERSION:?}" "${CLAUDE_CODE_VERSION:?}"
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git xz-utils

# Node, from nodejs.org, checked against the release's SHASUMS256.txt.
case "$(dpkg --print-architecture)" in
  amd64) node_arch=x64 ;;
  arm64) node_arch=arm64 ;;
  *) echo "unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;;
esac
tarball="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
cd /tmp
curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"
curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" | grep " ${tarball}\$" | sha256sum -c -
tar -xJf "${tarball}" -C /usr/local --strip-components=1 --no-same-owner \
  --exclude=CHANGELOG.md --exclude=LICENSE --exclude=README.md
rm "${tarball}"

# pnpm through corepack, preinstalled for every user.
export COREPACK_HOME=/opt/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable pnpm
corepack install -g "pnpm@${PNPM_VERSION}"
# pnpm 12 fetches its native binary on first run: do it now, while COREPACK_HOME is writable.
pnpm --version

# Claude Code, at the version pinned in .factory/src/config.ts.
npm install -g --no-fund --no-audit "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"

# Chromium for Playwright (and its system libraries), shared by every user.
export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
npx -y "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium

# The user every job runs as. ubuntu:24.04 already has `ubuntu` with uid 1000.
useradd --uid 1001 --create-home --shell /bin/bash factory
# Agent sessions only get PATH and HOME: the default cache locations point at
# the shared installs, so pnpm and Playwright work without COREPACK_HOME or
# PLAYWRIGHT_BROWSERS_PATH.
install -d -o factory -g factory /home/factory/.cache /home/factory/.cache/node
ln -s /opt/corepack /home/factory/.cache/node/corepack
ln -s /ms-playwright /home/factory/.cache/ms-playwright
chmod -R a+rX /opt/corepack /ms-playwright

apt-get clean
rm -rf /var/lib/apt/lists/* /tmp/* /root/.npm /root/.cache
