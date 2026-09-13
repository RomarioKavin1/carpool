#!/usr/bin/env node
// Re-checks the ENSv2 live payout proof against live networks, with ZERO imports from this
// repository and zero npm dependencies: Node 18+ standard library and fetch only.
//
//   node docs/evidence/ensv2-live-payout/verify.mjs
//
// Optional: SEPOLIA_RPC (default https://ethereum-sepolia-rpc.publicnode.com),
//           MIRROR (default https://testnet.mirrornode.hedera.com).
//
// keccak-256 and secp256k1 verification are implemented below in plain BigInt code so the
// check does not trust any library this project also uses.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(HERE, f), "utf8"));
const RPC = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const MIRROR = process.env.MIRROR || "https://testnet.mirrornode.hedera.com";

// ----------------------------------------------------------------- the claim, as recorded
const NAME = "remotemppp.eth";
const LABEL = "remotemppp";
const OWNER = "0x8ca0Bf095F2407B7C1AB894E6852C3474e04B520";
const PAYOUT = "0.0.10475801";
const ETH_REGISTRY = "0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2"; // docs.ens.domains, Sepolia ENSv2 Beta
const UNIVERSAL_RESOLVER = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe";
const reg = load("sepolia-registration.json");
const recs = load("sepolia-records.json");
const sale = load("publish-and-buy.json");
const mirrorSaved = load("mirror.json");
const state = load("registry-state.json");

let failures = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};

// ----------------------------------------------------------------- keccak-256
const RC = [
  "0x0000000000000001", "0x0000000000008082", "0x800000000000808a", "0x8000000080008000", "0x000000000000808b",
  "0x0000000080000001", "0x8000000080008081", "0x8000000000008009", "0x000000000000008a", "0x0000000000000088",
  "0x0000000080008009", "0x000000008000000a", "0x000000008000808b", "0x800000000000008b", "0x8000000000008089",
  "0x8000000000008003", "0x8000000000008002", "0x8000000000000080", "0x000000000000800a", "0x800000008000000a",
  "0x8000000080008081", "0x8000000000008080", "0x0000000080000001", "0x8000000080008008",
].map(BigInt);
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M64 = (1n << 64n) - 1n;
const rotl = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64);
function keccakF(s) {
  for (let round = 0; round < 24; round++) {
    const c = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20]);
    const d = [0, 1, 2, 3, 4].map((x) => c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1));
    for (let i = 0; i < 25; i++) s[i] ^= d[i % 5];
    const b = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = b[x + 5 * y] ^ (~b[((x + 1) % 5) + 5 * y] & M64 & b[((x + 2) % 5) + 5 * y]);
    s[0] ^= RC[round];
  }
}
function keccak256(bytes) {
  const rate = 136;
  const padded = new Uint8Array(Math.floor(bytes.length / rate) * rate + rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let k = 7; k >= 0; k--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + k]);
      s[i] ^= lane;
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number((s[Math.floor(i / 8)] >> BigInt(8 * (i % 8))) & 0xffn);
  return out;
}
const hex = (b) => Buffer.from(b).toString("hex");
const utf8 = (s) => new Uint8Array(Buffer.from(s, "utf8"));
const fromHex = (h) => new Uint8Array(Buffer.from(h.replace(/^0x/, ""), "hex"));
check(hex(keccak256(utf8(""))) === "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", "keccak-256 self-test");

// ----------------------------------------------------------------- secp256k1 verify
const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const mod = (a, m = P) => ((a % m) + m) % m;
const inv = (a, m = P) => {
  let [lo, hi, x0, x1] = [mod(a, m), m, 1n, 0n];
  while (lo > 1n) {
    const q = hi / lo;
    [lo, hi, x0, x1] = [hi - q * lo, lo, x1 - q * x0, x0];
  }
  return mod(x0, m);
};
const add = (p, q) => {
  if (!p) return q;
  if (!q) return p;
  if (p[0] === q[0] && mod(p[1] + q[1]) === 0n) return null;
  const l = p[0] === q[0] ? mod(3n * p[0] * p[0] * inv(2n * p[1])) : mod((q[1] - p[1]) * inv(q[0] - p[0]));
  const x = mod(l * l - p[0] - q[0]);
  return [x, mod(l * (p[0] - x) - p[1])];
};
const mul = (k, p) => {
  let r = null;
  for (let a = p; k > 0n; k >>= 1n, a = add(a, a)) if (k & 1n) r = add(r, a);
  return r;
};
const big = (b) => BigInt(`0x${hex(b) || "0"}`);
const powmod = (b, e, m) => {
  let r = 1n;
  for (b = mod(b, m); e > 0n; e >>= 1n, b = mod(b * b, m)) if (e & 1n) r = mod(r * b, m);
  return r;
};
function decompress(pub) {
  const x = big(pub.slice(1));
  let y = powmod(mod(x ** 3n + 7n), (P + 1n) / 4n, P);
  if ((y & 1n) !== BigInt(pub[0] & 1)) y = P - y;
  return [x, y];
}
function verifySecp(pubCompressed, digest, sig64) {
  const r = big(sig64.slice(0, 32));
  const s = big(sig64.slice(32, 64));
  if (r <= 0n || r >= N || s <= 0n || s >= N) return false;
  const w = inv(s, N);
  const pt = add(mul(mod(big(digest) * w, N), G), mul(mod(r * w, N), decompress(pubCompressed)));
  return pt !== null && mod(pt[0], N) === r;
}

// ----------------------------------------------------------------- ABI + RPC helpers
const pad32 = (b) => {
  const out = new Uint8Array(Math.ceil(b.length / 32) * 32 || 0);
  out.set(b);
  return out;
};
const word = (n) => fromHex(BigInt(n).toString(16).padStart(64, "0"));
const concat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));
const selector = (sig) => keccak256(utf8(sig)).slice(0, 4);
/** Encodes (arg0, arg1, ...) where each arg is {static: Uint8Array(32)} or {dynamic: Uint8Array}. */
function encodeArgs(args) {
  let head = [];
  let tail = [];
  let offset = args.length * 32;
  for (const a of args) {
    if (a.static) head.push(a.static);
    else {
      head.push(word(offset));
      const enc = concat(word(a.dynamic.length), pad32(a.dynamic));
      tail.push(enc);
      offset += enc.length;
    }
  }
  return concat(...head, ...tail);
}
const call = async (to, data, block = "latest") => {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data: `0x${hex(data)}` }, block] }),
  }).then((x) => x.json());
  if (r.error) throw new Error(`eth_call ${to}: ${r.error.message}`);
  return fromHex(r.result);
};
const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((x) => x.json());
  if (r.error) throw new Error(`${method}: ${r.error.message}`);
  return r.result;
};
const readDynamic = (ret, at) => {
  const off = Number(big(ret.slice(at, at + 32)));
  const len = Number(big(ret.slice(off, off + 32)));
  return ret.slice(off + 32, off + 32 + len);
};
const addrOf = (w32) => `0x${hex(w32.slice(12, 32))}`;
function namehash(name) {
  let node = new Uint8Array(32);
  for (const label of name.split(".").reverse()) node = keccak256(concat(node, keccak256(utf8(label))));
  return node;
}
const dnsEncode = (name) => concat(...name.split(".").map((l) => concat(Uint8Array.of(utf8(l).length), utf8(l))), Uint8Array.of(0));
const hederaBytes = (acct) => {
  const [s, r, n] = acct.split(".").map(BigInt);
  return concat(fromHex(s.toString(16).padStart(8, "0")), fromHex(r.toString(16).padStart(16, "0")), fromHex(n.toString(16).padStart(16, "0")));
};

// ----------------------------------------------------------------- Sepolia: registration
console.log(`\nSepolia (${RPC})`);
for (const [step, hash] of [["deployResolver", reg.deployResolver.hash], ["commit", reg.commit.hash], ["register", reg.register.hash], ["records multicall", recs.recordsTx.hash]]) {
  const rc = await rpc("eth_getTransactionReceipt", [hash]);
  check(rc?.status === "0x1", `${step} tx succeeded`, hash);
  if (step === "register") check(rc.from.toLowerCase() === OWNER.toLowerCase(), "register was sent by the owner wallet");
}
const node = namehash(NAME);
const labelId = big(keccak256(utf8(LABEL)));
const stateRet = await call(ETH_REGISTRY, concat(selector("getState(uint256)"), word(labelId)));
const status = Number(big(stateRet.slice(0, 32)));
const tokenId = big(stateRet.slice(96, 128));
check(status === 2, "ETHRegistry.getState: REGISTERED", `status ${status}`);
const owner = addrOf(await call(ETH_REGISTRY, concat(selector("ownerOf(uint256)"), word(tokenId))));
check(owner.toLowerCase() === OWNER.toLowerCase(), "ETHRegistry.ownerOf(tokenId) is the registering wallet", owner);
const resolver = addrOf(await call(ETH_REGISTRY, concat(selector("getResolver(string)"), encodeArgs([{ dynamic: utf8(LABEL) }]))));
check(resolver.toLowerCase() === recs.resolver.toLowerCase(), "ETHRegistry.getResolver matches the resolver the records were set on", resolver);

// ----------------------------------------------------------------- Sepolia: records via the Universal Resolver
const urResolve = async (inner) => {
  const ret = await call(UNIVERSAL_RESOLVER, concat(selector("resolve(bytes,bytes)"), encodeArgs([{ dynamic: dnsEncode(NAME) }, { dynamic: inner }])));
  return { result: readDynamic(ret, 0), resolver: addrOf(ret.slice(32, 64)) };
};
const addrRes = await urResolve(concat(selector("addr(bytes32,uint256)"), node, word(3030)));
const addrBytes = readDynamic(addrRes.result, 0);
check(addrRes.resolver.toLowerCase() === resolver.toLowerCase(), "Universal Resolver answered from the same v2 resolver");
check(hex(addrBytes) === hex(hederaBytes(PAYOUT)), `addr(node, 3030) decodes to ${PAYOUT}`, `0x${hex(addrBytes)}`);
const text = async (key) => Buffer.from(readDynamic((await urResolve(concat(selector("text(bytes32,string)"), encodeArgs([{ static: node }, { dynamic: utf8(key) }])))).result, 0)).toString("utf8");
const keyRec = await text("io.carpool.key");
const sigRec = await text("io.carpool.payout-sig");
const authorKey = sale.author.split(":")[3];
check(sale.author === `ens:${NAME}:${PAYOUT}:${authorKey}`, "the sold manifest's author string names this ENS name");
check(keyRec.toLowerCase().replace(/^0x/, "") === authorKey.toLowerCase(), "io.carpool.key equals the key in the manifest author");
const attestation = createHash("sha256").update(`carpool:ens-payout:v1:${NAME}:${PAYOUT}`, "utf8").digest();
const digest = keccak256(attestation); // Hedera ECDSA signs keccak256(message)
check(verifySecp(fromHex(keyRec), digest, fromHex(sigRec)), "io.carpool.payout-sig verifies under that key over the payout attestation");
for (const [k, v] of Object.entries({ description: "Carpool research author on Hedera testnet", url: "https://carpool-dashboard-plum.vercel.app" })) {
  check((await text(k)) === v, `text ${k}`);
}
const tampered = fromHex(sigRec);
tampered[40] ^= 1;
check(!verifySecp(fromHex(keyRec), digest, tampered), "a one-bit change to the signature fails verification (the verifier is not vacuous)");
check(!verifySecp(fromHex(keyRec), keccak256(createHash("sha256").update(`carpool:ens-payout:v1:${NAME}:0.0.1`).digest()), fromHex(sigRec)), "the attestation does not verify for a different account");

// ----------------------------------------------------------------- Hedera testnet
console.log(`\nHedera testnet (${MIRROR})`);
const mid = (t) => t.replace("@", "-").replace(/\.(\d+)$/, "-$1");
const tx = async (id) => (await fetch(`${MIRROR}/api/v1/transactions/${mid(id)}`).then((r) => r.json())).transactions?.[0];
const buy = await tx(mirrorSaved.txs.x402Purchase);
const buyer = state.purchases[0].buyer;
const registry = load("registry-well-known.json").settlementAccount;
check(buy?.result === "SUCCESS", "x402 purchase SUCCESS", mirrorSaved.txs.x402Purchase);
check(
  buy?.token_transfers?.some((t) => t.account === registry && t.amount === state.purchases[0].paid) &&
    buy?.token_transfers?.some((t) => t.account === buyer && t.amount === -state.purchases[0].paid),
  `x402 moved ${state.purchases[0].paid} µUSDC ${buyer} -> ${registry}`,
);
const settle = await tx(mirrorSaved.txs.royaltySettlement);
const royalty = load("registry-payouts.json").payouts.find((p) => p.reason === "author_royalty");
check(settle?.result === "SUCCESS", "royalty settlement SUCCESS", mirrorSaved.txs.royaltySettlement);
check(
  settle?.token_transfers?.some((t) => t.account === PAYOUT && t.amount === royalty.amount),
  `settlement paid ${royalty.amount} µUSDC to ${PAYOUT}, the account in the name's addr(3030) record`,
);
check(state.purchases[0].payoutVia === `ens:${NAME}`, `registry recorded payoutVia "ens:${NAME}" (saved /state, not live)`);
const topic = load("hcs-topic-create.json").topicId;
const msgs = (await fetch(`${MIRROR}/api/v1/topics/${topic}/messages`).then((r) => r.json())).messages ?? [];
const decoded = msgs.map((m) => JSON.parse(Buffer.from(m.message, "base64").toString("utf8")));
check(decoded.some((d) => d.batchTxIds?.includes(mirrorSaved.txs.royaltySettlement)), `HCS topic ${topic} holds an anchor naming the settlement tx`);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
