#!/usr/bin/env python3
"""
Independent verifier for v2's first real testnet run (2026-09-12).

Depends on nothing in this repository: the Merkle implementation below is a
re-implementation from `packages/hedera-x402/src/merkle.ts`'s documented rules,
and every fact it checks is pulled live from Hedera's public testnet mirror
node. Run it and it either agrees with docs/evidence/README.md or it does not.

    python3 docs/evidence/v2-first-testnet-run/verify.py

Checks, in order:
  1. the x402 purchase transfer moved 110,000 µUSDC buyer -> registry
  2. the settlement transfer moved 109,500 µUSDC registry -> author
  3. the batch memo on chain is the memo the registry recorded
  4. the anchor topic holds exactly one message
  5. that message's merkleRoot re-derives from the three leaves of the epoch
  6. sha256 of the paid body equals the manifest's bodyHash
"""

import hashlib
import json
import os
import sys
import urllib.request

MIRROR = "https://testnet.mirrornode.hedera.com"

PURCHASE_TX = "0.0.7162784-1789202339-427560739"
SETTLE_TX = "0.0.10475802-1789202482-460233839"
TOPIC = "0.0.10496824"
TOKEN = "0.0.429274"

BUYER = "0.0.10477413"
REGISTRY = "0.0.10475802"
AUTHOR = "0.0.10475801"

PRICE = 110_000
ROYALTY = 109_500
TRACKER_FEE = 500

BATCH_MEMO = "carpool:batch:1:f25a8a34"
MANIFEST_HASH = "e38566220be6a9ddcbd11300bf3d16da6d41340a3dd7a6f94f16be3010b2bdf0"
ANCHOR_ROOT = "aa11de684c48ef7fbf0f60c7a314c753e878ed0e7031318a563679c1a465bb0c"
BODY_HASH = "3524de7041e566a58ab01f5eb2745f7507259b089327b193bdfb841e28221ee0"

failures = []


def check(label, ok, detail=""):
    print(f"  {'OK  ' if ok else 'FAIL'}  {label:<52} {detail}")
    if not ok:
        failures.append(label)


def get(path):
    with urllib.request.urlopen(f"{MIRROR}{path}") as r:
        return json.load(r)


def token_delta(tx, account):
    return sum(t["amount"] for t in tx["token_transfers"] if t["account"] == account and t["token_id"] == TOKEN)


def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()


def merkle_root(leaves):
    """sorted leaves; leaf = sha256(leaf); internal = sha256(l+r); odd node promoted."""
    if not leaves:
        return sha("")
    level = [sha(leaf) for leaf in sorted(leaves)]
    while len(level) > 1:
        nxt = []
        for i in range(0, len(level), 2):
            left = level[i]
            right = level[i + 1] if i + 1 < len(level) else None
            nxt.append(left if right is None else sha(left + right))
        level = nxt
    return level[0]


print("\n  carpool v2 — first real testnet run, independent verification")
print("  " + "-" * 70)

# 1. the purchase
tx = get(f"/api/v1/transactions/{PURCHASE_TX}")["transactions"][0]
check("purchase result", tx["result"] == "SUCCESS", tx["result"])
check("purchase: buyer debited", token_delta(tx, BUYER) == -PRICE, f"{token_delta(tx, BUYER)} µUSDC")
check("purchase: registry credited", token_delta(tx, REGISTRY) == PRICE, f"+{token_delta(tx, REGISTRY)} µUSDC")
check("purchase consensus timestamp", True, tx["consensus_timestamp"])

# 2. the settlement
st = get(f"/api/v1/transactions/{SETTLE_TX}")["transactions"][0]
check("settlement result", st["result"] == "SUCCESS", st["result"])
check("settlement: author paid", token_delta(st, AUTHOR) == ROYALTY, f"+{token_delta(st, AUTHOR)} µUSDC")
check("settlement: registry debited", token_delta(st, REGISTRY) == -ROYALTY, f"{token_delta(st, REGISTRY)} µUSDC")
check(
    "royalty + tracker fee == price",
    ROYALTY + TRACKER_FEE == PRICE,
    f"{ROYALTY} + {TRACKER_FEE} = {PRICE}",
)
import base64  # noqa: E402  (only needed from here down)

memo = base64.b64decode(st["memo_base64"]).decode()
check("settlement memo", memo == BATCH_MEMO, memo)
check("settlement consensus timestamp", True, st["consensus_timestamp"])

# 3. the anchor
msgs = get(f"/api/v1/topics/{TOPIC}/messages?limit=25")["messages"]
check("anchor topic message count", len(msgs) == 1, f"{len(msgs)} on topic {TOPIC}")
if msgs:
    m = msgs[0]
    body = json.loads(base64.b64decode(m["message"]).decode())
    check("anchor sequence number", m["sequence_number"] == 1, str(m["sequence_number"]))
    check("anchor consensus timestamp", True, m["consensus_timestamp"])
    check("anchor submitted by the registry", m["payer_account_id"] == REGISTRY, m["payer_account_id"])
    check(
        "anchor names the settlement transaction",
        body["batchTxIds"] == [SETTLE_TX.replace("-", "@", 1).replace("-", ".")],
        ", ".join(body["batchTxIds"]),
    )
    check("anchor leafCount", body["leafCount"] == 3, str(body["leafCount"]))
    leaves = [MANIFEST_HASH, f"{AUTHOR}:{ROYALTY}", f"{REGISTRY}:{TRACKER_FEE}"]
    root = merkle_root(leaves)
    check("anchored merkleRoot re-derives from the epoch's leaves", root == body["merkleRoot"] == ANCHOR_ROOT, root)

# 4. the body
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "artifact-body.txt"), "rb") as f:
    raw = f.read()
check("paid body sha256 == manifest bodyHash", hashlib.sha256(raw).hexdigest() == BODY_HASH, hashlib.sha256(raw).hexdigest())
check("paid body length == manifest bodyBytes", len(raw) == 3374, f"{len(raw)} bytes")

print("  " + "-" * 70)
if failures:
    print(f"  {len(failures)} CHECK(S) FAILED: {', '.join(failures)}\n")
    sys.exit(1)
print("  all checks passed — the run is as documented\n")
