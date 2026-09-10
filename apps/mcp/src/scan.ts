/**
 * Pre-publish scan.
 *
 * This STRIPS rather than warns. A warning is something a tired person clicks
 * past at the end of a long research run; a question that cannot be answered
 * carelessly is worth more than one that can. Everything removed is reported
 * back so the author knows what left and what did not.
 *
 * Publishing is the only irreversible thing Carpool does — once an artifact is
 * out it is bought, cached and possibly re-served, and delisting cannot recall
 * a copy someone already paid for.
 */

export interface Finding {
  kind: "secret" | "private-path" | "internal-host" | "private-repo";
  /** What was removed, described without reproducing the secret itself. */
  what: string;
  where: "question" | "abstract" | "body" | "sources";
}

export interface ScanResult {
  clean: boolean;
  findings: Finding[];
  redacted: {
    question: string;
    abstract: string;
    body: string;
    sources: { url: string; fetchedAt: string }[];
  };
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(sk|pk)-[A-Za-z0-9_-]{16,}\b/g, "API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, "GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AWS access key id"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "Slack token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "private key block"],
  [/\b[0-9a-f]{64}\b/g, "64-hex string (possible private key)"],
  [/\b(postgres|postgresql|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s"']+/g, "connection string"],
  [/\b[A-Za-z0-9._%+-]+:[^\s@"']{6,}@[A-Za-z0-9.-]+\b/g, "inline credentials"],
];

/** Hostnames that are only meaningful inside somebody's network. */
const INTERNAL_HOST =
  /\b(?:[a-z0-9-]+\.)*(?:internal|intranet|corp|lan|local|localdomain|test|invalid)\b|\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b/gi;

/** Absolute paths under a user's home — the shape of a local checkout. */
const HOME_PATH = /(?:\/(?:Users|home)\/[A-Za-z0-9._-]+|[A-Z]:\\Users\\[A-Za-z0-9._-]+)[^\s"'`,)]*/g;

const REDACTED = "[redacted]";

function sweep(
  text: string,
  where: Finding["where"],
  findings: Finding[],
  extraTerms: string[],
): string {
  let out = text;

  for (const [re, label] of SECRET_PATTERNS) {
    out = out.replace(re, () => {
      findings.push({ kind: "secret", what: label, where });
      return REDACTED;
    });
  }
  out = out.replace(INTERNAL_HOST, (m) => {
    findings.push({ kind: "internal-host", what: m, where });
    return REDACTED;
  });
  out = out.replace(HOME_PATH, () => {
    findings.push({ kind: "private-path", what: "local filesystem path", where });
    return REDACTED;
  });

  // Caller-supplied terms: client names, private repo names, anything the
  // author has told us never to publish. Matched case-insensitively on word
  // boundaries so "Acme" catches "acme" but not "acmecorporation" accidentally.
  for (const term of extraTerms) {
    if (!term.trim()) continue;
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(re, () => {
      findings.push({ kind: "private-repo", what: term, where });
      return REDACTED;
    });
  }
  return out;
}

export function scanForPublish(input: {
  question: string;
  abstract: string;
  body: string;
  sources: { url: string; fetchedAt: string }[];
  /** Terms the author never wants published — client names, private repos. */
  neverPublish?: string[];
}): ScanResult {
  const findings: Finding[] = [];
  const terms = input.neverPublish ?? [];

  const question = sweep(input.question, "question", findings, terms);
  const abstract = sweep(input.abstract, "abstract", findings, terms);
  const body = sweep(input.body, "body", findings, terms);

  // A source URL pointing at an internal host is itself the leak; drop the
  // whole entry rather than redacting part of a URL into something unusable.
  const sources = input.sources.filter((s) => {
    INTERNAL_HOST.lastIndex = 0;
    if (INTERNAL_HOST.test(s.url)) {
      findings.push({ kind: "internal-host", what: s.url, where: "sources" });
      return false;
    }
    return true;
  });

  return { clean: findings.length === 0, findings, redacted: { question, abstract, body, sources } };
}
