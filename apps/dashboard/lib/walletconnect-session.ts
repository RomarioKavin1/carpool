/**
 * The WalletConnect half of lib/wallet.ts, split out so it is its own chunk.
 *
 * Only ever reached through `connectWalletConnect`'s dynamic `import()`, which
 * runs on a click, in the browser. Nothing on either route imports this file
 * statically, so `@walletconnect/sign-client` and its modal never load for a
 * reader who does not ask to connect.
 *
 * Read-only, and the whole shape of that is here:
 * - the proposal asks for the `hedera` namespace on the registry's own chain and
 *   one method, `hedera_getNodeAddresses`, which signs nothing;
 * - no request is ever sent over the session;
 * - the session is disconnected as soon as its account id is read, so the page
 *   keeps nothing.
 */
import SignClient from "@walletconnect/sign-client";
import { WalletConnectModal } from "@walletconnect/modal";
import { hederaAccountsFromSession, type WalletResult } from "./wallet";

const READ_ONLY_METHODS = ["hedera_getNodeAddresses"];
const PAIR_TIMEOUT_MS = 5 * 60 * 1000;
/**
 * How long the relay gets to hand back a pairing link. Measured, not guessed:
 * with a project id the relay rejects, `sign.connect` never settles and the
 * client retries in a loop, so without this the button sat on "working" for ever.
 */
const RELAY_TIMEOUT_MS = 20 * 1000;

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

let clientPromise: Promise<InstanceType<typeof SignClient>> | null = null;

function client(projectId: string) {
  clientPromise ??= SignClient.init({
    projectId,
    metadata: {
      name: "Carpool",
      description: "Look up what a Hedera account published, sold and was paid.",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.ico`],
    },
  });
  return clientPromise;
}

export async function readAccountOverWalletConnect({
  projectId,
  chain,
  extensionId,
}: {
  projectId: string;
  chain: string;
  extensionId?: string;
}): Promise<WalletResult> {
  let sign: InstanceType<typeof SignClient>;
  let uri: string | undefined;
  let approval: Awaited<ReturnType<InstanceType<typeof SignClient>["connect"]>>["approval"];
  try {
    sign = await withTimeout(client(projectId), RELAY_TIMEOUT_MS, "the WalletConnect relay did not answer");
    ({ uri, approval } = await withTimeout(
      sign.connect({
        // `optionalNamespaces`: the current client folds `requiredNamespaces`
        // into it anyway and warns. Same proposal on the wire.
        optionalNamespaces: { hedera: { chains: [chain], methods: READ_ONLY_METHODS, events: [] } },
      }),
      RELAY_TIMEOUT_MS,
      "the WalletConnect relay did not answer; check the project id",
    ));
  } catch (e) {
    clientPromise = null;
    return { kind: "error", message: (e as Error).message || "WalletConnect did not start" };
  }
  if (!uri) return { kind: "error", message: "WalletConnect returned no pairing link" };

  const modal = extensionId ? null : new WalletConnectModal({ projectId, chains: [chain] });
  let unsubscribe: (() => void) | undefined;

  const closedByViewer = new Promise<WalletResult>((resolve) => {
    if (!modal) return;
    unsubscribe = modal.subscribeModal((s: { open: boolean }) => {
      if (!s.open) resolve({ kind: "cancelled" });
    });
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<WalletResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ kind: "error", message: "the wallet did not answer in five minutes" }),
      PAIR_TIMEOUT_MS,
    );
  });

  const approved = (async (): Promise<WalletResult> => {
    try {
      const session = await approval();
      const accounts = hederaAccountsFromSession(session.namespaces, chain);
      // Nothing is ever requested over this session. Drop it now.
      void sign
        .disconnect({ topic: session.topic, reason: { code: 6000, message: "read the account id only" } })
        .catch(() => undefined);
      if (accounts.length === 0) {
        return { kind: "error", message: `the wallet shared no account on ${chain}` };
      }
      return { kind: "account", id: accounts[0]!, via: "WalletConnect" };
    } catch (e) {
      return { kind: "error", message: (e as Error).message || "the wallet declined" };
    }
  })();

  if (extensionId) {
    window.postMessage({ type: `hedera-extension-connect-${extensionId}`, pairingString: uri }, "*");
  } else {
    await modal!.openModal({ uri });
  }

  try {
    return await Promise.race([approved, closedByViewer, timedOut]);
  } finally {
    clearTimeout(timer);
    unsubscribe?.();
    modal?.closeModal();
  }
}
