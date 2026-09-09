import { Client, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { merkleRoot } from "./merkle.js";

const PLACEHOLDER = "0.0.000000";

export interface AnchorPayload {
  /** Opaque leaves for this epoch: payout rows, manifest hashes, or both. */
  leaves: string[];
  /** Transactions this epoch produced. */
  batchTxIds: string[];
  /** Anything the product wants on the record. Must be JSON-serialisable. */
  extra?: Record<string, unknown>;
}

export interface AnchorResult {
  anchored: boolean;
  /** Present when anchored. */
  root?: string;
  message?: Record<string, unknown>;
  /** Why it was skipped, when it was. */
  skipped?: "empty" | "no-topic" | "no-client";
}

export interface AnchorOptions {
  client: Client | null;
  topicId?: string;
  /**
   * Anchor an epoch that produced nothing. Default false.
   *
   * v1 had no such switch and anchored unconditionally at the end of every
   * settle run, so the live testnet topic carries 13 messages for 1 batch —
   * twelve of them over empty epochs, all with the same root, each costing a
   * real HCS fee. An anchor that says nothing changed is not evidence.
   */
  anchorEmpty?: boolean;
}

/**
 * Submit one epoch summary to HCS.
 *
 * Differs from v1 in three ways, each deliberate:
 *  - the payload is an argument, not read from a product config file
 *  - the root is over THIS epoch's leaves, not every row ever accrued, so
 *    consecutive anchors differ when the data differs
 *  - an empty epoch is skipped rather than anchored
 */
export async function anchorEpoch(
  payload: AnchorPayload,
  opts: AnchorOptions,
): Promise<AnchorResult> {
  const topic = opts.topicId ?? process.env.HCS_TOPIC_ID;
  if (!topic || topic === PLACEHOLDER) return { anchored: false, skipped: "no-topic" };
  if (!opts.client) return { anchored: false, skipped: "no-client" };

  const isEmpty = payload.leaves.length === 0 && payload.batchTxIds.length === 0;
  if (isEmpty && !opts.anchorEmpty) return { anchored: false, skipped: "empty" };

  const root = merkleRoot(payload.leaves);
  const message = {
    epoch: Date.now(),
    batchTxIds: payload.batchTxIds,
    merkleRoot: root,
    leafCount: payload.leaves.length,
    ...(payload.extra ?? {}),
  };

  const resp = await new TopicMessageSubmitTransaction()
    .setTopicId(topic)
    .setMessage(JSON.stringify(message))
    .execute(opts.client);
  await resp.getReceipt(opts.client);

  return { anchored: true, root, message };
}
