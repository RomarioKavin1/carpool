/**
 * The regenerable event list.
 *
 * These are *numbers and facts* reproduced from this repo's own
 * `docs/PHASE0.md` and `docs/evidence/phase0-rater-data.md` (the
 * kill test's working notes) — event names, dates, outlets, per-artifact lag
 * (days after the event) and approximate word count, plus the public URL
 * each row cites. It is "regenerable" in the sense that anyone could redo
 * Phase 0's own method (web search + fetch) and rebuild an equivalent table;
 * nothing here is copied prose. **No article text is committed** — a
 * corpus of other people's writing is exactly what the brief forbids
 * committing, and it is also not needed: `bench/run.ts` builds a short,
 * synthetic, per-event description from `topic` below (a handful of factual
 * keywords already present in PHASE0.md's own event table) plus the
 * artifact's outlet and type, and treats word count purely as a *depth*
 * proxy — the same role it plays in Phase 0's own analysis ("both artifacts
 * state the same core facts, one is 3-10x longer").
 */

export interface BenchArtifact {
  id: string;
  outlet: string;
  /** Days after the event this artifact was published. */
  lagDays: number;
  type: string;
  /** Phase 0's fetch-model word-count estimate. */
  wordCount: number;
  url: string;
}

export interface BenchEvent {
  id: string;
  name: string;
  /** ISO date the event happened. */
  date: string;
  /** A handful of factual keywords from PHASE0.md's own event table — not any one artifact's prose. */
  topic: string;
  /** A buyer's question about this event, phrased independently of `topic`. */
  query: string;
  artifacts: BenchArtifact[];
}

export const EVENTS: BenchEvent[] = [
  {
    id: "E1",
    name: "Tempo mainnet + Machine Payments Protocol",
    date: "2026-03-18",
    topic: "Tempo mainnet launch, Machine Payments Protocol, Stripe, Paradigm, blockchain for AI agent payments",
    query: "What happened when Tempo went live with the Machine Payments Protocol?",
    artifacts: [
      { id: "T1", outlet: "CoinDesk", lagDays: 0, type: "brief", wordCount: 650, url: "https://www.coindesk.com/tech/2026/03/18/stripe-led-payments-blockchain-tempo-goes-live-with-protocol-for-ai-agents" },
      { id: "T2", outlet: "The Block", lagDays: 0, type: "brief", wordCount: 650, url: "https://www.theblock.co/post/394131/tempo-mainnet-goes-live-with-machine-payments-protocol-for-agents" },
      { id: "T3", outlet: "Ledger Insights", lagDays: 2, type: "brief+analysis", wordCount: 280, url: "https://www.ledgerinsights.com/stripe-paradigm-launch-tempo-blockchain-alongside-machine-payments-standard/" },
      { id: "T4", outlet: "The Defiant", lagDays: 0, type: "brief", wordCount: 450, url: "https://thedefiant.io/news/blockchains/tempo-launches-mainnet-unveils-machine-payments-protocol-with-stripe" },
      { id: "T5", outlet: "Bankless news", lagDays: 0, type: "brief", wordCount: 320, url: "https://www.bankless.com/read/news/stripe-deploys-tempo-blockchain-to-mainnet-introduces-machine-payments-protocol" },
      { id: "T6", outlet: "crypto.news", lagDays: 0, type: "brief w/ context", wordCount: 1100, url: "https://crypto.news/stripe-and-paradigms-tempo-mainnet-goes-live-for-machine-payments/" },
      { id: "T7", outlet: "MEXC Blog", lagDays: 1, type: "deep-dive", wordCount: 3800, url: "https://blog.mexc.com/news/tempo-mainnet-launch-machine-payments-protocol-unlocks-ai-powered-crypto-transactions-and-autonomous-commerce-in-2026/" },
      { id: "T8", outlet: "Our Crypto Talk", lagDays: 1, type: "deep-dive", wordCount: 2400, url: "https://ourcryptotalk.com/news/tempo-mainnet-live-on-stripe-machine-payments-protocol" },
      { id: "T9", outlet: "Bankless analysis", lagDays: 6, type: "deep-dive (critical)", wordCount: 1800, url: "https://www.bankless.com/read/stripes-tempo-makes-its-case" },
      { id: "T10", outlet: "BlockBeats via KuCoin Flash", lagDays: 0, type: "brief", wordCount: 180, url: "https://www.kucoin.com/news/flash/tempo-launches-mainnet-and-machine-payment-protocol-mpp" },
    ],
  },
  {
    id: "E2",
    name: "Aave V4 on Ethereum mainnet",
    date: "2026-03-30",
    topic: "Aave V4 launch, Ethereum mainnet, hub-and-spoke architecture, DeFi lending, real-world credit markets",
    query: "What changed with the Aave V4 launch on Ethereum mainnet?",
    artifacts: [
      { id: "A1", outlet: "CoinDesk", lagDays: 0, type: "brief", wordCount: 520, url: "https://www.coindesk.com/tech/2026/03/30/aave-rolls-out-v4-on-ethereum-aiming-to-expand-defi-into-real-world-credit-markets" },
      { id: "A2", outlet: "The Block", lagDays: 0, type: "deep-dive (interview)", wordCount: 1850, url: "https://www.theblock.co/post/395617/aave-v4-launches-ethereum-mainnet" },
      { id: "A3", outlet: "The Defiant", lagDays: 0, type: "brief", wordCount: 520, url: "https://thedefiant.io/news/defi/aave-v4-launches-on-ethereum-mainnet" },
      { id: "A4", outlet: "DL News", lagDays: 0, type: "brief", wordCount: 850, url: "https://www.dlnews.com/articles/defi/aave-launches-v4-on-ethereum/" },
      { id: "A5", outlet: "CoinCentral", lagDays: 0, type: "brief/explainer", wordCount: 490, url: "https://coincentral.com/aave-v4-launches-on-ethereum-with-new-hub-and-spoke-model/" },
      { id: "A6", outlet: "Bitcoin.com News", lagDays: 0, type: "explainer", wordCount: 650, url: "https://news.bitcoin.com/aave-v4-launch-explained-hub-and-spoke-model-new-partners-and-what-changes-for-borrowers/" },
      { id: "A7", outlet: "crypto.news via Bitget", lagDays: 2, type: "brief", wordCount: 850, url: "https://www.bitget.com/news/detail/12560605327202" },
      { id: "A8", outlet: "COINTURK", lagDays: 7, type: "explainer", wordCount: 850, url: "https://en.coin-turk.com/aave-v4-introduces-hub-and-spoke-architecture-for-flexible-defi-liquidity-management/" },
      { id: "A9", outlet: "Fibo Crypto", lagDays: 1, type: "explainer/deep-dive", wordCount: 2100, url: "https://fibo-crypto.fr/en/blog/aave-v4-mainnet-ethereum-hub-spoke-defi-2026/" },
      { id: "A10", outlet: "Coinpedia", lagDays: 0, type: "news", wordCount: 700, url: "https://coinpedia.org/news/aave-v4-goes-live-on-ethereum-mainnet-with-new-lending-architecture/" },
    ],
  },
  {
    id: "E3",
    name: "OpenAI GPT-5.5 release",
    date: "2026-04-23",
    topic: "GPT-5.5 release, OpenAI, thinking/pro modes, 1M context, benchmarks, pricing",
    query: "What are the key facts about the GPT-5.5 model release?",
    artifacts: [
      { id: "G1", outlet: "Appwrite", lagDays: 1, type: "deep-dive", wordCount: 1800, url: "https://appwrite.io/blog/post/gpt-5-5-launch" },
      { id: "G2", outlet: "BuildFastWithAI", lagDays: 1, type: "deep-dive", wordCount: 3800, url: "https://www.buildfastwithai.com/blogs/gpt-5-5-review-2026" },
      { id: "G3", outlet: "MPG ONE", lagDays: 0, type: "explainer", wordCount: 2100, url: "https://mpgone.com/gpt-5-5-openai/" },
      { id: "G4", outlet: "Digital Applied", lagDays: 0, type: "deep-dive", wordCount: 4200, url: "https://www.digitalapplied.com/blog/gpt-5-5-complete-guide-thinking-pro-1m-context" },
      { id: "G5", outlet: "JQ AI Systems", lagDays: 2, type: "deep-dive", wordCount: 2400, url: "https://www.ai.joaoqueiros.com/blog/gpt-5-5-review-benchmarks-pricing" },
      { id: "G6", outlet: "Nipralo", lagDays: 4, type: "deep-dive", wordCount: 3200, url: "https://www.nipralo.com/blogs/gpt-5-5-review-2026" },
      { id: "G7", outlet: "Simon Willison newsletter", lagDays: 1, type: "blog digest", wordCount: 350, url: "https://github.com/simonw/monthly-newsletter-archive/blob/main/2026-04-april.md" },
    ],
  },
  {
    id: "E4",
    name: "KelpDAO rsETH bridge exploit",
    date: "2026-04-18",
    topic: "KelpDAO rsETH bridge exploit, LayerZero DVN compromise, $292M loss, DeFi security post-mortem",
    query: "How did the KelpDAO rsETH bridge exploit happen?",
    artifacts: [
      { id: "K1", outlet: "Hypernative", lagDays: 2, type: "deep-dive", wordCount: 3200, url: "https://www.hypernative.io/insights/blog/the-kelpdao-observation-layer-exploit-291m-released-on-a-message-that-never-existed" },
      { id: "K2", outlet: "OpenZeppelin", lagDays: 5, type: "deep-dive", wordCount: 2800, url: "https://www.openzeppelin.com/news/lessons-from-kelpdao-hack" },
      { id: "K3", outlet: "CoinDesk", lagDays: 1, type: "deep-dive news", wordCount: 1100, url: "https://www.coindesk.com/business/2026/04/19/the-usd292-million-kelp-exploit-how-it-happened-and-what-it-means-for-defi" },
      { id: "K4", outlet: "DeFiprime", lagDays: 0, type: "deep-dive", wordCount: 4200, url: "https://defiprime.com/kelpdao-rseth-exploit" },
      { id: "K5", outlet: "Chainalysis", lagDays: 5, type: "deep-dive", wordCount: 2400, url: "https://www.chainalysis.com/blog/kelpdao-bridge-exploit-april-2026/" },
      { id: "K6", outlet: "Blockaid", lagDays: 1, type: "deep-dive", wordCount: 3200, url: "https://blockaid.io/blog/how-a-single-layerzero-dvn-compromise-drained-292m-from-kelpdao" },
      { id: "K7", outlet: "Safeheron", lagDays: 2, type: "deep-dive (treasury angle)", wordCount: 3100, url: "https://safeheron.com/blog/kelp-exploit-post-mortem/" },
      { id: "K8", outlet: "QuillAudits", lagDays: 2, type: "deep-dive", wordCount: 2400, url: "https://www.quillaudits.com/blog/hack-analysis/kelp-dao-hack" },
      { id: "K9", outlet: "Tomas Substack", lagDays: 6, type: "opinion/deep-dive", wordCount: 3600, url: "https://silhuzz.substack.com/p/defis-cypherpunk-larp" },
      { id: "K10", outlet: "Cryptocurrency Help", lagDays: 2, type: "explainer", wordCount: 1100, url: "https://cryptocurrencyhelp.com/news/kelp-dao-hack-292m-stolen/" },
      { id: "K11", outlet: "AMBCrypto", lagDays: 1, type: "brief", wordCount: 509, url: "https://ambcrypto.com/biggest-defi-hack-of-2026-294mln-kelpdao-exploit-hits-20-chains/" },
      { id: "K12", outlet: "CoinDesk", lagDays: 4, type: "explainer (bridges)", wordCount: 1100, url: "https://www.coindesk.com/tech/2026/04/21/the-usd292-million-kelp-dao-exploit-shows-why-crypto-bridges-are-still-one-of-the-industry-s-weakest-links" },
      { id: "K13", outlet: "KuCoin Blog", lagDays: 10, type: "deep-dive", wordCount: 2800, url: "https://www.kucoin.com/blog/kelpdao-hack-2026-rseth-exploit-analysis" },
      { id: "K14", outlet: "Zengineer via TechFlow", lagDays: 2, type: "deep-dive (AI-audit angle)", wordCount: 3200, url: "https://www.techflowpost.com/en-US/article/31202" },
    ],
  },
  {
    id: "E5",
    name: "TypeScript 7.0 stable",
    date: "2026-07-08",
    topic: "TypeScript 7.0 stable release, native Go compiler, 10x faster builds, migration guide",
    query: "What's new and what breaks in the TypeScript 7.0 native compiler release?",
    artifacts: [
      { id: "S1", outlet: "InfoWorld", lagDays: 5, type: "brief", wordCount: 320, url: "https://www.infoworld.com/article/4196378/go-based-typescript-7-0-arrives.html" },
      { id: "S2", outlet: "Digital Applied", lagDays: 8, type: "deep-dive (readiness)", wordCount: 3200, url: "https://www.digitalapplied.com/blog/typescript-7-native-compiler-early-adopter-migration-readiness" },
      { id: "S3", outlet: "Developers Digest", lagDays: 4, type: "how-to/deep-dive", wordCount: 2100, url: "https://www.developersdigest.tech/blog/typescript-7-native-compiler-migration-guide" },
      { id: "S4", outlet: "TypeScript Book (gibbok)", lagDays: 0, type: "announcement summary", wordCount: 200, url: "https://gibbok.github.io/typescript-book/typescript-news/2026/typescript-7-released/" },
      { id: "S5", outlet: "GitHub gist (nafiskabbo)", lagDays: 0, type: "how-to", wordCount: 2100, url: "https://gist.github.com/nafiskabbo/01ccb4970515413076f3759486c39755" },
      { id: "S6", outlet: "Coding Dunia", lagDays: 3, type: "how-to/deep-dive", wordCount: 3800, url: "https://codingdunia.com/blog/typescript-7-migration-guide/" },
      { id: "S7", outlet: "sudosecurity", lagDays: 2, type: "analysis", wordCount: 650, url: "https://sudosecurity.org/typescript-7-0-official-release/" },
      { id: "S8", outlet: "Origami", lagDays: 1, type: "blog", wordCount: 1100, url: "https://origami.sa/en/blog/typescript-7-go-native-compiler-10x-faster/" },
    ],
  },
  {
    id: "E6",
    name: "EU Digital Omnibus on AI — provisional trilogue agreement",
    date: "2026-05-07",
    topic: "EU Digital Omnibus, AI Act high-risk deadline, trilogue agreement, GDPR simplification",
    query: "What did the EU's Digital Omnibus trilogue agreement change for the AI Act?",
    artifacts: [
      { id: "R1", outlet: "NicFab", lagDays: 0, type: "deep-dive", wordCount: 2800, url: "https://www.nicfab.eu/en/posts/digital-omnibus-ai-deal/" },
      { id: "R2", outlet: "Dastra", lagDays: 0, type: "explainer", wordCount: 2100, url: "https://www.dastra.eu/en/blog/simpler-safer-stricter-where-it-counts-inside-the-eu-ai-omnibus-deal/60025" },
      { id: "R3", outlet: "Timelex", lagDays: 0, type: "deep-dive", wordCount: 1400, url: "https://www.timelex.eu/en/blog/ai-omnibus-deal-what-survived-trilogue" },
      { id: "R4", outlet: "White & Case via JDSupra", lagDays: 8, type: "legal analysis", wordCount: 1100, url: "https://www.jdsupra.com/legalnews/eu-agrees-digital-omnibus-deal-to-4275721/" },
      { id: "R5", outlet: "Praxikon", lagDays: 8, type: "analysis", wordCount: 2100, url: "https://www.praxikon.com/en/posts/digital-omnibus-ai-act-may-2026-status-political-agreement" },
    ],
  },
  {
    id: "E7",
    name: "ETHGlobal New York 2026 prize list",
    date: "2026-06-06",
    topic: "ETHGlobal New York 2026, $225K+ prize pool, 17 sponsor tracks, hackathon",
    query: "What are the prize tracks for ETHGlobal New York 2026?",
    artifacts: [
      { id: "H1", outlet: "Crypto Briefing", lagDays: 0, type: "news", wordCount: 550, url: "https://cryptobriefing.com/ethglobal-nyc-hackathon-june-2026/" },
      { id: "H2", outlet: "Value The Markets", lagDays: 0, type: "news", wordCount: 550, url: "https://www.valuethemarkets.com/cryptocurrency/news/ethglobal-hackathon-2026-set-to-energize-new-york-developers" },
    ],
  },
  {
    id: "E8",
    name: "MegaETH Terminal Season 1 (airdrop criteria)",
    date: "2026-04-28",
    topic: "MegaETH Terminal Season 1, points platform, 2.5% MEGA allocation, KYC, airdrop farming rules",
    query: "What are the eligibility rules for the MegaETH Terminal Season 1 airdrop?",
    artifacts: [
      { id: "M1", outlet: "PlayToEarn", lagDays: 0, type: "news", wordCount: 2200, url: "https://playtoearn.com/news/megaeth-launches-terminal-points-platform-as-season-1-kicks-off-ahead-of-april-30-mega-tge" },
      { id: "M2", outlet: "OpenSea Digest", lagDays: 3, type: "newsletter section", wordCount: 280, url: "https://opensea.io/blog/articles/opensea-digest-april-30-2026" },
      { id: "M3", outlet: "BlockchainReporter", lagDays: 8, type: "guide", wordCount: 2200, url: "https://www.bitget.com/news/detail/12560605398834" },
      { id: "M4", outlet: "airdrops.io", lagDays: 10, type: "guide", wordCount: 3400, url: "https://airdrops.io/blog/the-complete-megaeth-airdrop-farming-guide-2026/" },
    ],
  },
];
