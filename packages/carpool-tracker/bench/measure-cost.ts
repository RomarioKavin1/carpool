/**
 * One-off measurement script (not part of `pnpm bench`, not part of `pnpm
 * test`) used to produce the numbers in this package's README under
 * "Install-size and latency cost". Run manually with `tsx bench/measure-cost.ts`
 * after the model is already cached, to separate cold-start (process +
 * model load) from per-query latency.
 */
import { localEmbedder } from "../src/embed.js";

async function main(): Promise<void> {
  const t0 = performance.now();
  const embedder = await localEmbedder();
  const t1 = performance.now();
  console.log(`cold start (pipeline load, model already cached): ${(t1 - t0).toFixed(1)} ms`);

  const N = 20;
  const text = "What is the ETHOnline 2026 prize pool across all sponsor tracks?";
  // Warm-up call — first inference in a process pays extra ONNX Runtime
  // session/graph setup cost on top of the pipeline load above; excluded
  // from the steady-state per-query number below.
  await embedder.embed(text);

  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const s = performance.now();
    await embedder.embed(text);
    times.push(performance.now() - s);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`per-query latency over ${N} calls: avg ${avg.toFixed(1)} ms, median ${sorted[Math.floor(N / 2)]!.toFixed(1)} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
