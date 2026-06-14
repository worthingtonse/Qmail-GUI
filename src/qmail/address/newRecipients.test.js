import { describe, expect, it } from "vitest";
import { findUnknownRecipients, knownContactSerials } from "./newRecipients";

// Contacts as the contacts API shapes them: autoAddress carries the
// canonical address, userId carries the serial number.
const contact = (address, userId) => ({ autoAddress: address, userId });
const getAddress = (c) => c.autoAddress || "";

describe("knownContactSerials", () => {
  it("collects serials from contact addresses", () => {
    const set = knownContactSerials(
      [contact("51.254@bit", 13310), contact("1@giga", 1)],
      getAddress,
    );
    expect(set.has(0x0033fe)).toBe(true);
    expect(set.has(1)).toBe(true);
  });

  it("falls back to numeric userId when the address won't parse", () => {
    const set = knownContactSerials([contact("", 4242)], getAddress);
    expect(set.has(4242)).toBe(true);
  });

  it("ignores contacts with neither a parseable address nor a numeric id", () => {
    const set = knownContactSerials([contact("garbage", "abc")], getAddress);
    expect(set.size).toBe(0);
  });
});

describe("findUnknownRecipients", () => {
  it("returns recipients that aren't known contacts", () => {
    const result = findUnknownRecipients(
      ["51.254@bit"],
      [contact("99.1@kilo", 6488321)],
      getAddress,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      canonical: "51.254@bit",
      serialNumber: 0x0033fe,
      denominationCode: 0,
      denominationName: "bit",
    });
  });

  it("excludes recipients already saved as contacts (matched by serial)", () => {
    // Same serial, different input form — still recognized as known.
    const result = findUnknownRecipients(
      ["0.51.254.0"],
      [contact("51.254@bit", 13310)],
      getAddress,
    );
    expect(result).toHaveLength(0);
  });

  it("matches known contacts by numeric userId when address is absent", () => {
    const result = findUnknownRecipients(
      ["51.254@bit"],
      [contact("", 13310)],
      getAddress,
    );
    expect(result).toHaveLength(0);
  });

  it("de-duplicates the same recipient typed twice in different forms", () => {
    const result = findUnknownRecipients(
      ["51.254@bit", "0.51.254.0", "51.254.0"],
      [],
      getAddress,
    );
    expect(result).toHaveLength(1);
    expect(result[0].canonical).toBe("51.254@bit");
  });

  it("skips unparseable tokens defensively", () => {
    const result = findUnknownRecipients(
      ["garbage", "51.254@bit"],
      [],
      getAddress,
    );
    expect(result.map((r) => r.canonical)).toEqual(["51.254@bit"]);
  });

  it("handles empty inputs", () => {
    expect(findUnknownRecipients([], [], getAddress)).toEqual([]);
    expect(findUnknownRecipients(undefined, undefined, getAddress)).toEqual([]);
  });

  it("returns multiple distinct unknowns in order", () => {
    const result = findUnknownRecipients(
      ["1@bit", "2@byte", "3@kilo"],
      [],
      getAddress,
    );
    expect(result.map((r) => r.canonical)).toEqual(["1@bit", "2@byte", "3@kilo"]);
  });
});
