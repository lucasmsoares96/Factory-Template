# @shadcn/lint

`@shadcn/lint` is registered in the root `.oxlintrc.json` (`"jsPlugins": ["@shadcn/lint"]`) with **no rule turned on**. Choosing the rules is a human decision.

- Version: pinned in the `pnpm-workspace.yaml` catalog (0.2.3: 0.2.4 and 0.2.5 were younger than `minimumReleaseAge` on 2026-11-02). It pulls `@eslint/core`, not ESLint.
- Where to turn rules on: the `rules` of the `apps/**` override in `.oxlintrc.json` (Products import the UI through `@workspace/skeleton`). Rules are named `shadcn/<rule>`.
- Rule list and configuration examples: https://github.com/shadcn-ui/lint/blob/main/docs/rules.md and the package README.
- Discovery of components and theme comes from `packages/skeleton/components.json`; no `settings.shadcn` was needed.
- Proof that the plugin loads: `packages/skeleton/test/shadcn-lint.test.ts` turns on `shadcn/no-arbitrary-values` over a fixture.
