/**
 * The account lookup, and the wallet options that fill it.
 *
 * One field, one primary action. A wallet is a second way to fill the same
 * field, so it sits beside the button as a secondary control and opens its
 * options inline rather than in a modal (the WalletConnect QR modal is the
 * wallet's own, and opens only after the viewer picks that option).
 *
 * Every wallet option is read-only; lib/wallet.ts says exactly what each one
 * asks for. An option that cannot work on this deployment is not rendered as a
 * button that fails: it is named, in plain text, with the reason.
 */
"use client";

import { useEffect, useId, useState } from "react";
import { mirrorBaseFor, parseAccountInput, resolveEvmAddress } from "../lib/account";
import {
  WALLETCONNECT_PROJECT_ID,
  caipChainFor,
  connectInjected,
  connectWalletConnect,
  discoverExtensions,
  injectedProvider,
  type HederaExtension,
  type WalletResult,
} from "../lib/wallet";
import { Button, Caveat, Field } from "./primitives";

type Busy = null | "lookup" | "wallet";

export function AccountLookup({
  account,
  network,
  onAccount,
}: {
  account: string | null;
  /** The registry's network from `/.well-known/carpool`, e.g. `hedera:testnet`. Null until read. */
  network: string | null;
  onAccount: (account: string | null) => void;
}) {
  const fieldId = useId().replace(/:/g, "");
  const [draft, setDraft] = useState(account ?? "");
  const [error, setError] = useState<string | null>(null);
  /** Whether `error` is about what was typed. A wallet failure is not the field's fault. */
  const [fieldAtFault, setFieldAtFault] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [hasInjected, setHasInjected] = useState(false);
  const [extensions, setExtensions] = useState<HederaExtension[]>([]);

  // The field follows the account on screen: a pasted link, a picked author, a
  // connected wallet. Typing does not move the account until it is submitted.
  useEffect(() => {
    setDraft(account ?? "");
    setError(null);
  }, [account]);

  // Browser-only facts, read after mount so the server and client render the same markup.
  useEffect(() => {
    if (!walletOpen) return;
    setHasInjected(injectedProvider() !== null);
    if (!WALLETCONNECT_PROJECT_ID) return;
    return discoverExtensions((ext) =>
      setExtensions((prev) => (prev.some((e) => e.id === ext.id) ? prev : [...prev, ext])),
    );
  }, [walletOpen]);

  const mirror = mirrorBaseFor(network);
  const chain = caipChainFor(network);

  async function submit() {
    setStatus(null);
    setFieldAtFault(true);
    const parsed = parseAccountInput(draft);
    if (parsed.kind === "empty") {
      setError("Enter an account id, like 0.0.1234567.");
      return;
    }
    if (parsed.kind === "invalid") {
      setError(parsed.reason);
      return;
    }
    if (parsed.kind === "account") {
      setError(null);
      onAccount(parsed.id);
      return;
    }
    if (!mirror) {
      setError("An EVM address needs the registry's network, which has not loaded. Paste the 0.0 id.");
      return;
    }
    setBusy("lookup");
    const resolved = await resolveEvmAddress(parsed.address, mirror);
    setBusy(null);
    if (resolved.kind === "account") {
      setError(null);
      setDraft(resolved.id);
      setStatus(`${parsed.address} is ${resolved.id}.`);
      onAccount(resolved.id);
    } else if (resolved.kind === "not-found") {
      setError("No Hedera account was created from that EVM address. Paste its 0.0 id instead.");
    } else {
      setError(`Could not resolve that address: ${resolved.message}.`);
    }
  }

  async function run(connect: () => Promise<WalletResult>) {
    setFieldAtFault(false);
    setBusy("wallet");
    setError(null);
    setStatus("Waiting for the wallet.");
    let result: WalletResult;
    try {
      result = await connect();
    } catch (e) {
      // A chunk that failed to load, a relay that refused the project id.
      result = { kind: "error", message: (e as Error).message || "unknown error" };
    }
    setBusy(null);
    switch (result.kind) {
      case "account":
        setStatus(`Read ${result.id} from your ${result.via}. Nothing was signed.`);
        setWalletOpen(false);
        onAccount(result.id);
        break;
      case "evm-unresolved":
        setStatus(null);
        setDraft(result.address);
        setError(
          "Your wallet's address is not the alias of any Hedera account. Paste the account's 0.0 id instead.",
        );
        break;
      case "cancelled":
        setStatus("Connection cancelled. Nothing was shared.");
        break;
      case "error":
        setStatus(null);
        setError(`The wallet did not connect: ${result.message}.`);
        break;
    }
  }

  return (
    <div className="max-w-[76ch]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
        noValidate
      >
        <Field
          id={`account-${fieldId}`}
          label="Hedera account"
          value={draft}
          onChange={(v) => {
            setDraft(v);
            if (error) setError(null);
          }}
          placeholder="0.0.1234567"
          invalid={error !== null && fieldAtFault}
        />
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="primary" type="submit" disabled={busy !== null} loading={busy === "lookup"}>
            Look up
          </Button>
          <Button
            onClick={() => setWalletOpen((v) => !v)}
            aria-expanded={walletOpen}
            aria-controls={`wallets-${fieldId}`}
            disabled={busy === "wallet"}
            loading={busy === "wallet"}
          >
            Connect wallet
          </Button>
        </div>
      </form>

      <div aria-live="polite">
        {error && (
          <p className="mt-3 w-fit rounded-sm bg-debit-wash px-3 py-1.5 text-sm text-debit">{error}</p>
        )}
        {!error && status && <p className="mt-3 text-sm text-ink-soft">{status}</p>}
      </div>

      {walletOpen && (
        <div id={`wallets-${fieldId}`} className="mt-5 rounded-lg bg-plate px-5 py-5">
          <p className="text-sm font-medium text-ink">Fill the lookup from a wallet</p>
          <ul className="mt-3 space-y-3 text-sm" role="list">
            {WALLETCONNECT_PROJECT_ID && chain ? (
              <>
                {extensions.map((ext) => (
                  <li key={ext.id}>
                    <Button
                      variant="primary"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(() =>
                          connectWalletConnect({ projectId: WALLETCONNECT_PROJECT_ID!, chain, extensionId: ext.id }),
                        )
                      }
                    >
                      {ext.name}
                    </Button>
                  </li>
                ))}
                <li>
                  <Button
                    variant={extensions.length > 0 ? "secondary" : "primary"}
                    disabled={busy !== null}
                    onClick={() =>
                      void run(() => connectWalletConnect({ projectId: WALLETCONNECT_PROJECT_ID!, chain }))
                    }
                  >
                    HashPack, Kabila or Blade
                  </Button>
                  <span className="ml-3 text-ink-soft">over WalletConnect</span>
                </li>
              </>
            ) : (
              <li className="text-ink-soft">
                HashPack, Kabila and Blade connect over WalletConnect, which this deployment has not configured.
              </li>
            )}
            {hasInjected && mirror ? (
              <li>
                <Button disabled={busy !== null} onClick={() => void run(() => connectInjected(injectedProvider()!, mirror))}>
                  Browser EVM wallet
                </Button>
                <span className="ml-3 text-ink-soft">MetaMask and similar</span>
              </li>
            ) : (
              <li className="text-ink-soft">
                {hasInjected ? "The registry's network has not loaded yet." : "No EVM wallet was found in this browser."}
              </li>
            )}
          </ul>
          <Caveat summary="What connecting shares" className="mt-5">
            <p>Connecting reads one account id. It asks for no signature and no transaction.</p>
            <p>A WalletConnect session is closed as soon as the id is read. This page holds no key.</p>
            <p>
              An EVM wallet gives an address. The Hedera mirror node maps it to an account only if the
              account was created from that address.
            </p>
            <p>Accounts created from a key, like this registry&rsquo;s own authors, need their 0.0 id pasted.</p>
          </Caveat>
        </div>
      )}
    </div>
  );
}
