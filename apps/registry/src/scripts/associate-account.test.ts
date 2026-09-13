import { describe, expect, it } from "vitest";
import {
  InputError,
  checkAccountKeyType,
  parseAccountId,
  parsePrivateKey,
} from "./associate-account-lib.js";

const RAW = "ab".repeat(32);
const ECDSA_DER = "3030020100300706052b8104000a04220420" + RAW;
const ED25519_DER = "302e020100300506032b657004220420" + RAW;

describe("associate:account input validation", () => {
  it("accepts a 0.0.x account id and rejects anything else", () => {
    expect(parseAccountId(" 0.0.12345 ")).toBe("0.0.12345");
    expect(() => parseAccountId(undefined)).toThrow(/not set/);
    expect(() => parseAccountId("12345")).toThrow(InputError);
    expect(() => parseAccountId("0.0.abc")).toThrow(/0\.0\.12345/);
  });

  it("accepts a raw hex key with or without 0x", () => {
    expect(parsePrivateKey(RAW)).toEqual({ kind: "raw", rawHex: RAW });
    expect(parsePrivateKey("0x" + RAW.toUpperCase())).toEqual({ kind: "raw", rawHex: RAW });
  });

  it("unwraps a DER ECDSA key", () => {
    expect(parsePrivateKey(ECDSA_DER)).toEqual({ kind: "ecdsa", rawHex: RAW });
  });

  it("detects a DER ED25519 key and says to create an ECDSA account", () => {
    expect(() => parsePrivateKey(ED25519_DER)).toThrow(/ED25519.*ECDSA/);
  });

  it("rejects missing, non-hex and wrong-length keys without echoing them", () => {
    expect(() => parsePrivateKey("")).toThrow(/not set/);
    expect(() => parsePrivateKey("zz" + RAW.slice(2))).toThrow(/not hex/);
    try {
      parsePrivateKey("abcd1234");
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toMatch(/8 hex characters/);
      expect((e as Error).message).not.toContain("abcd1234");
    }
  });

  it("checks the account's key type as the mirror node reports it", () => {
    expect(() => checkAccountKeyType("ECDSA_SECP256K1")).not.toThrow();
    expect(() => checkAccountKeyType("ED25519")).toThrow(/ED25519.*ECDSA/);
    expect(() => checkAccountKeyType("ProtobufEncoded")).toThrow(/not a single ECDSA key/);
    expect(() => checkAccountKeyType(undefined)).toThrow(InputError);
  });
});
