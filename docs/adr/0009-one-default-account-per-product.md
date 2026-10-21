# One default account per Product; its password is a deploy secret

`pnpm bootstrap product <id>` creates one verified account straight in the production database (the migrations run first, idempotently), so the person can use the app without signing up, and the post-deploy smoke test signs in with that same account. The hash is written by the Skeleton's own `hashPassword` (`better-auth/crypto`, the function the `PasswordHasher` uses), as a `user` with `emailVerified = true` and a `credential` account. The email is the variable `<ID>_ACCOUNT_EMAIL`; the password is the secret `<ID>_ACCOUNT_PASSWORD`, stored nowhere else (not on disk, in logs, argv or a prompt).

The `smoke` job of `factory-deploy.yml` therefore holds exactly one secret, that password, and declares the `<id>-production` environment. The deploy workflow's code is always `main`'s. `deploy` stays the only job with the Cloudflare and Neon secrets (a static test checks that `smoke` references only `ACCOUNT_PASSWORD`).

## Considered Options

- **A smoke test without sign-in** (health and `/mcp` 401 only): sign-up needs email verification, which in production goes through Resend and has no inbox to read, so a `PasswordHasher` failure (`exceededCpu`) would never show.
- **A separate smoke account**: one more credential to store and a second account that exists only for CI.
- **The password only as a prompt**: the smoke job could not sign in.

## Consequences

- Anyone who can read a repository secret can sign in to production as that user. The account is an ordinary user, meant for the owner.
- Previews have no account: the smoke there does a real sign-up and reads the outbox.
- The account is created when the Product is, so a rerun with the variable, the secret and a verified user present asks nothing.
