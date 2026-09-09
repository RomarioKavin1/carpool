import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "@carpool/hedera-x402";

/** The paid half of an artifact. Anything larger is rejected at publish, not truncated. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Content-addressed body storage: filename = body_hash. There is exactly one
 * way to name a blob, so two authors publishing byte-identical bodies share
 * storage, and a filename is never trusted without re-hashing what it names.
 */
export class BodyStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private pathFor(hash: string): string {
    // Defence in depth: body_hash is already validated as /^[0-9a-f]{64}$/ by
    // ManifestSchema before it ever reaches here, but never build a filesystem
    // path from unvalidated input.
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`not a sha256 hex digest: ${hash}`);
    return join(this.dir, hash);
  }

  /** Rejects a body over MAX_BODY_BYTES or one that does not hash to `hash`. */
  write(hash: string, content: string): void {
    const buf = Buffer.from(content, "utf8");
    if (buf.byteLength > MAX_BODY_BYTES) {
      throw new Error(`body is ${buf.byteLength} bytes, over the ${MAX_BODY_BYTES}-byte cap`);
    }
    const actual = sha256(content);
    if (actual !== hash) {
      throw new Error(`body does not hash to ${hash} (got ${actual})`);
    }
    writeFileSync(this.pathFor(hash), buf);
  }

  has(hash: string): boolean {
    return existsSync(this.pathFor(hash));
  }

  /**
   * Reads and re-verifies against `hash`. Throws rather than returning
   * corrupted bytes — the caller (GET /artifact/:magnet) turns that into a
   * 502 + refund_due, never a 200 with bad content.
   */
  read(hash: string): string {
    const buf = readFileSync(this.pathFor(hash));
    const content = buf.toString("utf8");
    const actual = sha256(content);
    if (actual !== hash) {
      throw new Error(`stored body for ${hash} no longer hashes to it (got ${actual})`);
    }
    return content;
  }
}
