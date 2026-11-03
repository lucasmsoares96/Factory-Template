import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/**
 * The measurements `evidence()` writes next to each print (`<product>/<name>-<width>.json`, see
 * `packages/skeleton/e2e/measure.ts`). The Visual Review reads them; after the final E2E the harness reads them again:
 * a finding that is still there is neither fixed nor declared an exception.
 */

/** One print's measurements as the Visual Review left them (`<name>-<width>.json` next to the print). */
export const measurementSchema = z.object({
  product: z.string(),
  /** The print's file name without the extension, `<name>-<width>`. */
  name: z.string(),
  width: z.number().int().positive(),
  /** Findings that count: the Visual Review fixed none of these nor declared the test's exception. */
  findings: z.array(z.object({ kind: z.string(), message: z.string(), elements: z.array(z.object({ role: z.string(), name: z.string() })) })),
  /** Findings the test declared on purpose, each with its reason. */
  exceptions: z.array(z.object({ kind: z.string(), message: z.string(), reason: z.string() })),
});
export type Measurement = z.infer<typeof measurementSchema>;

const fileSchema = z.object({
  name: z.string(),
  width: z.number().int().positive(),
  findings: measurementSchema.shape.findings,
  exceptions: measurementSchema.shape.exceptions,
});

/** Every measurement under `dir` (`<dir>/<product>/<name>-<width>.json`), sorted by Product and file; a file that is not one is skipped. */
export async function readMeasurements(dir: string): Promise<Measurement[]> {
  const measurements: Measurement[] = [];
  const products = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const product of products.filter((p) => p.isDirectory()).map((p) => p.name).sort()) {
    for (const file of (await readdir(join(dir, product))).filter((f) => f.endsWith(".json")).sort()) {
      try {
        const parsed = fileSchema.parse(JSON.parse(await readFile(join(dir, product, file), "utf8")));
        measurements.push({ product, name: file.slice(0, -".json".length), width: parsed.width, findings: parsed.findings, exceptions: parsed.exceptions });
      } catch {
        // Not a measurement file.
      }
    }
  }
  return measurements;
}

/** One line for each finding that counts, naming the print and the elements. */
export function findingLines(measurements: Measurement[]): string[] {
  return measurements.flatMap((m) =>
    m.findings.map((f) => {
      const elements = f.elements.map((e) => `${e.role ? `${e.role} ` : ""}"${e.name}"`).join(", ");
      return `\`${m.product}/${m.name}\` (${m.width}px) ${f.kind}: ${f.message}${elements ? ` [${elements}]` : ""}`;
    }),
  );
}

/** One line for each exception a test declared, with its reason. */
export function exceptionLines(measurements: Measurement[]): string[] {
  return measurements.flatMap((m) => m.exceptions.map((e) => `\`${m.product}/${m.name}\` (${m.width}px) ${e.kind}: ${e.message} Reason: ${e.reason}`));
}
