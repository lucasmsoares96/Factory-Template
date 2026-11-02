/** Where a secret was found; never the secret itself. */
export interface SecretFinding {
  /** A file of the scanned commits, or the name of a text (`pull request body`). */
  source: string;
  line: number;
  /** The id of the rule that fired. */
  rule: string;
}

export interface SecretScan {
  /** Checkout that holds the commits. */
  repo: string;
  /** The commits after `base` up to `head` are scanned; none when `head` is null. */
  base: string;
  head: string | null;
  /** The texts the Factory is about to publish. */
  texts: { name: string; text: string }[];
}

/**
 * Looks for secrets in what `publish` is about to write. A scanner that cannot run throws: nothing is published
 * without a scan. A finding carries the place and the rule, never the value.
 */
export interface SecretScanner {
  scan(input: SecretScan): Promise<SecretFinding[]>;
}
