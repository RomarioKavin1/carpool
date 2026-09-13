// Read-only live check of an ENSv2 name on Sepolia with the registry's own ENS
// code. Writes nothing to any chain and needs no key.
//
//   pnpm --filter @carpool/registry ens:check dustycarrrubens.eth
//
// Optional: CARPOOL_ENS_RPC_URL (defaults to viem's public Sepolia endpoint).
import { probeSepoliaEnsV2 } from "../ens-probe.js";

const name = process.argv[2];
if (!name) {
  console.error("usage: ens:check <name.eth>");
  process.exit(2);
}
const report = await probeSepoliaEnsV2(name, process.env.CARPOOL_ENS_RPC_URL || undefined);
console.log(JSON.stringify(report, null, 2));
