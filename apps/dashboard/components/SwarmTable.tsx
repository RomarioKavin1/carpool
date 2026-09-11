/**
 * Everything on the registry, one row each, live or dead.
 *
 * This is where density becomes allowed. It is the fourth thing on the page, not
 * the first, so a reader arriving at it has already been told what an artifact
 * is and why its price falls. Rows are 16px of vertical padding rather than 4px
 * and the type is 14px rather than 11px, which is most of what "crammed" meant.
 *
 * ## Density is asked for, not imposed
 *
 * Five columns by default: what it answers, how old, how much life is left, how
 * many buyers, and what it costs right now. The other four (size, current
 * demand, sales per hour, health) are real and every one of them traces to a
 * served field, so none of them is deleted: they are behind one toggle. That is
 * `DESIGN.md`'s rule made operational. Air comes from sequencing information,
 * never from removing it.
 *
 * ## Expansion is in place
 *
 * Opening an artifact inserts a row directly beneath the one that was clicked,
 * inside the same table. Not a modal, not a panel elsewhere on the page: the
 * reader keeps the list they were scanning, and the row they opened stays where
 * their eye already is.
 *
 * ## What the reference changed here, and what it could not
 *
 * The reference page has no tables at all, so this is the place its language had
 * to be extended rather than copied. Three decisions:
 *
 * 1. **The table is the content of one large rounded panel**, `paper` on the
 *    `field` ground, rather than a grid ruled onto the page. The panel's own
 *    radius is what clips the header strip, which is why the scroll container
 *    carries it.
 * 2. **Rows are separated by whitespace, not by rules.** Every `border-b` is
 *    gone. A row is 14px of padding plus a hover fill, and the decay bar gives
 *    each row a horizontal anchor the eye can track along. This is the reference's
 *    separation principle applied to the one component it never had to solve.
 * 3. **An expanded artifact opens a different ground underneath it**: the
 *    expansion row is `field`, and the first thing in it is a solid `ink` panel.
 *    A reader can tell at a glance which row is open from anywhere on the page,
 *    which a tinted row alone never managed across thirty-eight rows.
 *
 * The clicked row itself stays light, on `wire-wash`. Making it dark as well was
 * the first draft and it was wrong: `wire` is this palette's selection colour and
 * the dark mass reads better as "here is the thing you opened" than as "this row
 * is now a different kind of row".
 *
 * Every column traces to a field the registry emits, via `lib/derive.ts`'s
 * `buildRows`, whose tests fail if any of those names are renamed. A dead
 * artifact keeps its row: it is a legible state for a swarm view, not something
 * to hide, and it is marked by a word rather than by lowering the contrast of
 * its numbers.
 */
"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Batch, Payout, RegistryState, WellKnown } from "../lib/api";
import {
  STATUS_MEANING,
  defaultDirFor,
  type ArtifactRow,
  type SortDir,
  type SortKey,
} from "../lib/derive";
import { fmtBytes, fmtDays, fmtUsd } from "../lib/format";
import { ArtifactDetail } from "./ArtifactDetail";
import { DecayBarRow } from "./DecayBar";
import { Badge, Meter, TableScroll, Td, Th } from "./primitives";

interface Column {
  key: SortKey;
  label: string;
  right?: boolean;
  title: string;
  /** Behind the "every column" toggle. Real data, one click away, never deleted. */
  extra?: boolean;
}

const COLUMNS: Column[] = [
  { key: "name", label: "what it answers", title: "The question the author says this artifact answers, from the signed manifest." },
  { key: "ageDays", label: "age", right: true, title: "Days since the author says they produced it, measured on the registry's clock." },
  { key: "bodyBytes", label: "size", right: true, extra: true, title: "How big the paid body is." },
  { key: "freshness", label: "life left", title: "How much of its original value is left. It halves once per half-life and stops selling at one eighth." },
  { key: "health", label: "health", extra: true, title: "Freshness, times one minus the refund rate, times a term for how many different accounts have bought it." },
  { key: "seed", label: "buyers", right: true, title: "Distinct accounts that have bought it, all time." },
  { key: "peer", label: "demand", right: true, extra: true, title: "Distinct accounts that bought it in the last hour." },
  { key: "ratePerHour", label: "sales/hr", right: true, extra: true, title: "Purchases in the last hour." },
  { key: "priceNow", label: "price now", right: true, title: "What it costs at this second: the floor plus the author's asking price scaled by freshness." },
];

export function SwarmTable({
  rows,
  state,
  wellKnown,
  nowMs,
  opened,
  onOpen,
  sort,
  onSort,
  showEveryColumn,
  payoutsFor,
  batches,
}: {
  rows: ArtifactRow[];
  state: RegistryState;
  wellKnown: WellKnown | null;
  nowMs: number;
  /** The magnet whose detail row is expanded, or null when none is. */
  opened: string | null;
  onOpen: (magnet: string | null) => void;
  sort: { key: SortKey; dir: SortDir };
  onSort: (s: { key: SortKey; dir: SortDir }) => void;
  showEveryColumn: boolean;
  payoutsFor: Payout[] | null;
  batches: Batch[];
}) {
  // Which prices moved since the last poll. The only cell allowed to animate.
  const previous = useRef<Map<string, number>>(new Map());
  const moved = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const before = previous.current.get(r.magnet);
      if (before !== undefined && before !== r.priceNow) set.add(r.magnet);
    }
    return set;
  }, [rows]);
  useEffect(() => {
    previous.current = new Map(rows.map((r) => [r.magnet, r.priceNow]));
  }, [rows]);

  const columns = showEveryColumn ? COLUMNS : COLUMNS.filter((c) => !c.extra);

  const click = (key: SortKey) =>
    onSort(
      sort.key === key
        ? { key, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { key, dir: defaultDirFor(key) },
    );

  return (
    <TableScroll note="This table scrolls sideways; the page does not.">
      <table
        /* Martian Mono is a WIDE mono. Swapping it in for the system stack
           raised every numeric column's intrinsic width, so these two minimums
           are up from 980/700, measured rather than guessed: below them the numeric
           columns start colliding rather than the container starting to scroll. */
        className={`w-full border-collapse text-sm ${showEveryColumn ? "min-w-[1120px]" : "min-w-[800px]"}`}
      >
        <caption className="sr-only">
          Everything the registry holds: what each artifact answers, how old it is, how much of its
          value is left, how many accounts have bought it and what it costs right now. Column
          headings sort. Opening a row expands its detail directly beneath it.
        </caption>
        <thead className="bg-plate">
          <tr>
            {columns.map((c) => (
              <Th
                key={c.key}
                right={c.right}
                title={c.title}
                onClick={() => click(c.key)}
                active={sort.key === c.key}
                dir={sort.dir}
                /* The question column takes the slack at wide widths instead of
                   letting surplus space open up between numeric columns. It was
                   capped at 34ch before, so the more screen you gave this table
                   the more it wasted. */
                className={c.key === "name" ? "w-full min-w-[22ch]" : undefined}
              >
                {c.label}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = row.magnet === opened;
            const artifact = isOpen
              ? (state.artifacts.find((a) => a.manifest.magnet === row.magnet) ?? null)
              : null;
            return (
              <RowGroup
                key={row.magnet}
                row={row}
                isOpen={isOpen}
                onOpen={onOpen}
                columns={columns}
                moved={moved.has(row.magnet)}
                artifact={artifact}
                state={state}
                wellKnown={wellKnown}
                nowMs={nowMs}
                payoutsFor={payoutsFor}
                batches={batches}
              />
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}

function RowGroup({
  row,
  isOpen,
  onOpen,
  columns,
  moved,
  artifact,
  state,
  wellKnown,
  nowMs,
  payoutsFor,
  batches,
}: {
  row: ArtifactRow;
  isOpen: boolean;
  onOpen: (magnet: string | null) => void;
  columns: Column[];
  moved: boolean;
  artifact: RegistryState["artifacts"][number] | null;
  state: RegistryState;
  wellKnown: WellKnown | null;
  nowMs: number;
  payoutsFor: Payout[] | null;
  batches: Batch[];
}) {
  const detailId = `artifact-${row.magnet.slice(-12)}`;
  const has = (k: SortKey) => columns.some((c) => c.key === k);

  return (
    <>
      <tr
        className={`transition-colors duration-150 ease-out ${
          isOpen
            ? "bg-wire-wash"
            : row.status === "live"
              ? "hover:bg-panel"
              : "bg-panel hover:bg-plate"
        }`}
      >
        <Td className="max-w-0">
          {/*
            One real button per row. The whole row is not a click target: a row
            that swallows text selection and reports nothing to a screen reader
            is not an affordance, it is a trap. This button IS the disclosure,
            and it says so.
          */}
          <button
            type="button"
            onClick={() => onOpen(isOpen ? null : row.magnet)}
            aria-expanded={isOpen}
            aria-controls={detailId}
            className="flex w-full items-center gap-2 text-left"
          >
            <span
              aria-hidden="true"
              className={`w-3 shrink-0 font-mono text-xs ${isOpen ? "text-wire" : "text-ink-faint"}`}
            >
              {isOpen ? "▾" : "▸"}
            </span>
            <span className="truncate text-ink" title={row.name}>
              {row.name}
            </span>
            {row.status === "withdrawn" && (
              <Badge tone="debit" title={STATUS_MEANING.withdrawn}>
                withdrawn
              </Badge>
            )}
            {row.status === "expired" && (
              <Badge tone="ember" title={STATUS_MEANING.expired}>
                expired
              </Badge>
            )}
            {row.anchoredAt != null && (
              <Badge
                tone="neutral"
                title={`This artifact's hash was included in a successful on-chain anchor at ${new Date(row.anchoredAt * 1000).toLocaleString()}. The registry keeps no per-anchor log, so that timestamp is all there is.`}
              >
                timestamped
              </Badge>
            )}
            {row.redacted && (
              <Badge tone="neutral" title="The author redacted part of this body before publishing it.">
                redacted
              </Badge>
            )}
          </button>
          {/*
            On a phone the price is the last of five columns and therefore off
            screen, and "scroll the table sideways to find out what it costs" is
            not an answer. The two numbers a reader actually wants ride along
            inside the identifying cell below `sm`, so nothing has to be scrolled
            to for them and nothing is duplicated where there is room for both.
          */}
          <span className="mt-1 flex items-center gap-4 pl-5 font-mono text-xs text-ink-soft sm:hidden">
            <span className="tnum text-ink">{fmtUsd(row.priceNow)}</span>
            <span className="tnum">{Math.round(row.freshness * 100)}% of its life left</span>
          </span>
        </Td>
        <Td right dim>
          {fmtDays(row.ageDays)}
        </Td>
        {has("bodyBytes") && (
          <Td right dim>
            {fmtBytes(row.bodyBytes)}
          </Td>
        )}
        <Td>
          <DecayBarRow freshness={row.freshness} />
        </Td>
        {has("health") && (
          <Td>
            <Meter value={row.health} label={`health ${Math.round(row.health * 100)} out of 100`} />
          </Td>
        )}
        <Td right className="font-mono">
          {row.seed}
        </Td>
        {has("peer") && (
          <Td right dim className="font-mono">
            {row.peer}
          </Td>
        )}
        {has("ratePerHour") && (
          <Td right dim className="font-mono">
            {row.ratePerHour}
          </Td>
        )}
        <Td right className="font-mono">
          <span key={row.priceNow} className={moved ? "tick px-1" : "px-1"}>
            {fmtUsd(row.priceNow)}
          </span>
        </Td>
      </tr>
      {isOpen && (
        <tr id={detailId} className="bg-field">
          <td colSpan={columns.length} className="px-2 py-2 sm:px-3 sm:py-3">
            {artifact ? (
              <ArtifactDetail
                artifact={artifact}
                state={state}
                wellKnown={wellKnown}
                nowMs={nowMs}
                payouts={payoutsFor}
                batches={batches}
              />
            ) : (
              <p className="px-3 py-6 text-base text-ink-soft">
                This artifact left the registry between the click and the read.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
