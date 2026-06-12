import { describe, expect, it } from "vitest";
import {
  QMAIL_ADDRESS_FORMS_HINT,
  QMAIL_DENOMINATION_NAMES,
  denominationCodeToName,
  denominationNameToCode,
  formatQmailAddress,
  isValidQmailAddress,
  parseQmailAddress,
} from "./qmailAddress";

// This suite mirrors rest_core's qmail_address_format_test.c — keep the
// two matrices in sync when the format changes.

describe("formatQmailAddress", () => {
  it("builds the canonical form with leading zero bytes dropped", () => {
    expect(formatQmailAddress(0x0033fe, 0)).toBe("51.254@bit");
    expect(formatQmailAddress(0x0100fe, 4)).toBe("1.0.254@giga");
    expect(formatQmailAddress(0x0000fe, 1)).toBe("254@byte");
    expect(formatQmailAddress(0x000001, 0)).toBe("1@bit");
    expect(formatQmailAddress(0xffffff, 4)).toBe("255.255.255@giga");
    expect(formatQmailAddress(0x010000, 2)).toBe("1.0.0@kilo");
  });

  it("accepts numeric strings (API responses often carry strings)", () => {
    expect(formatQmailAddress("13310", "0")).toBe("51.254@bit");
  });

  it("returns null for unusable input instead of throwing", () => {
    expect(formatQmailAddress(0, 0)).toBeNull(); // serial 0 reserved
    expect(formatQmailAddress(0x1000000, 0)).toBeNull(); // > 3 bytes
    expect(formatQmailAddress(0x0033fe, 5)).toBeNull(); // denomination out of range
    expect(formatQmailAddress(0x0033fe, -1)).toBeNull(); // fractional denominations rejected
    expect(formatQmailAddress(1.5, 0)).toBeNull(); // non-integer serial
    expect(formatQmailAddress(NaN, 0)).toBeNull();
    expect(formatQmailAddress(undefined, 0)).toBeNull();
  });
});

describe("parseQmailAddress", () => {
  const ok = (input) => {
    const result = parseQmailAddress(input);
    expect(result.ok, `expected "${input}" to parse, got: ${result.error}`).toBe(true);
    return result;
  };

  it("treats the three accepted forms as equivalent", () => {
    for (const input of ["0.51.254.0", "51.254.0", "51.254@bit"]) {
      const result = ok(input);
      expect(result.serialNumber).toBe(0x0033fe);
      expect(result.denominationCode).toBe(0);
      expect(result.denominationName).toBe("bit");
      expect(result.serialBytes).toEqual([0, 51, 254]);
      expect(result.canonical).toBe("51.254@bit");
    }
  });

  it("parses single-byte serials with all leading zeros dropped", () => {
    for (const input of ["254@byte", "254.1", "0.0.254.1"]) {
      const result = ok(input);
      expect(result.serialNumber).toBe(0xfe);
      expect(result.denominationCode).toBe(1);
      expect(result.canonical).toBe("254@byte");
    }
  });

  it("parses full 3-byte serials", () => {
    expect(ok("1.0.254@giga").serialNumber).toBe(0x0100fe);
    expect(ok("255.255.255.4")).toMatchObject({
      serialNumber: 0xffffff,
      denominationCode: 4,
      serialBytes: [255, 255, 255],
    });
  });

  it("accepts case-insensitive denomination words", () => {
    expect(ok("51.254@BIT").denominationCode).toBe(0);
    expect(ok("51.254@Kilo").denominationCode).toBe(2);
  });

  it("accepts leading zeros inside a group", () => {
    expect(ok("051.254@bit").serialNumber).toBe(0x0033fe);
  });

  it("trims surrounding whitespace", () => {
    expect(ok("  51.254@bit  ").canonical).toBe("51.254@bit");
  });

  // Rejections — error strings must match rest_core verbatim so the GUI
  // modal and server-side 400s read identically.
  const rejects = (input, errorStart) => {
    const result = parseQmailAddress(input);
    expect(result.ok, `expected "${input}" to be rejected`).toBe(false);
    expect(result.error).toMatch(new RegExp(`^${errorStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  };

  it("rejects empty and non-string input", () => {
    rejects("", "Address is empty");
    rejects("   ", "Address is empty");
    expect(parseQmailAddress(null).ok).toBe(false);
    expect(parseQmailAddress(undefined).ok).toBe(false);
    expect(parseQmailAddress(12345).ok).toBe(false);
  });

  it("rejects a leading '@' (including the old word format)", () => {
    rejects("@51.254@bit", "Address must not start with '@'");
    rejects("@torch.glen.kilo", "Address must not start with '@'");
  });

  it("rejects serial number 0 in every form", () => {
    rejects("0.0.0.0", "Serial number 0 is reserved");
    rejects("0@bit", "Serial number 0 is reserved");
    rejects("0.0.0@bit", "Serial number 0 is reserved");
  });

  it("rejects denomination codes outside 0-4 (fractional included)", () => {
    rejects("51.254.255", "Denomination code must be 0-4");
    rejects("51.254.5", "Denomination code must be 0-4");
  });

  it("rejects unknown denomination words", () => {
    rejects("51.254@deci", "Denomination after '@' must be bit, byte, kilo, mega or giga");
    rejects("51.254@", "Missing denomination after '@'");
  });

  it("rejects out-of-range and malformed groups", () => {
    rejects("256.1.1.0", "Each number in the address must be 0-255");
    rejects("1234.0", "Each number in the address must be 0-255");
    rejects("abc.def@bit", "Address numbers may only contain digits");
    rejects("51.254.bit", "Address numbers may only contain digits");
    rejects("51..254@bit", "Address has an empty number group");
    rejects(".51.254@bit", "Address has an empty number group");
    rejects("51.254.0.", "Address must not end with '.'");
  });

  it("rejects wrong group counts", () => {
    rejects("1.2.3.4.0", "Address has too many number groups");
    rejects("1.2.3.4@bit", "Address has too many number groups before '@'");
    rejects("51", "Address needs a serial number and a denomination");
  });

  it("rejects multiple '@' signs", () => {
    rejects("51.254@bit@bit", "Address has more than one '@'");
  });

  it("rejects overlong input", () => {
    rejects(`${"1.".repeat(200)}1@bit`, "Address is too long");
  });

  it("includes the forms hint in format errors", () => {
    const result = parseQmailAddress("51");
    expect(result.error).toContain(QMAIL_ADDRESS_FORMS_HINT);
  });
});

describe("round trip", () => {
  it("format -> parse returns identical values", () => {
    const serials = [0x000001, 0x0000ff, 0x000100, 0x0033fe, 0x00ffff, 0x010000, 0x123456, 0xffffff];
    for (const sn of serials) {
      for (let code = 0; code <= 4; code++) {
        const address = formatQmailAddress(sn, code);
        expect(address).not.toBeNull();
        const parsed = parseQmailAddress(address);
        expect(parsed.ok).toBe(true);
        expect(parsed.serialNumber).toBe(sn);
        expect(parsed.denominationCode).toBe(code);
        expect(parsed.canonical).toBe(address);
      }
    }
  });
});

describe("denomination helpers", () => {
  it("maps codes to names and back", () => {
    expect(QMAIL_DENOMINATION_NAMES).toEqual(["bit", "byte", "kilo", "mega", "giga"]);
    for (let code = 0; code <= 4; code++) {
      const name = denominationCodeToName(code);
      expect(denominationNameToCode(name)).toBe(code);
    }
  });

  it("returns null for unknown values", () => {
    expect(denominationCodeToName(5)).toBeNull();
    expect(denominationCodeToName(-1)).toBeNull();
    expect(denominationCodeToName(0xff)).toBeNull();
    expect(denominationNameToCode("deci")).toBeNull();
    expect(denominationNameToCode(null)).toBeNull();
  });

  it("is case-insensitive for names", () => {
    expect(denominationNameToCode("BIT")).toBe(0);
    expect(denominationNameToCode("Giga")).toBe(4);
  });
});

describe("isValidQmailAddress", () => {
  it("returns booleans for quick validation", () => {
    expect(isValidQmailAddress("51.254@bit")).toBe(true);
    expect(isValidQmailAddress("0.51.254.0")).toBe(true);
    expect(isValidQmailAddress("@torch.glen.kilo")).toBe(false);
    expect(isValidQmailAddress("garbage")).toBe(false);
    expect(isValidQmailAddress("")).toBe(false);
  });
});
