import type { Extraction } from "./seams/agent.ts";
import type { SecretFinding, SecretScanner } from "./seams/secret-scanner.ts";

/** What a session is told about a text that held a secret; the same rule is in `prompts/rules.md`. */
const SECRET_RULE =
  "Never write a secret out in full, not even a fake one: describe its shape (for example \"a database address with a password\") or name the variable, never the value.";

/** A text a Stage wrote that the Factory will publish, with the name the scanner reports it under. */
export interface StageText {
  name: string;
  text: string;
}

/** Where the scanner found secrets in `texts`; never the values. */
export function scanTexts(scanner: SecretScanner, repo: string, base: string, texts: StageText[]): Promise<SecretFinding[]> {
  return scanner.scan({ repo, base, head: null, texts });
}

/** The places and rules of `findings`, for a message to a person. */
export function describeFindings(findings: SecretFinding[]): string {
  return findings.map((f) => `\`${f.source}\` line ${f.line} (rule \`${f.rule}\`)`).join(", ");
}

/**
 * `extraction` that also refuses a block whose published texts hold a secret: the session is resumed and told the
 * place and the rule of each finding, never the value, and asked for the block again. `texts` reads the texts of a
 * valid block.
 */
export function withSecretScan(extraction: Extraction, scanner: SecretScanner, repo: string, base: string, texts: (output: string) => StageText[]): Extraction {
  return {
    ...extraction,
    check: async (output) => {
      const found = await scanTexts(scanner, repo, base, texts(output));
      if (found.length === 0) return null;
      return [
        `The secret scan found what looks like a secret in your block: ${describeFindings(found)}.`,
        SECRET_RULE,
        "Reply with the whole block again, rewritten without it, and nothing else.",
      ].join(" ");
    },
  };
}
