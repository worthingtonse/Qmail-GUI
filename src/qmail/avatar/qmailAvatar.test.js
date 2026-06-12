import { describe, expect, it } from "vitest";
import {
  getQmailAvatarAssetHref,
  getQmailAvatarModel,
  getQmailAvatarSymbolIndices,
  getQmailAvatarTierName,
} from "./qmailAvatar";

describe("getQmailAvatarSymbolIndices", () => {
  it("returns one symbol per significant serial byte (zeros dropped)", () => {
    // Mirrors the address forms: 51.254@bit / 1.0.254@giga / 254@byte
    expect(getQmailAvatarSymbolIndices(0x0033fe)).toEqual([51, 254]);
    expect(getQmailAvatarSymbolIndices(0x0100fe)).toEqual([1, 0, 254]);
    expect(getQmailAvatarSymbolIndices(0x0000fe)).toEqual([254]);
  });

  it("keeps inner zero bytes (only LEADING zeros are dropped)", () => {
    expect(getQmailAvatarSymbolIndices(0x010000)).toEqual([1, 0, 0]);
    expect(getQmailAvatarSymbolIndices(0x00ff00)).toEqual([255, 0]);
  });

  it("covers the full 3-byte range", () => {
    expect(getQmailAvatarSymbolIndices(0xffffff)).toEqual([255, 255, 255]);
    expect(getQmailAvatarSymbolIndices(1)).toEqual([1]);
  });

  it("accepts numeric strings (API responses often carry strings)", () => {
    expect(getQmailAvatarSymbolIndices("13310")).toEqual([51, 254]);
  });

  it("rejects serial 0 (reserved) and out-of-range values", () => {
    expect(getQmailAvatarSymbolIndices(0)).toBeNull();
    expect(getQmailAvatarSymbolIndices(0x1000000)).toBeNull();
    expect(getQmailAvatarSymbolIndices(-1)).toBeNull();
    expect(getQmailAvatarSymbolIndices(1.5)).toBeNull();
    expect(getQmailAvatarSymbolIndices(null)).toBeNull();
    expect(getQmailAvatarSymbolIndices(undefined)).toBeNull();
    expect(getQmailAvatarSymbolIndices("")).toBeNull();
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

  it("accepts numeric strings", () => {
    expect(getQmailAvatarTierName("2")).toBe("kilo");
  });

  it("rejects out-of-range denomination codes", () => {
    expect(getQmailAvatarTierName(-1)).toBeNull();
    expect(getQmailAvatarTierName(5)).toBeNull();
    expect(getQmailAvatarTierName(0xff)).toBeNull(); // fractional denominations
    expect(getQmailAvatarTierName("banana")).toBeNull();
    expect(getQmailAvatarTierName(null)).toBeNull();
    expect(getQmailAvatarTierName("")).toBeNull();
  });
});

describe("getQmailAvatarAssetHref", () => {
  it("builds frame hrefs from the tier name", () => {
    expect(getQmailAvatarAssetHref("frame", "mega")).toContain(
      "/qmail-avatars/frames/mega.svg",
    );
  });

  it("builds zero-padded symbol hrefs from NewAvatars", () => {
    expect(getQmailAvatarAssetHref("symbol", 7)).toContain(
      "/qmail-avatars/NewAvatars/007.svg",
    );
    expect(getQmailAvatarAssetHref("symbol", 254)).toContain(
      "/qmail-avatars/NewAvatars/254.svg",
    );
  });

  it("returns null for unknown layer kinds (old word layers are gone)", () => {
    expect(getQmailAvatarAssetHref("adjectives", 7)).toBeNull();
    expect(getQmailAvatarAssetHref("nouns", 42)).toBeNull();
  });
});

describe("getQmailAvatarModel", () => {
  it("combines tier name and symbol indices", () => {
    expect(
      getQmailAvatarModel({ serialNumber: 0x0033fe, denominationCode: 0 }),
    ).toEqual({
      tierName: "bit",
      symbolIndices: [51, 254],
    });
  });

  it("returns null when either part is invalid", () => {
    expect(getQmailAvatarModel({ serialNumber: 0, denominationCode: 0 })).toBeNull();
    expect(getQmailAvatarModel({ serialNumber: 0x1337, denominationCode: 9 })).toBeNull();
    expect(getQmailAvatarModel({ serialNumber: null, denominationCode: 2 })).toBeNull();
    expect(getQmailAvatarModel({ serialNumber: 0x1337, denominationCode: null })).toBeNull();
  });
});
