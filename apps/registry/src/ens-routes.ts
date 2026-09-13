import type { Express, Request, Response } from "express";
import { checkEnsBinding, parseEnsAuthor, type EnsBinding } from "@carpool/core";
import { getEnsReader, identityView, keyRecordOf, loadEnsConfig, readEnsProfile, assertNormalisedEnsName } from "./ens.js";
import type { RegistryLedger } from "./ledger.js";

/**
 * The two ENS read routes. Both FREE, both read-only, and neither is on a money
 * path: the purchase path resolves its own payee in `onPaid` and never reads
 * what these return.
 */
export function registerEnsRoutes(app: Express, ledger: RegistryLedger): void {
  /**
   * `GET /identity?author=<opaque manifest.author>`
   *
   * What a UI needs to show an author honestly: for a Hedera author, the account
   * and key in the string; for an ENS author, the live binding check, where the
   * next sale would pay if it happened now, and the name's ENSIP-5 profile. Memoised
   * for 30 s per author (definite answers only).
   */
  app.get("/identity", async (req: Request, res: Response) => {
    const author = typeof req.query.author === "string" ? req.query.author.trim() : "";
    if (author === "") {
      res.status(400).json({ error: "author query parameter is required (a manifest.author string)" });
      return;
    }
    try {
      res.json(await identityView(author));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  /**
   * `GET /ens/:name`
   *
   * A name as a research profile: its ENSIP-5 profile records and the live
   * artifacts it vouches for. An artifact is listed only when its author string
   * claims this name AND was signed by the key the name's `io.carpool.key`
   * record names, so anyone can publish claiming a name, and only the name's
   * owner decides which of those claims the name lists. Claims by other keys
   * are counted, not listed.
   */
  app.get("/ens/:name", async (req: Request, res: Response) => {
    const name = req.params.name!;
    try {
      assertNormalisedEnsName(name);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const cfg = loadEnsConfig();
    let key: string | null;
    try {
      key = await keyRecordOf(name);
    } catch (e) {
      res.status(503).json({ error: `could not read ${name} from ENS: ${(e as Error).message.split("\n")[0]}`, network: cfg.chain });
      return;
    }

    const claiming = ledger
      .listLive(10_000)
      .map((l) => ({ l, a: safeParse(l.manifest.author) }))
      .filter((x) => x.a?.name === name);
    const mine = key ? claiming.filter((x) => x.a!.id().toLowerCase() === key) : [];

    let binding: EnsBinding | null = null;
    if (mine.length > 0) {
      binding = await checkEnsBinding(mine[0]!.a!, getEnsReader(cfg), { timeoutMs: cfg.timeoutMs });
    }
    const profile = await readEnsProfile(name, getEnsReader(cfg), cfg.timeoutMs);

    res.json({
      name,
      network: cfg.chain,
      keyRecord: key,
      binding,
      profile,
      artifacts: mine.map(({ l }) => ({
        magnet: l.manifest.magnet,
        question: l.manifest.question,
        abstract: l.manifest.abstract,
        scope: l.manifest.scope,
        priceNow: l.priceNow,
        ageDays: l.ageDays,
        producedAt: l.manifest.decay.producedAt,
      })),
      unverifiedClaims: claiming.length - mine.length,
    });
  });
}

function safeParse(author: string) {
  try {
    return parseEnsAuthor(author);
  } catch {
    return null;
  }
}
