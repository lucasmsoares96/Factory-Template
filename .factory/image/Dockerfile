# The Factory image: the `work` job, the PR `build` job and `pnpm factory local`
# run in it. Everything is installed by setup.sh; the tag is a hash of this
# file, setup.sh and the versions passed below (see .factory/src/image.ts).
FROM ubuntu:24.04

# From .node-version, package.json `packageManager`, the Playwright version in
# pnpm-lock.yaml and `claudeCode.version` in .factory/src/config.ts.
ARG NODE_VERSION
ARG PNPM_VERSION
ARG PLAYWRIGHT_VERSION
ARG CLAUDE_CODE_VERSION

COPY setup.sh /tmp/setup.sh
# setup.sh empties /tmp (itself included) when it is done.
RUN bash /tmp/setup.sh

# Defaults for the processes the image runs directly. The agent's sessions get
# an allowlisted env, so setup.sh also links these locations under the user's HOME.
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# uid 1001 is the `runner` user of GitHub-hosted runners: the job workspace
# stays writable, and Claude Code refuses to bypass permissions as root.
USER 1001
WORKDIR /home/factory
CMD ["sleep", "infinity"]
