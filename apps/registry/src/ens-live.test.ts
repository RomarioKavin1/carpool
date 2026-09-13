/**
 * The one test in this package that reads a live network, so it only runs when
 * asked: `CARPOOL_ENS_LIVE=1 pnpm --filter @carpool/registry exec vitest run src/ens-live.test.ts`.
 *
 * The name is a real ENSv2 beta registration on Sepolia found by scanning the
 * v2 ETHRegistry's `NameRegistered` events (see docs/ENS.md); it is not ours and
 * its records may change, so the assertions are about structure (the v2 root
 * points at the v2 .eth registry, the Universal Resolver agrees with the v2
 * registry about the resolver, a profile record is readable, and a name with no
 * Carpool records is `unbound` for exactly the three reasons) rather than values.
 */
import { describe, expect, it } from "vitest";
import { probeSepoliaEnsV2 } from "./ens-probe.js";

const LIVE = process.env.CARPOOL_ENS_LIVE === "1";
const NAME = process.env.CARPOOL_ENS_LIVE_NAME || "dustycarrrubens.eth";

describe.skipIf(!LIVE)("live ENSv2 read on Sepolia", () => {
  it(
    "resolves through the v2 hierarchy with the registry's own reader",
    async () => {
      const r = await probeSepoliaEnsV2(NAME, process.env.CARPOOL_ENS_RPC_URL || undefined);
      console.log(JSON.stringify(r, null, 2));
      expect(r.ethRegistryMatchesDocs).toBe(true);
      expect(r.resolverFromV2Registry).not.toBe("0x0000000000000000000000000000000000000000");
      expect(r.sameResolver).toBe(true);
      expect(Object.keys(r.profile).length).toBeGreaterThan(0);
      expect(r.binding.status).toBe("unbound");
      expect(r.binding.checks).toEqual({ key: "missing", hederaAddr: "missing", payoutSig: "missing" });
    },
    60_000,
  );
});
