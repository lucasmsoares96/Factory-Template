# The bootstrap wizard never asks twice, and keeps the CLIs' own logins

`pnpm bootstrap` is run by a person who pays in attention. It asks only for what neither the forge nor a local CLI login already proves, and a complete rerun asks nothing (a prompt-counter test checks it).

- **Neon**: the wizard drives `neonctl` and uses its saved login in `~/.config/neonctl`. It opens the browser only when `neonctl me` shows none (once per machine) and never logs out. Connection strings go from the CLI's stdout straight to `gh secret set`, never to disk, argv or a log. `NEON_API_KEY` in the environment is accepted without being stored.
- **Cloudflare**: the API token is asked once, only while the `CLOUDFLARE_API_TOKEN` secret does not exist. Later calls use, in order, the run's memory, the environment variable, and wrangler's saved login (`wrangler auth token --json`; `wrangler login` runs once if there is none). The doctor and the `check`s never open a browser.
- **GitHub**: the `gh` session. The Factory token is asked once as a fine-grained personal access token (pre-filled link; the only manual choice is "Only select repositories") and checked before it is stored (ADR 0002).
- **Optional steps say so**: Resend is a select ("It is optional", default skip), a blank answer is remembered for the run, and `RESEND_API_KEY` in the environment answers it.
- A recorded variable or secret proves its step done; `--redo <step>` repeats one. The wizard keeps no local state. The doctor is read-only and never prompts at the end of a wizard.

## Considered Options

- **A pasted API key for every service, a throwaway config directory and a logout each run** (the first Neon design): the user logged in again at every command.
- **State in a local file**: stale the moment someone changes an account by hand.

## Consequences

- A step's "done" test reads the remote state, so it needs the credential to be reachable; the wizard prints what it could not check instead of asking.
- Names of secrets and variables are the contract between the wizard, the workflows and the doctor.
- `destroy` refuses without a TTY or with `CI` set (even empty), and only a person may run it.
