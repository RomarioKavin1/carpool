/**
 * `anchorEpoch`, including the branch that actually submits.
 *
 * Three of these tests used to exercise only its *skip* branches, and two more
 * sat under this describe block while calling nothing but `merkleRoot()` — so
 * the `anchored: true` path, the one that spends HBAR, had no coverage in this
 * package at all (docs/AUDIT-TESTS.md). It is covered a layer up, in
 * `apps/registry/src/settlement.test.ts`, which is not the same thing: the
 * message shape, the topic it goes to and the root it commits are this
 * function's contract, and a consumer's test is not where they belong.
 *
 * The SDK's transaction class is faked, so nothing here touches a network.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { anchorEpoch } from "./anchor.js";
import { merkleRoot } from "./merkle.js";

const submitted: { topicId: string; message: string }[] = [];
let receiptError: Error | null = null;

vi.mock("@hiero-ledger/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hiero-ledger/sdk")>();
  class FakeTopicMessageSubmitTransaction {
    private topicId = "";
    private message = "";
    setTopicId(t: string) {
      this.topicId = t;
      return this;
    }
    setMessage(m: string) {
      this.message = m;
      return this;
    }
    async execute(_client: unknown) {
      submitted.push({ topicId: this.topicId, message: this.message });
      return {
        getReceipt: async () => {
          if (receiptError) throw receiptError;
          return {};
        },
      };
    }
  }
  return { ...actual, TopicMessageSubmitTransaction: FakeTopicMessageSubmitTransaction };
});

const client = {} as never;

beforeEach(() => {
  submitted.length = 0;
  receiptError = null;
});

describe("anchorEpoch", () => {
  it("skips an empty epoch — the v1 defect that produced 13 anchors for 1 batch", async () => {
    const r = await anchorEpoch({ leaves: [], batchTxIds: [] }, { client, topicId: "0.0.1" });
    expect(r.anchored).toBe(false);
    expect(r.skipped).toBe("empty");
    expect(submitted, "and nothing was submitted, which is where the fee would be").toEqual([]);
  });

  it("skips without a topic rather than throwing", async () => {
    const r = await anchorEpoch({ leaves: ["a"], batchTxIds: [] }, { client });
    expect(r.anchored).toBe(false);
    expect(r.skipped).toBe("no-topic");
    expect(submitted).toEqual([]);
  });

  it("skips without a client", async () => {
    const r = await anchorEpoch({ leaves: ["a"], batchTxIds: [] }, { client: null, topicId: "0.0.1" });
    expect(r.skipped).toBe("no-client");
    expect(submitted).toEqual([]);
  });

  it("submits one message to the configured topic, committing this epoch's root", async () => {
    const leaves = ["0.0.1111:9500", "0.0.9999:500"];
    const r = await anchorEpoch(
      { leaves, batchTxIds: ["0.0.9@1.0"], extra: { artifactCount: 0, payeeCount: 2 } },
      { client, topicId: "0.0.777" },
    );

    expect(r.anchored).toBe(true);
    expect(r.root, "the root is over the leaves it was given").toBe(merkleRoot(leaves));
    expect(submitted, "exactly one consensus message, and one fee").toHaveLength(1);
    expect(submitted[0]!.topicId).toBe("0.0.777");

    // The message is the public record: everything a third party needs to check
    // the root against the payouts they were told about.
    const msg = JSON.parse(submitted[0]!.message);
    expect(msg).toMatchObject({
      merkleRoot: merkleRoot(leaves),
      leafCount: 2,
      batchTxIds: ["0.0.9@1.0"],
      artifactCount: 0,
      payeeCount: 2,
    });
    expect(typeof msg.epoch, "timestamped, so two identical epochs are distinguishable").toBe(
      "number",
    );
    expect(r.message).toEqual(msg);
  });

  it("anchors a non-empty epoch with no batches — a publish is a fact worth timestamping", async () => {
    const manifestHash = "9f3a".repeat(16);
    const r = await anchorEpoch(
      { leaves: [manifestHash], batchTxIds: [], extra: { artifactCount: 1, payeeCount: 0 } },
      { client, topicId: "0.0.777" },
    );
    expect(r.anchored).toBe(true);
    expect(r.root).toBe(merkleRoot([manifestHash]));
    expect(r.root).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(submitted[0]!.message).leafCount).toBe(1);
  });

  it("anchors an empty epoch only when explicitly asked to", async () => {
    const r = await anchorEpoch({ leaves: [], batchTxIds: [] }, {
      client,
      topicId: "0.0.777",
      anchorEmpty: true,
    });
    expect(r.anchored).toBe(true);
    expect(submitted).toHaveLength(1);
    expect(JSON.parse(submitted[0]!.message).leafCount).toBe(0);
  });

  it("roots over this epoch's leaves, so consecutive epochs differ", async () => {
    // v1 rooted over every accrual ever, so the root never changed between
    // epochs — which is why all 13 live anchors carry an identical root.
    const first = await anchorEpoch({ leaves: ["a:1"], batchTxIds: [] }, { client, topicId: "0.0.777" });
    const second = await anchorEpoch(
      { leaves: ["a:1", "b:2"], batchTxIds: [] },
      { client, topicId: "0.0.777" },
    );
    expect(first.root).not.toBe(second.root);
    expect(submitted.map((s) => JSON.parse(s.message).merkleRoot)).toEqual([first.root, second.root]);
  });

  it("propagates a failed submission rather than reporting an anchor that did not happen", async () => {
    receiptError = new Error("receipt for transaction failed: INVALID_TOPIC_ID");
    // The caller (`runSettleEpochOnce`) marks artifacts anchored on
    // `anchor.anchored`, so a swallowed failure here would mark them anchored
    // against a consensus message that never landed, and no later epoch would
    // ever retry them.
    await expect(
      anchorEpoch({ leaves: ["a"], batchTxIds: [] }, { client, topicId: "0.0.777" }),
    ).rejects.toThrow(/INVALID_TOPIC_ID/);
  });
});
