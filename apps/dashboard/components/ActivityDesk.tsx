/**
 * Every sale and every refund as it lands, from `GET /events`.
 *
 * ## Why it is a screen of its own now
 *
 * It used to be a rail pinned beside the artifact panel, which meant three
 * things competed for one screen: the table you were scanning, the artifact you
 * had opened, and a feed that changed under both of them. A feed is worth
 * watching or it is not; it is not worth glancing at while reading something
 * else. Behind secondary navigation it can be wide, legible and complete.
 *
 * ## The cursor is on screen on purpose
 *
 * `/events` speaks unix **seconds**. An earlier dashboard sent milliseconds, so
 * `since` was three orders of magnitude too large, every poll matched nothing,
 * and the feed silently re-served the same window for ever. Printing the live
 * cursor makes that entire class of bug visible in one glance: a cursor near
 * 1.8e9 is seconds, one near 1.8e12 is the bug.
 */
"use client";

import type { CarpoolEvent } from "../lib/api";
import { eventKey } from "../lib/events";
import { acctUrl, fmtTime, fmtUsd, shortId, txUrl } from "../lib/format";
import { Band, Caveat, CornerMark, Out, Panel, Section, Td, Term, Th } from "./primitives";

export function ActivityDesk({
  events,
  cursorSeconds,
  error,
  pollSeconds,
  eventLookbackSeconds,
}: {
  events: CarpoolEvent[];
  cursorSeconds: number;
  error: string | null;
  pollSeconds: number;
  eventLookbackSeconds: number;
}) {
  const hours = Math.round(eventLookbackSeconds / 3600);
  return (
    <Section
      eyebrow="Live activity"
      title="Money moving, as it happens"
      deck={["Money moving,", "as it happens"]}
      node="34%"
      lede={`Every sale and refund, read every ${pollSeconds} seconds from ${hours} hours back.`}
      right={
        <p className="text-sm">
          {error ? (
            <span className="text-debit">the feed stalled</span>
          ) : (
            <span className="text-credit">reading</span>
          )}
        </p>
      }
    >
      {error ? (
        <Band tone="debit" className="px-5 py-5">
          <p className="text-base text-debit">The event feed did not answer: {error}</p>
          <Caveat summary="What is still true" className="mt-3">
            <p>Every other screen reads a different route and is unaffected.</p>
            <p>
              This is the only one that goes blank when the feed does, which is the honest outcome:
              it has nothing else to show.
            </p>
          </Caveat>
        </Band>
      ) : events.length === 0 ? (
        <Panel tone="raised" className="relative overflow-hidden">
          <div className="graph-paper">
            <div className="mx-auto max-w-[58ch] px-6 py-14">
              <h3 className="text-xl font-medium text-ink">Nothing has changed hands recently</h3>
              <p className="mt-3 text-base text-ink-soft">
                No purchases and no refunds in the window being polled.
              </p>
              <p className="mt-3 text-base text-ink-soft">
                A sale lands here within {pollSeconds} seconds of settling, with the account that
                paid and the transaction.
              </p>
            </div>
          </div>
          <CornerMark kind="triangle" className="absolute bottom-3 left-3" />
        </Panel>
      ) : (
        <div className="max-w-[1000px] overflow-x-auto rounded-lg bg-paper">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">
              Purchases and refunds, newest first, with the amount, the buying account and the
              transaction.
            </caption>
            <thead className="bg-plate">
              <tr>
                <Th>what</Th>
                <Th right>amount</Th>
                <Th>account</Th>
                <Th>transaction</Th>
                <Th right>when</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const purchase = e.type === "purchase";
                return (
                  <tr key={eventKey(e)} className="transition-colors duration-150 ease-out hover:bg-panel">
                    <Td>
                      <span className={purchase ? "text-credit" : "text-debit"}>
                        {purchase ? "bought" : "refunded"}
                      </span>
                    </Td>
                    <Td right className="font-mono">
                      {fmtUsd(e.data.paid)}
                    </Td>
                    <Td>
                      <Out href={acctUrl(e.data.buyer)} className="font-mono text-xs">
                        {shortId(e.data.buyer, 10, 4)}
                      </Out>
                    </Td>
                    <Td>
                      <Out href={txUrl(e.data.txId)} className="font-mono text-xs">
                        {shortId(e.data.txId, 10, 4)}
                      </Out>
                    </Td>
                    <Td right dim title={new Date(e.ts * 1000).toLocaleString()}>
                      {fmtTime(e.ts)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-sm text-ink-soft">
        Reading everything after{" "}
        <Term
          word={`since=${cursorSeconds}`}
          means="Unix seconds, exclusive. Taken from the newest event actually received rather than from this browser's clock, so a poll can neither re-deliver nor skip an event."
        />
        .
      </p>
      <Caveat summary="Why the cursor is on screen" className="mt-3">
        <p>
          A cursor three orders of magnitude too large is a bug that otherwise looks exactly like a
          quiet feed.
        </p>
      </Caveat>
    </Section>
  );
}
