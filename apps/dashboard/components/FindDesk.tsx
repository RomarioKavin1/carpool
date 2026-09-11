/**
 * Ask the registry whether anything already answers a question.
 *
 * ## The two modes stay visibly apart
 *
 * `GET /search` ranks when it is given a question and browses when it is not,
 * and CONTRACT.md is explicit that the difference is not cosmetic: a browse is
 * every live artifact newest first, with `score`, `similarity` and `depth` absent
 * because nothing was ranked. "Do not read a browse as a search."
 *
 * So the ranking columns are not dashed out in browse mode, they are not in the
 * table at all. A column of dashes would read as "these artifacts scored
 * nothing"; removing the columns says the only true thing, which is that no
 * ranking happened. The mode is read off the RESPONSE, never off the request.
 *
 * And an empty ranked response claims neither mode: zero hits carry no evidence
 * either way. The previous build turned "no evidence" into a positive claim,
 * titling a panel "browse" over a request that had asked a question and telling
 * the reader "nothing was ranked" directly above a paragraph correctly saying the
 * registry had ranked and rejected everything.
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError, getSearch, type SearchHit, type WellKnown } from "../lib/api";
import { fmtBytes, fmtDays, fmtUsd, pct, shortId } from "../lib/format";
import { SCORE_FORMULA, rankingOf, searchMode, type SearchMode } from "../lib/search";
import { DecayBarRow } from "./DecayBar";
import { Band, Button, Caveat, CornerMark, Field, Mark, Meter, NoData, Panel, Section, TableScroll, Td, Term, Th } from "./primitives";

interface Result {
  hits: SearchHit[];
  mode: SearchMode;
  /** What was actually asked. Null means the browse button was used. */
  query: string | null;
}

export function FindDesk({ wellKnown }: { wellKnown: WellKnown | null }) {
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const run = useCallback(async (query: string | null) => {
    inflight.current?.abort();
    const ctl = new AbortController();
    inflight.current = ctl;
    setBusy(true);
    setError(null);
    try {
      const hits = await getSearch({ q: query ?? undefined, limit: 25 }, ctl.signal);
      setResult({ hits, mode: searchMode(hits), query });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      const err = e as ApiError;
      setError(
        err.offline
          ? `${err.message}. The registry is not answering.`
          : `${err.message}${err.status ? ` (HTTP ${err.status})` : ""}`,
      );
    } finally {
      if (inflight.current === ctl) setBusy(false);
    }
  }, []);

  return (
    <Section
      eyebrow="Find research"
      title="Has somebody already answered this?"
      deck={["Has somebody already", "answered this?"]}
      node="27%"
      lede="Free, and it needs no account."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const q = draft.trim();
          if (q) void run(q);
        }}
        className="flex max-w-[76ch] flex-col gap-4 sm:flex-row sm:items-end"
      >
        <Field
          id="q"
          label="Your question"
          value={draft}
          onChange={setDraft}
          placeholder="why does the testnet faucet decline to mint to my account?"
        />
        <div className="flex shrink-0 gap-2">
          <Button variant="primary" type="submit" disabled={busy || draft.trim() === ""} loading={busy}>
            Rank it
          </Button>
          <Button
            onClick={() => {
              setDraft("");
              void run(null);
            }}
            disabled={busy}
          >
            List everything
          </Button>
        </div>
      </form>

      <Caveat summary="What the registry sees" className="mt-6">
        <p>
          Ranking sends your question text to the registry, so it receives it and can log it. An
          agent with its own embedder sends a vector instead.
        </p>
        <p>
          Neither is privacy: a short question can be largely recovered from its vector alone.
        </p>
        <p>
          This page has no embedder on purpose. A second embedding implementation in a browser bundle
          is how a client ends up searching an index the registry does not use.
          {wellKnown && (
            <>
              {" "}
              This one ranks with{" "}
              <span className="font-mono text-ink">
                {wellKnown.embedding.model} at {wellKnown.embedding.dim} dimensions
              </span>
              .
            </>
          )}
        </p>
      </Caveat>

      {error && (
        <Band tone="debit" className="mt-8 px-5 py-5">
          <p className="text-base text-debit">{error}</p>
          <Caveat summary="What that means" className="mt-3">
            <p>The message is the registry&rsquo;s own, passed through unchanged.</p>
            <p>
              A 503 means it could not turn the question into a vector and stored nothing, so
              retrying is worth doing.
            </p>
          </Caveat>
        </Band>
      )}

      {result && <Results result={result} />}

      {!result && !busy && !error && (
        <Panel tone="raised" className="relative mt-10 overflow-hidden">
          <div className="graph-paper">
          <div className="mx-auto max-w-[62ch] px-6 py-14">
            <h3 className="text-xl font-medium text-ink">Two buttons, two questions</h3>
            <p className="mt-3 text-base text-ink-soft">
              <span className="text-ink">Rank it</span> asks whether anything here already answers
              yours. The registry scores every candidate and drops the weak ones.
            </p>
            <p className="mt-3 text-base text-ink-soft">
              <span className="text-ink">List everything</span> asks for every artifact still on
              sale, newest first, ranked by nothing.
            </p>
            <Caveat summary="Why nothing back is still an answer" className="mt-5">
              <p>
                A ranked search that clears no artifact means an agent asking this would go and do
                the work itself. That is the case Carpool exists to find.
              </p>
            </Caveat>
          </div>
          </div>
          <CornerMark kind="triangle" className="absolute bottom-3 left-3" />
        </Panel>
      )}
    </Section>
  );
}

function Results({ result }: { result: Result }) {
  const ranked = result.mode === "ranked";
  /**
   * An empty response carries no evidence of a mode, so this claims none.
   * `searchMode([])` returns "browse" correctly, because zero hits prove nothing
   * either way; what must not happen is the UI turning that absence of evidence
   * into a positive claim. Which request was made is a separate fact,
   * legitimately known, and it is all `result.query` is used for.
   */
  const modeUnknowable = result.hits.length === 0 && result.query !== null;

  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h3 className="text-xl font-medium text-ink">
          {modeUnknowable
            ? "Nothing came back"
            : ranked
              ? "Ranked by the registry"
              : "Everything on sale, newest first"}
        </h3>
        <p className="flex items-center gap-3 text-sm text-ink-soft">
          {result.hits.length} result{result.hits.length === 1 ? "" : "s"}
          <Mark
            kind={ranked && !modeUnknowable ? "live" : "unobservable"}
            note={
              modeUnknowable
                ? "The registry returned nothing, so the response carries no score and no evidence of whether it ranked. This screen therefore claims neither mode."
                : ranked
                  ? "score, similarity and depth came from the registry's own ranking on this request."
                  : "The registry ranked nothing on this request, so it served no score and none is shown."
            }
          />
        </p>
      </div>

      {modeUnknowable ? (
        <>
          <p className="measure mt-3 text-base text-ink-soft">
            The registry was asked to rank and returned nothing.
          </p>
          <Caveat summary="Why this claims no mode" className="mt-3">
            <p>
              An empty response carries no score and no evidence of whether it ranked at all. It is
              not a listing, and it is not a ranking you can read.
            </p>
          </Caveat>
        </>
      ) : ranked ? (
        <>
          <p className="measure mt-3 text-base text-ink-soft">
            Scored as <span className="font-mono text-ink">{SCORE_FORMULA}</span>.
          </p>
          <Caveat summary="What was dropped" className="mt-3">
            <p>
              Anything below the registry&rsquo;s similarity threshold was dropped before you saw it,
              and so was anything expired.
            </p>
            <p>An artifact missing here is a judgement, not a gap.</p>
          </Caveat>
        </>
      ) : (
        <p className="measure mt-3 text-base text-ink-soft">
          <span className="text-ink">Nothing was ranked</span>, so the score, similarity and depth
          columns are absent rather than empty.
        </p>
      )}

      {result.hits.length === 0 ? (
        <p className="hairline-t measure mt-8 pt-6 text-base text-ink-soft">
          {result.query === null
            ? "The registry has nothing on sale to list."
            : `Nothing cleared the registry's similarity threshold for “${result.query}”.`}
        </p>
      ) : (
        <div className="mt-6">
          <TableScroll note="This table scrolls sideways; the page does not.">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <caption className="sr-only">
                {ranked
                  ? "Ranked results, with the registry's score, similarity and depth."
                  : "Artifacts still on sale, newest first, unranked."}
              </caption>
              <thead className="bg-plate">
                <tr>
                  <Th className="w-full min-w-[22ch]">what it answers</Th>
                  {ranked && (
                    <>
                      <Th right title={SCORE_FORMULA}>
                        score
                      </Th>
                      <Th right title="Cosine similarity between your question and the artifact's normalised question.">
                        similarity
                      </Th>
                      <Th right title="How much independent work the artifact's own provenance and source list evidence. The registry weights this rather than similarity alone.">
                        depth
                      </Th>
                    </>
                  )}
                  <Th right>age</Th>
                  <Th>life left</Th>
                  <Th>health</Th>
                  <Th right>size</Th>
                  <Th right>price now</Th>
                </tr>
              </thead>
              <tbody>
                {result.hits.map((h) => {
                  const rank = rankingOf(h);
                  return (
                    <tr key={h.magnet} className="transition-colors duration-150 ease-out hover:bg-panel">
                      <Td className="max-w-0">
                        <span className="block truncate text-ink" title={h.question}>
                          {h.scope ? <span className="text-ink-soft">{h.scope} / </span> : null}
                          {h.question}
                        </span>
                        <span className="tnum block truncate font-mono text-xs text-ink-soft">
                          {shortId(h.magnet, 13, 6)}
                        </span>
                      </Td>
                      {ranked && (
                        <>
                          <Td right className="font-mono">
                            {rank ? (
                              <span className="text-ink">{rank.score.toFixed(3)}</span>
                            ) : (
                              <NoData why="The registry did not serve a score for this element.">
                                not served
                              </NoData>
                            )}
                          </Td>
                          <Td right dim className="font-mono">
                            {rank ? rank.similarity.toFixed(3) : <NoData why="not served">not served</NoData>}
                          </Td>
                          <Td right dim className="font-mono">
                            {rank ? rank.depth.toFixed(2) : <NoData why="not served">not served</NoData>}
                          </Td>
                        </>
                      )}
                      <Td right dim title={`produced ${new Date(h.decay.producedAt).toLocaleString()}`}>
                        {fmtDays(h.ageDays)}
                      </Td>
                      <Td>
                        <DecayBarRow freshness={h.freshness} />
                      </Td>
                      <Td>
                        <Meter value={h.health} label={`health ${Math.round(h.health * 100)} out of 100`} />
                      </Td>
                      <Td right dim>
                        {fmtBytes(h.bodyBytes)}
                      </Td>
                      <Td right className="font-mono">
                        {fmtUsd(h.priceNow)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>

          {ranked && (
            <Caveat summary="Similar is not the same as worth buying" className="mt-6">
              <p>
                The top result is{" "}
                <span className="tnum font-mono text-ink">
                  {pct(rankingOf(result.hits[0]!)?.similarity ?? 0, 0)}
                </span>{" "}
                similar to what you asked.
              </p>
              <p>
                <Term
                  word="depth"
                  means="A normalised signal for how much independent work an artifact evidences: its own provenance figures and how many distinct sources it names."
                />{" "}
                is weighted alongside it, because people rarely fail to answer the same question.
                They answer it at different depths.
              </p>
            </Caveat>
          )}
        </div>
      )}
    </div>
  );
}
