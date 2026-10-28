# Billing is per person, on Better Auth's Stripe plugin; Companies stay the Skeleton's own

A Product may charge for its use, and the Skeleton bills the person, not the Company. A Subscription belongs to the user who pays: its Plan gives a number of Seats, and it covers every Company that person owns. Each distinct person in those Companies takes one Seat, however many of them they are in: the Owner, every Member and every pending Invitation. Billing runs on `@better-auth/stripe` in its user mode, so the Stripe customer, with the card and the invoices, is always the person who pays. Companies, Members and Invitations stay in the Skeleton's own tables and are not moved onto Better Auth's `organization` plugin.

## Considered Options

- **Bill the Company** (the Company is the Stripe customer). The card and the invoices would belong to whoever subscribed. After an ownership transfer the new Owner would be paying with the previous Owner's card and reading their invoices, until someone swapped the card, and Stripe cannot move a subscription to another customer. With `@better-auth/stripe`, billing an organization also requires the `organization` plugin.
- **Move Companies onto Better Auth's `organization` plugin**, to bill organizations with the Stripe plugin. With no Product data in production the migration itself was cheap, but in Better Auth 1.7.11 the plugin cannot keep what the Skeleton guarantees:
  - it has no ownership transfer (better-auth#11529); an owner can promote any member to owner, and its two-step promotion would break the Skeleton's one-Owner unique index;
  - it stores the invitation token in plain text, where the Skeleton keeps only a SHA-256 hash, and accepting needs a signed-in session whose email matches;
  - most of its endpoints need a session cookie, so a Connection over MCP would get 401;
  - with the Skeleton's Drizzle adapter its deletes run outside a transaction.
- **Write billing in the Skeleton on the Stripe SDK**: the customer, Checkout, the Customer Portal, webhook persistence and trials would all be ours to write and keep, for nothing the plugin lacks once billing is per person.

## Consequences

- A free trial is given once per person (the plugin's rule), so creating another Company earns no new trial.
- Seat counting is the Skeleton's: the plugin syncs a seat quantity only with the `organization` plugin. Creating an Invitation or accepting one checks the Owner's free Seats.
- An ownership transfer moves the Company's people onto the new Owner's Seats, so it becomes an offer that the new Owner accepts, and only with enough free Seats.
- When the Seats fall short (a smaller Plan, a failed payment, the end of a cancelled Subscription) nobody is removed: the newest people lose access until enough Seats are free again.
- `@better-auth/stripe` accepts the current Stripe SDK (v23) only from 1.7.13, so Better Auth moves to at least that version.
- The plugin's webhook answers 200 even when saving the event fails, so Stripe never retries it (better-auth#10534, open). It is a known risk until the fix ships.
