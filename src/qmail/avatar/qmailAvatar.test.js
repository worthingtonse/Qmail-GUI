import { describe, expect, it } from "vitest";
import {
  getQmailAvatarAssetHref,
  getQmailAvatarModel,
  getQmailAvatarTierName,
  getQmailAvatarWordIndices,
} from "./qmailAvatar";

describe("getQmailAvatarWordIndices", () => {
  it("splits the serial number into adjective and noun bytes", () => {
    expect(getQmailAvatarWordIndices(0x1234)).toEqual({
      numberPrefix: 0,
      adjectiveIndex: 0x12,
      nounIndex: 0x34,
    });
  });

  it("accepts numeric strings", () => {
    expect(getQmailAvatarWordIndices("4660")).toEqual({
      numberPrefix: 0,
      adjectiveIndex: 0x12,
      nounIndex: 0x34,
    });
  });

  it("extracts the third byte as a numeric prefix for 3-byte serials", () => {
    // 0x01DFFF = 122879 -> prefix 1, adjective 0xDF, noun 0xFF (@1.silk.square.kilo)
    expect(getQmailAvatarWordIndices(0x01dfff)).toEqual({
      numberPrefix: 0x01,
      adjectiveIndex: 0xdf,
      nounIndex: 0xff,
    });
  });

  it("rejects empty or non-positive values", () => {
    expect(getQmailAvatarWordIndices(0)).toBeNull();
    expect(getQmailAvatarWordIndices(null)).toBeNull();
    expect(getQmailAvatarWordIndices("")).toBeNull();
  });
});

describe("getQmailAvatarTierName", () => {
  it("maps denomination codes to avatar tiers", () => {
    expect(getQmailAvatarTierName(0)).toBe("bit");
    expect(getQmailAvatarTierName(1)).toBe("byte");
    expect(getQmailAvatarTierName(2)).toBe("kilo");
    expect(getQmailAvatarTierName(3)).toBe("mega");
    expect(getQmailAvatarTierName(4)).toBe("giga");
  });

  it("rejects out-of-range denomination codes", () => {
    expect(getQmailAvatarTierName(-1)).toBeNull();
    expect(getQmailAvatarTierName(5)).toBeNull();
    expect(getQmailAvatarTierName("banana")).toBeNull();
  });
});

describe("getQmailAvatarModel", () => {
  it("returns a complete avatar model for valid sender data", () => {
    expect(getQmailAvatarModel({ serialNumber: 0x1337, denominationCode: 4 })).toEqual({
      numberPrefix: 0,
      adjectiveIndex: 0x13,
      nounIndex: 0x37,
      tierName: "giga",
    });
  });

  it("returns null when either serial number or denomination code is missing", () => {
    expect(getQmailAvatarModel({ serialNumber: null, denominationCode: 2 })).toBeNull();
    expect(getQmailAvatarModel({ serialNumber: 0x1337, denominationCode: null })).toBeNull();
  });
});

describe("getQmailAvatarAssetHref", () => {
  it("builds stable asset paths", () => {
    expect(getQmailAvatarAssetHref("adjectives", 7)).toContain("/qmail-avatars/adjectives/007.svg");
    expect(getQmailAvatarAssetHref("nouns", 42)).toContain("/qmail-avatars/nouns/042.svg");
    expect(getQmailAvatarAssetHref("frame", "mega")).toContain("/qmail-avatars/frames/mega.svg");
  });
});

