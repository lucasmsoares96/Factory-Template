// The reusable `image` job: `node .factory/src/ci/image.ts` prints the image
// the repository at the current directory needs and writes `ref`, `name`, `tag`
// and `build_args` to GITHUB_OUTPUT. The tag is the hash from `local/image.ts`
// (.node-version, pnpm, Playwright from the lockfile, Claude Code from the
// config, Dockerfile, setup.sh), the same one `pnpm factory local` pulls.
import { appendFileSync } from "node:fs";
import { loadConfig } from "../config.ts";
import { imageInputs, imageRef } from "../local/image.ts";

export interface ImageOutputs {
  ref: string;
  name: string;
  tag: string;
  /** `KEY=value` per line, for `docker build --build-arg`. */
  buildArgs: string;
}

/** `ghcr.io/<owner>/<repo>/factory` unless the config or FACTORY_IMAGE_NAME names another repository. */
export async function imageOutputs(repo: string, env: Record<string, string | undefined>): Promise<ImageOutputs> {
  let config = loadConfig(env);
  if (!config.image.name && env.GITHUB_REPOSITORY) {
    config = { ...config, image: { name: `ghcr.io/${env.GITHUB_REPOSITORY}/factory`.toLowerCase() } };
  }
  const inputs = await imageInputs(repo, config);
  const ref = await imageRef(repo, config, inputs);
  const at = ref.lastIndexOf(":");
  return {
    ref,
    name: ref.slice(0, at),
    tag: ref.slice(at + 1),
    buildArgs: Object.entries(inputs.args)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  };
}

if (import.meta.main) {
  const out = await imageOutputs(process.cwd(), process.env);
  console.log(out.ref);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `ref=${out.ref}\nname=${out.name}\ntag=${out.tag}\nbuild_args<<FACTORY_EOF\n${out.buildArgs}\nFACTORY_EOF\n`,
    );
  }
}
