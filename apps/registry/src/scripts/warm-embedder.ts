import { config as _dotenvConfig } from "dotenv";
import { resolve as _dotenvResolve } from "node:path";
_dotenvConfig({ path: [_dotenvResolve(process.cwd(), ".env"), _dotenvResolve(process.cwd(), "../../.env")] });
import { loadConfig } from "../config.js";
import { getEmbedder } from "../embedder.js";

/**
 * Loads the registry's embedding model once, so the first `POST /publish` or
 * `GET /search?q=` does not.
 *
 * This exists because wiring the vector index in gave the registry a
 * first-use cost it did not have before: `localEmbedder()` downloads ~87 MB of
 * ONNX weights from the model host on a cold cache. `POST /publish` embeds
 * before it stores anything, so on a cold cache with no network it returns 503
 * and stores nothing — correct, but a terrible thing to discover during a demo.
 * Run this once after `pnpm install`, on a machine that has network, and the
 * weights are cached for every run afterwards.
 *
 * Deliberately not run from the server's boot path: a registry that only
 * quotes, pays and settles should never load an ONNX runtime, and a boot that
 * blocks on a model download is worse than a first request that does.
 */
const cfg = loadConfig();
const t0 = Date.now();
console.log(`warming embedder: model="${cfg.embedding.model}" dim=${cfg.embedding.dim}`);

try {
  const embedder = await getEmbedder(cfg);
  const vec = await embedder.embed("warm-up: what is the ETHOnline 2026 prize pool");
  if (vec.length !== cfg.embedding.dim) {
    throw new Error(`embedder produced ${vec.length} dims, config declares ${cfg.embedding.dim}`);
  }
  console.log(`ok — ${vec.length}-dim vector in ${Date.now() - t0}ms (weights now cached)`);
} catch (e) {
  console.error(`FAILED: ${(e as Error).message}`);
  console.error(
    "GET /search?q= and POST /publish both need this. A registry that cannot embed cannot index, " +
      "so publish will 503 rather than accept an artifact nobody could ever find.",
  );
  process.exit(1);
}
