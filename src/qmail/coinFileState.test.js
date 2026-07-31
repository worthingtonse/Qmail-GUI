import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { classifyCoinFileSizes } = require("../../coin-file-state.cjs");

describe("coin-file state classification", () => {
  it("treats no coin files as decrypted", () => {
    expect(classifyCoinFileSizes([])).toEqual({
      state: "decrypted",
      encryptedCount: 0,
      decryptedCount: 0,
      ignoredCount: 0,
    });
  });

  it("classifies current encrypted and decrypted size ranges", () => {
    expect(classifyCoinFileSizes([601, 900]).state).toBe("encrypted");
    expect(classifyCoinFileSizes([100, 449]).state).toBe("decrypted");
  });

  it("ignores the reserved 450 through 600 byte range", () => {
    expect(classifyCoinFileSizes([450, 525, 600])).toEqual({
      state: "decrypted",
      encryptedCount: 0,
      decryptedCount: 0,
      ignoredCount: 3,
    });
  });

  it("reports mixed when recognized encrypted and decrypted files coexist", () => {
    expect(classifyCoinFileSizes([200, 700, 500])).toEqual({
      state: "mixed",
      encryptedCount: 1,
      decryptedCount: 1,
      ignoredCount: 1,
    });
  });
});
