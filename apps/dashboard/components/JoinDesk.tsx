/**
 * `/app#join`: how a stranger joins the network, which until now the product
 * never said anywhere.
 *
 * ## The gap this closes
 *
 * A reader asked, in these words: "how do I set this up, how can I sign up for
 * this both as a provider and consumer, there seems to be no clarity." They were
 * right, and it was a product gap and not a documentation gap. The app had four
 * desks that show what the registry is doing and a masthead that ended on "this
 * page holds no key", and nothing anywhere said where a key comes from or what to
 * do with one. `docs/RUNBOOK.md` served the third role, the operator, and the two
 * roles the product is actually about were unserved.
 *
 * ## The three decisions in this view
 *
 * 1. **The headline is the answer.** "There is no sign-up" is the single fact
 *    that removes most of the confusion, so it is the display line rather than a
 *    reassurance buried in a paragraph. There is no account to create, no email,
 *    no password: identity is a Hedera keypair.
 *
 * 2. **Author and buyer are drawn as one mechanism, not two products.** The
 *    opening panel is two rows over the same three parties, in opposite
 *    directions, because that is literally what they are: the artifact travels
 *    author → registry → buyer and the money travels buyer → registry → author.
 *    Anyone who reads those two rows has understood why the same keypair is
 *    usually at both ends, which is the thing two side-by-side "For authors" and
 *    "For buyers" panels would have actively obscured.
 *
 * 3. **Free search is the first value, so it is the first step.** `carpool_search`
 *    needs no account, no key and no funds, which is a real and badly under-sold
 *    fact: somebody can see what exists, what it cost to produce and what buying
 *    it would cost them before funding anything. Onboarding's job is to reach that
 *    moment fast, so the credential sections come after it rather than in front of
 *    it.
 *
 * ## Numbers
 *
 * `PRODUCT.md`'s rule holds here too. The refund window, the tracker fee, the
 * asset and the network are read from this registry's own
 * `/.well-known/carpool` and `/health` rather than typed into the copy, so a
 * registry configured differently does not get described wrongly by its own
 * dashboard. Where a value is a shipped default rather than something this
 * registry declared, the sentence says so.
 *
 * Nothing here is motion: no beat, no observer, no transition beyond the
 * standard 150ms colour changes on controls, so `prefers-reduced-motion` removes
 * nothing from this view because there was nothing to remove.
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { REGISTRY_URL, type RegistryHealth, type WellKnown } from "../lib/api";
import { fmtUsd } from "../lib/format";
import { Button, Caveat, CornerMark, CrossRule, Disclosure, Panel, Particles, Section, Term } from "./primitives";
import type { View } from "./Shell";

/** The default per-payment cap the MCP client ships with, µUSDC. Mirrors
    `capMicroUsdc()` in @carpool/core, quoted as a default and labelled as one. */
const DEFAULT_CAP_MICRO_USDC = 500_000;

export function JoinDesk({
  wellKnown,
  health,
  onView,
}: {
  wellKnown: WellKnown | null;
  health: RegistryHealth | null;
  onView: (v: View) => void;
}) {
  return (
    <Section
      eyebrow="Take part"
      title="There is no sign-up"
      deck={["There is no", "sign-up"]}
      node="19%"
      lede="No account, no email, no invite. Your identity is a Hedera keypair."
    >
      <Mechanism wellKnown={wellKnown} />
      <Install />
      <FreeFirst onView={onView} />
      <Directions wellKnown={wellKnown} />
      <KeyPath wellKnown={wellKnown} onView={onView} />
      <Traps />
      <Operator health={health} />
    </Section>
  );
}

/* ------------------------------------------------------------------ region 1 */

/**
 * The two directions of one mechanism, drawn in type rather than in SVG.
 *
 * A drawing was the first instinct and it was wrong at 360px: an arrow diagram
 * wide enough to hold three labels and two crossing flows either sets its type at
 * six effective pixels or needs a second mobile layout that says something
 * subtly different. Two rows of a sentence say the same thing, stay legible at
 * every width because they wrap like the sentences they are, and put the registry
 * in the middle of both, which is the whole content.
 */
function Mechanism({ wellKnown }: { wellKnown: WellKnown | null }) {
  const flows: { what: string; chain: [string, string, string]; tone: string }[] = [
    { what: "the artifact", chain: ["author", "registry", "buyer"], tone: "text-paper" },
    { what: "the money", chain: ["buyer", "registry", "author"], tone: "text-paper" },
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <Panel tone="dark" className="relative min-w-0 overflow-hidden px-5 py-6 sm:px-8 sm:py-7">
        <CornerMark kind="plus" className="absolute right-4 top-4 fill-ink-lift" />
        <p className="label text-2xs text-ink-lift">One mechanism, read from both ends</p>
        <dl className="mt-5">
          {flows.map((f) => (
            <div
              key={f.what}
              className="hairline-b-field flex flex-wrap items-baseline gap-x-6 gap-y-2 py-4 last:shadow-none"
            >
              <dt className="w-[9ch] shrink-0 text-sm text-ink-lift">{f.what}</dt>
              <dd className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-sm ${f.tone}`}>
                {f.chain.map((party, i) => (
                  <span key={party} className="flex items-center gap-2">
                    {i > 0 && <Flow />}
                    <span className={party === "registry" ? "text-ink-lift" : ""}>{party}</span>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-sm text-ink-lift">
          The registry sits in the middle of both rows because it is the payee, not a matchmaker.
        </p>
        <Caveat summary="Why the money waits" dark className="mt-4">
          <p>
            It holds the buyer&rsquo;s money for{" "}
            <span className="text-paper">
              {wellKnown ? `${wellKnown.refundWindowSeconds} seconds` : "a fixed window"}
            </span>{" "}
            so a refund can still reverse the sale.
          </p>
          <p>Paying the author is therefore a second transaction, not part of the first.</p>
        </Caveat>
      </Panel>

      <div className="min-w-0">
        <h3 className="text-2xl font-semibold text-ink">Provider and consumer are one account</h3>
        <p className="measure mt-4 text-base text-ink-soft">
          One keypair is the author in the first row and the buyer in the second.
        </p>
        <p className="measure mt-4 text-base text-ink-soft">
          So the setup below is one install, then two variables per direction.
        </p>
      </div>
    </div>
  );
}

/** A flow mark: the crosshair system's hairline, with a head on it. Never announced. */
function Flow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 22 8" className="h-2 w-[22px] shrink-0">
      <path d="M0 4h15" stroke="var(--ink-lift)" strokeWidth="1" />
      <path d="M15 1 21 4 15 7Z" fill="var(--ink-lift)" />
    </svg>
  );
}

/* ------------------------------------------------------------------ region 2 */

function Install() {
  return (
    <Sub
      node="63%"
      eyebrow="Step one, either direction"
      title="Install the MCP server"
      lede="Four tools: search, fetch, publish and delist."
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <Command label="run from npm" text={"npx -y carpool-mcp"} />
          <p className="mt-5 text-sm text-ink-soft">
            Node 20.19+. Nothing to clone or build; npx fetches it when your client starts.
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            Contributing? Clone the repo and build from source instead.
          </p>
        </div>

        <div className="min-w-0">
          <Command
            label="register it with Claude Code"
            text={
              `claude mcp add carpool \\\n` +
              `  -e CARPOOL_REGISTRY_URL=${REGISTRY_URL} \\\n` +
              `  -e CARPOOL_ARTIFACT_DIR=$HOME/carpool-artifacts \\\n` +
              `  -- npx -y carpool-mcp`
            }
          />
          <p className="measure mt-5 text-sm text-ink-soft">
            Keys added with <code className="font-mono text-ink">-e</code> sit in plaintext in
            Claude&apos;s config. Use testnet-only keys.
          </p>
          <Disclosure summary="The same thing as a JSON block, for a client configured by file">
            <Command
              label="mcpServers"
              text={JSON.stringify(
                {
                  mcpServers: {
                    carpool: {
                      type: "stdio",
                      command: "npx",
                      args: ["-y", "carpool-mcp"],
                      env: {
                        CARPOOL_REGISTRY_URL: REGISTRY_URL,
                        CARPOOL_ARTIFACT_DIR: "/abs/path/to/artifacts",
                      },
                    },
                  },
                },
                null,
                2,
              )}
            />
            <p className="measure mt-4 text-sm text-ink-soft">
              In Claude Code that object goes in <code className="font-mono text-ink [overflow-wrap:anywhere]">.mcp.json</code>{" "}
              at the root of a project, and a server declared there is held at{" "}
              <span className="text-ink">pending approval</span> until you approve it once in an
              interactive session. That is the design of project-scoped servers, not a failure. Other
              clients take the same object in their own configuration file.
            </p>
            <p className="measure mt-3 text-sm text-ink-soft">
              There is no <code className="font-mono text-ink [overflow-wrap:anywhere]">npx</code> form. The package is
              private and published to no registry, so nothing can fetch it by name. Its built entry
              point is executable, so the path on its own also works with no{" "}
              <code className="font-mono text-ink [overflow-wrap:anywhere]">node</code> in front of it.
            </p>
          </Disclosure>
        </div>
      </div>
    </Sub>
  );
}

/* ------------------------------------------------------------------ region 3 */

function FreeFirst({ onView }: { onView: (v: View) => void }) {
  return (
    <Sub
      node="28%"
      eyebrow="Step two"
      title="Search before you fund anything"
      lede="Searching costs nothing and needs no account."
    >
      <Panel tone="raised" className="relative overflow-hidden">
        <div className="graph-paper">
          <div className="max-w-[66ch] px-6 py-12 sm:px-9">
            <p className="text-base text-ink">
              <span className="font-mono">carpool_search</span> needs no key, no account and no
              funds.
            </p>
            <p className="mt-4 text-base text-ink-soft">
              You see the question, the abstract, the sources and the price. Only the body is behind
              the paywall.
            </p>
            <p className="mt-4 text-base text-ink-soft">
              This page uses the same free route, so you can try it before installing anything.
            </p>
            <Caveat summary="Why free" className="mt-5">
              <p>
                Manifests are free by design. The manifest is the buyer&rsquo;s evidence, and
                charging for evidence would defeat the point. It is not a trial and not a limited
                tier.
              </p>
            </Caveat>
            <div className="mt-7">
              <Button variant="primary" onClick={() => onView("find")}>
                Ask this registry a question
                <span aria-hidden="true">&rarr;</span>
              </Button>
            </div>
          </div>
        </div>
        <CornerMark kind="triangle" className="absolute bottom-3 left-3" />
      </Panel>
    </Sub>
  );
}

/* ------------------------------------------------------------------ region 4 */

function Directions({ wellKnown }: { wellKnown: WellKnown | null }) {
  const fee = wellKnown ? fmtUsd(wellKnown.prices.trackerFeeMicroUsdc, 4) : null;
  return (
    <Sub
      node="45%"
      eyebrow="Step three"
      title="Two variables for the direction you want"
      lede="One account id and one private key, in the server's env block."
    >
      {/*
        1.28/0.72, not two halves. Buying is the wide column on purpose: it is
        the lighter path, it is the one somebody reaching this screen is more
        likely to want today, and it carries four variables against publishing's
        two. The consent hook, which is neither column's variable but a thing you
        install on your own machine, is below both rather than wedged into the
        narrow one.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,1.28fr)_minmax(0,0.72fr)]">
        <div className="min-w-0">
          <p className="label text-2xs text-ink-faint">To buy</p>
          <h4 className="mt-3 text-xl font-medium text-ink">A funded account</h4>
          <Vars
            rows={[
              ["CARPOOL_BUYER_ACCOUNT_ID", "the account the payment comes from"],
              ["CARPOOL_BUYER_PRIVATE_KEY", "its ECDSA private key, used to sign the transfer"],
            ]}
          />
          <p className="measure mt-5 text-sm text-ink-soft">
            The account needs{" "}
            {wellKnown ? (
              <>
                test USDC (<span className="font-mono text-ink [overflow-wrap:anywhere]">{wellKnown.asset}</span> on{" "}
                <span className="font-mono text-ink [overflow-wrap:anywhere]">{wellKnown.network}</span>)
              </>
            ) : (
              "test USDC"
            )}
            , not HBAR.
          </p>
          <p className="measure mt-3 text-sm text-ink-soft">
            Without both,{" "}
            <span className="font-mono text-ink [overflow-wrap:anywhere]">carpool_fetch</span> refuses
            before it touches the network.
          </p>
          <Vars
            optional
            rows={[
              [
                "CARPOOL_ARTIFACT_DIR",
                "where a bought artifact is written",
                "The tool writes a file and returns a short receipt, so the document does not spend your context whether or not you need all of it.",
              ],
              [
                "CARPOOL_MAX_MICRO_USDC",
                `per-payment cap in µUSDC, default ${DEFAULT_CAP_MICRO_USDC.toLocaleString("en-US")} (${fmtUsd(DEFAULT_CAP_MICRO_USDC, 2)})`,
                "It rejects client-side, before a request is sent, so a cap under an artifact's price is not a warning: it is a buyer that can never buy.",
              ],
            ]}
          />
        </div>

        <div className="min-w-0">
          <p className="label text-2xs text-ink-faint">To publish</p>
          <h4 className="mt-3 text-xl font-medium text-ink">An account to be paid into</h4>
          <Vars
            rows={[
              ["CARPOOL_AUTHOR_ACCOUNT_ID", "the account royalties are paid to"],
              [
                "CARPOOL_AUTHOR_PRIVATE_KEY",
                "its ECDSA private key",
                "The public half becomes your author identity and the same key signs the manifest, so the two cannot disagree.",
              ],
            ]}
          />
          <p className="measure mt-5 text-sm text-ink-soft">
            Publishing needs no USDC. It needs to be able to{" "}
            <span className="text-ink">receive</span> it, which is the trap below.
          </p>
          {fee ? (
            <p className="measure mt-3 text-sm text-ink-soft">
              Every sale keeps a flat{" "}
              <span className="tnum font-mono text-ink [overflow-wrap:anywhere]">{fee}</span> fee.
              The rest is yours, uncapped.
            </p>
          ) : null}

        </div>
      </div>

      {/* The third thing publishing needs, and it is not a variable: it goes on
          your machine, not in the server's environment. Full width, under both
          columns, because it belongs to neither. */}
      <Panel tone="inset" className="mt-12 px-5 py-6 sm:px-8 sm:py-7">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <div className="min-w-0">
            <p className="label text-2xs text-ink-faint">Publishing only</p>
            <h4 className="mt-3 text-xl font-medium text-ink">And one consent hook</h4>
          </div>
          <div className="min-w-0">
            <p className="measure-wide text-base text-ink-soft">
              Publishing is the only irreversible thing here. No mode publishes without a human
              answering a prompt.
            </p>
            <p className="measure-wide mt-3 text-base text-ink-soft">
              The hook command is{" "}
              <span className="font-mono text-ink [overflow-wrap:anywhere]">npx -y carpool-mcp consent-hook</span>;
              its JSON is in the package README.
            </p>
            <Caveat summary="How that is enforced" className="mt-4">
              <p>
                An MCP server cannot tell whether it is running inside a subagent, so consent is
                enforced on your side by a{" "}
                <span className="font-mono text-ink [overflow-wrap:anywhere]">PreToolUse</span> hook
                on <span className="font-mono text-ink [overflow-wrap:anywhere]">carpool_publish</span>:
                a subagent is denied, a non-prompting permission mode is denied, everything else asks.
              </p>
              <p>
                It fails closed: if it cannot read its input or load its rules, it refuses.
              </p>
              <p>
                <Term
                  word="carpool_delist"
                  means="Withdraws an artifact from sale. It cannot recall a copy someone already paid for, cancel an open refund window, or cancel a royalty already earned."
                />{" "}
                stops new sales and nothing else. It cannot recall a copy somebody already bought.
              </p>
            </Caveat>
          </div>
        </div>
      </Panel>
    </Sub>
  );
}

/* ---------------------------------------------------------------- region 4b */

/**
 * The ordered path from nothing to paid: key, association, connection, payout.
 * Directions says which variables; this says where their values come from and
 * what has to happen to an account before it can receive a royalty. Every
 * command here is one that exists in the repo (`associate:account` is
 * `apps/registry/src/scripts/associate-account.ts`) and matches
 * `docs/GETTING-STARTED.md`'s "The short path".
 */
function KeyPath({ wellKnown, onView }: { wellKnown: WellKnown | null; onView: (v: View) => void }) {
  const fee = wellKnown ? fmtUsd(wellKnown.prices.trackerFeeMicroUsdc, 4) : "the tracker";
  const windowText = wellKnown ? `${wellKnown.refundWindowSeconds}-second` : "refund";
  const mono = "font-mono text-ink [overflow-wrap:anywhere]";
  const steps: { n: string; title: string; body: React.ReactNode }[] = [
    {
      n: "01",
      title: "Get a key",
      body: (
        <>
          <p className="measure-wide text-base text-ink-soft">
            Create a testnet account at{" "}
            <a
              href="https://portal.hedera.com"
              target="_blank"
              rel="noreferrer"
              className="text-wire underline decoration-plate-line underline-offset-4 hover:decoration-wire"
            >
              portal.hedera.com
            </a>{" "}
            with an <span className="text-ink">ECDSA</span> key, not ED25519.
          </p>
          <p className="measure-wide mt-3 text-base text-ink-soft">
            Copy the account id (<span className={mono}>0.0.x</span>) and the hex private key. It
            comes with test HBAR for fees.
          </p>
        </>
      ),
    },
    {
      n: "02",
      title: "Associate USDC",
      body: (
        <>
          <p className="measure-wide text-base text-ink-soft">
            Required to be paid, and before the faucet will send anything.
          </p>
          <Command
            label="associate any account"
            text={
              "HEDERA_ACCOUNT_ID=0.0.x HEDERA_PRIVATE_KEY=<hex key> \\\n" +
              "  npx carpool-mcp associate"
            }
          />
          <p className="measure-wide mt-4 text-sm text-ink-soft">
            Reads both from the environment, never prints the key, and exits cleanly if already
            associated.
          </p>
          <p className="measure-wide mt-2 text-sm text-ink-soft">
            Buying? Only now request test USDC from{" "}
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noreferrer"
              className="text-wire underline decoration-plate-line underline-offset-4 hover:decoration-wire"
            >
              faucet.circle.com
            </a>{" "}
            (Hedera Testnet).
          </p>
        </>
      ),
    },
    {
      n: "03",
      title: "Connect as author or buyer",
      body: (
        <>
          <p className="measure-wide text-base text-ink-soft">
            Add either pair, or both with the same key, to the{" "}
            <span className={mono}>claude mcp add</span> above, before{" "}
            <span className={mono}>--</span>.
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Command
              label="as author"
              text={"  -e CARPOOL_AUTHOR_ACCOUNT_ID=0.0.x \\\n  -e CARPOOL_AUTHOR_PRIVATE_KEY=<hex key> \\"}
            />
            <Command
              label="as buyer"
              text={"  -e CARPOOL_BUYER_ACCOUNT_ID=0.0.x \\\n  -e CARPOOL_BUYER_PRIVATE_KEY=<hex key> \\"}
            />
          </div>
          <p className="measure-wide mt-4 text-sm text-ink-soft">
            Keys passed with <span className={mono}>-e</span> sit in plaintext in your Claude
            config. Use a testnet-only key.
          </p>
          <p className="measure-wide mt-2 text-sm text-ink-soft">
            Authors: <span className={mono}>CARPOOL_AUTHOR_ENS_NAME</span> is optional, and the
            consent hook above is required.
          </p>
        </>
      ),
    },
    {
      n: "04",
      title: "Get paid",
      body: (
        <>
          <ol className="measure-wide text-base text-ink-soft">
            <li>1. Every publish asks you to confirm first.</li>
            <li className="mt-2">
              2. A buyer pays the registry&rsquo;s account, which holds it for the {windowText} window.
            </li>
            <li className="mt-2">3. The next settlement sends you the price minus the {fee} fee.</li>
            <li className="mt-2">
              4. The hosted registry settles hourly, so a royalty can take up to an hour.
            </li>
          </ol>
          <p className="measure-wide mt-4 text-sm text-ink-soft">
            Track it at <span className={mono}>/app#earnings?account=0.0.x</span>: held, claimable,
            settled, with a HashScan link.
          </p>
          <div className="mt-5">
            <Button variant="secondary" onClick={() => onView("earnings")}>
              Open Earnings
              <span aria-hidden="true">&rarr;</span>
            </Button>
          </div>
          <Caveat summary="Why it waits, and what if unassociated" className="mt-4">
            <p>
              Paying the registry rather than you is what makes a refund possible inside the window.
            </p>
            <p>
              An unassociated payout fails. After 5 attempts it is parked until the operator retries
              it once you associate.
            </p>
            <p>
              A local registry settles on its own <span className={mono}>EPOCH_SECONDS</span>, not
              necessarily hourly.
            </p>
          </Caveat>
        </>
      ),
    },
  ];
  return (
    <Sub
      node="54%"
      eyebrow="From key to paid"
      title="Get a key, associate, connect, get paid"
      lede="The same four steps for authors and buyers."
    >
      <ol>
        {steps.map((t) => (
          <li
            key={t.n}
            className="hairline-b grid grid-cols-[3ch_minmax(0,1fr)] gap-x-5 py-6 last:shadow-none sm:grid-cols-[5ch_minmax(0,1fr)] sm:gap-x-10"
          >
            <span className="tnum pt-1 font-mono text-sm text-ink-faint">{t.n}</span>
            <div className="min-w-0">
              <h4 className="mb-3 text-xl font-medium text-ink">{t.title}</h4>
              {t.body}
            </div>
          </li>
        ))}
      </ol>
    </Sub>
  );
}

/* ------------------------------------------------------------------ region 5 */

/**
 * The two mistakes that cost an afternoon each. Both are already written down in
 * `docs/RUNBOOK.md` and both were still being rediscovered, which is the argument
 * for putting them in the interface instead of only in an operator document.
 *
 * No colour carries the warning. `ember` is decay and nothing else in this
 * palette, and `debit` is money leaving, so a caution tint would either break the
 * one rule the design system is built on or claim the wrong thing. The numbers
 * and the word "silently" do the work.
 */
function Traps() {
  return (
    <Sub
      node="72%"
      eyebrow="Before the faucet"
      title="The two traps, in order"
      lede="Both apply to buyer and author accounts alike."
    >
      {/*
        A list, not two panels side by side. The first draft drew them as two
        equal boxes in a 50/50 grid, which broke two rules at once: this design
        system's splits are 1.25/0.75 or 1.3/0.7 and never symmetric, and two
        identical boxes carrying a number, a heading and a paragraph is the card
        grid the brief bans. It was also wrong about the content. "In order" is
        the whole of the second one's value (associating AFTER the faucet means
        the faucet has already silently declined), and order reads down a column,
        not across a row.
      */}
      <ol>
        {[
          {
            n: "01",
            title: "The key must be ECDSA",
            body: <>Create the testnet account as ECDSA, not ED25519.</>,
            why: (
              <>
                The Hedera x402 signer calls{" "}
                <span className="font-mono text-ink [overflow-wrap:anywhere]">PrivateKey.fromStringECDSA</span>. An
                ED25519 key fails at signing time with an error that reads like a fault in the
                facilitator, so you will debug the wrong component.
              </>
            ),
          },
          {
            n: "02",
            title: "Associate USDC, and do it before the faucet",
            body: (
              <>
                The faucet mints only to an already-associated account, and it declines{" "}
                <span className="text-ink">silently</span>.
              </>
            ),
            why: (
              <>
                <span className="font-mono text-ink [overflow-wrap:anywhere]">maxAutomaticTokenAssociations</span> does not
                satisfy it: auto-association creates the relationship lazily, on first receipt, and
                the faucet checks for an existing one before it sends. No transfer, no error, no
                explanation.
              </>
            ),
          },
        ].map((t) => (
          <li
            key={t.n}
            className="hairline-b grid grid-cols-[3ch_minmax(0,1fr)] gap-x-5 py-6 last:shadow-none sm:grid-cols-[5ch_minmax(0,1fr)] sm:gap-x-10"
          >
            <span className="tnum pt-1 font-mono text-sm text-ink-faint">{t.n}</span>
            <div className="min-w-0">
              <h4 className="text-xl font-medium text-ink">{t.title}</h4>
              <p className="measure-wide mt-3 text-base text-ink-soft">{t.body}</p>
              <Caveat summary="Why" className="mt-3">
                <p>{t.why}</p>
              </Caveat>
            </div>
          </li>
        ))}
      </ol>
      <Caveat summary="It catches authors too" className="mt-7">
        <p>
          A royalty is a transfer <span className="text-ink">into</span> your account, and an
          unassociated payee makes the settlement batch fail with{" "}
          <span className="font-mono text-ink [overflow-wrap:anywhere]">TOKEN_NOT_ASSOCIATED_TO_ACCOUNT</span>.
        </p>
        <p>The operator can recover the payout once you associate, so it is delay, not loss.</p>
      </Caveat>
    </Sub>
  );
}

/* ------------------------------------------------------------------ region 6 */

function Operator({ health }: { health: RegistryHealth | null }) {
  return (
    <Sub
      node="36%"
      eyebrow="The third role"
      title="Running a registry of your own"
      lede="Covered properly elsewhere, not here."
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="min-w-0">
          <p className="measure text-base text-ink-soft">
            You do not need one to start. Point the MCP server at somebody else&rsquo;s registry, or
            run an empty one locally.
          </p>
          <Caveat summary="The two operator documents" className="mt-4">
            <p>
              <span className="font-mono text-ink [overflow-wrap:anywhere]">docs/RUNBOOK.md</span>:
              deriving the service accounts, the anchor topic, preflight, delisting, restart and
              reconcile, the WAL checkpoint a backup will otherwise skip, and what has actually been
              run on a ledger. An operator has custody of other people&rsquo;s money while the
              service is stopped, and that document says so.
            </p>
            <p>
              <span className="font-mono text-ink [overflow-wrap:anywhere]">docs/GETTING-STARTED.md</span>:
              this page as a document, including what broke the first time it was followed.
            </p>
          </Caveat>
          <Command label="a local registry on the shipped port" text="pnpm --filter @carpool/registry dev" />
        </div>

        <Panel tone="quiet" className="min-w-0 px-5 py-5 sm:px-6">
          <p className="label text-2xs text-ink-faint">This registry, right now</p>
          <dl className="mt-4">
            <Row k="reading from" v={REGISTRY_URL} />
            <Row k="network" v={health?.network ?? "not answered"} />
            <Row k="usdc" v={health?.asset ?? "not answered"} />
            <Row
              k="settlement"
              v={health ? (health.creds ? "configured" : "off on this registry") : "not answered"}
            />
          </dl>
          <p className="mt-5 text-sm text-ink-soft">
            {health && !health.creds
              ? "No settlement key: publishing works, being paid does not."
              : "Testnet and test USDC throughout. Nothing here earns real money."}
          </p>
          {health && !health.creds && (
            <Caveat summary="What that means" className="mt-3">
              <p>
                Royalties still accrue in its payout table. Nothing is ever transferred to an author
                or anchored.
              </p>
            </Caveat>
          )}
        </Panel>
      </div>

      <div aria-hidden="true" className="pointer-events-none relative mt-16 h-20">
        <Particles count={20} className="opacity-60" />
      </div>
    </Sub>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="hairline-b flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 py-2.5 text-sm last:shadow-none">
      <dt className="shrink-0 text-ink-soft">{k}</dt>
      <dd className="min-w-0 break-words font-mono text-ink [overflow-wrap:anywhere]">{v}</dd>
    </div>
  );
}

/* ------------------------------------------------------------- local pieces */

/**
 * A subordinate region inside a desk. A crosshair with its node moved, a tight
 * uppercase label, and a heading at `2xl` sentence case.
 *
 * `Section`'s staggered display headline is deliberately not reused: DESIGN.md
 * rations it to one per view, and this view already spent it on the line that
 * answers the reader's question.
 */
function Sub({
  node,
  eyebrow,
  title,
  lede,
  children,
}: {
  node: string;
  eyebrow: string;
  title: string;
  /** One sentence, or none. Never a paragraph. */
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-20">
      <CrossRule at={node} />
      <div className="pt-9">
        <p className="label mb-4 text-2xs text-ink-faint">{eyebrow}</p>
        <h3 className="text-2xl font-semibold text-ink">{title}</h3>
        {lede && (
          <p data-lede="" className="measure mt-4 text-base text-ink-soft">
            {lede}
          </p>
        )}
      </div>
      <div className="mt-9">{children}</div>
    </section>
  );
}

/**
 * A command, on the one material that is unmistakably not prose, with a copy
 * control.
 *
 * ## Why this is more than one `await`
 *
 * The first version was `await navigator.clipboard.writeText(text)` in a
 * try/catch, which is the shape everybody writes and it has a third outcome
 * neither branch covers: the promise can simply never settle. `writeText`
 * requires the document to be focused, and where it is not, some builds neither
 * resolve nor reject. Driven in a real browser the button sat on "Copy" for ever
 * after a press, which is the exact failure a copy button must not have, because
 * the user's only evidence that anything happened is the label.
 *
 * So the wait is bounded, and a bounded wait needs somewhere to fall back to:
 *
 * 1. the async Clipboard API, raced against a 1200 ms deadline;
 * 2. failing that, a selection plus `document.execCommand("copy")`, which is
 *    deprecated and is still the thing that works when the async API is
 *    unavailable or blocked. It is not a reinvented affordance, it is the older
 *    spelling of the same one;
 * 3. failing that, an honest visible failure telling the reader to select the
 *    text, which is always possible: this is selectable text, never an image.
 *
 * The confirmation is announced through a live region rather than through the
 * colour of the button, the label is the same width in every state so nothing
 * moves under the pointer, and the reset timer is cleared on the next press so
 * two quick presses cannot leave it stuck.
 */
export function Command({ label, text }: { label: string; text: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<number | null>(null);

  const copy = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await Promise.race([
          navigator.clipboard.writeText(text),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error("timed out")), 1200)),
        ]);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // The older spelling. It needs a node in the document and a selection, and
      // it is synchronous, so it cannot hang the way the async API can.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      try {
        ta.select();
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    }
    setState(ok ? "done" : "failed");
    timer.current = window.setTimeout(() => setState("idle"), 2400);
  }, [text]);

  return (
    <Panel tone="dark" className="relative mt-6 min-w-0 overflow-hidden px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <p className="label min-w-0 text-2xs text-ink-lift">{label}</p>
        {/* `w-16` so "Copy", "Copied" and "Failed" occupy one width: a control
            that resizes while you are aiming at it is worse than one that waits. */}
        <Button variant="secondary" onClick={copy} className="w-16 shrink-0 px-0 py-1.5 text-2xs">
          {state === "done" ? "Copied" : state === "failed" ? "Failed" : "Copy"}
        </Button>
      </div>
      <pre className="mt-4 overflow-x-auto font-mono text-xs leading-[1.7] text-paper sm:text-sm">
        {text}
      </pre>
      {state === "failed" && (
        <p className="mt-3 text-sm text-ink-lift">
          The clipboard refused. Select the text above and copy it by hand.
        </p>
      )}
      <span role="status" className="sr-only">
        {state === "done"
          ? `${label} copied to the clipboard`
          : state === "failed"
            ? `${label} could not be copied; select the text and copy it by hand`
            : ""}
      </span>
    </Panel>
  );
}

/**
 * Environment variables with what each one does. A definition list, not a table:
 * two of these are one line and two are three, and a table would either clip the
 * long ones or set four rows at the height of the tallest.
 */
function Vars({
  rows,
  optional = false,
}: {
  /** `[name, what it is, and optionally the consequence that needs a sentence]`. */
  rows: ([string, string] | [string, string, string])[];
  optional?: boolean;
}) {
  return (
    <>
      {optional && <p className="label mt-9 text-2xs text-ink-faint">Optional, worth setting deliberately</p>}
      <dl className={optional ? "mt-3" : "mt-5"}>
        {rows.map(([name, means, more]) => (
          <div key={name} className="hairline-b py-3.5 last:shadow-none">
            <dt className="break-words font-mono text-sm text-ink [overflow-wrap:anywhere]">{name}</dt>
            <dd className="measure mt-1.5 text-sm text-ink-soft">{means}</dd>
            {more && (
              <dd className="mt-2">
                <Caveat summary="Why it matters">
                  <p>{more}</p>
                </Caveat>
              </dd>
            )}
          </div>
        ))}
      </dl>
    </>
  );
}
