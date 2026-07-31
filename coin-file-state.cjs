const classifyCoinFileSizes = (sizes) => {
  let encryptedCount = 0;
  let decryptedCount = 0;
  let ignoredCount = 0;

  for (const value of Array.isArray(sizes) ? sizes : []) {
    const size = Number(value);
    if (!Number.isFinite(size) || size < 0) {
      ignoredCount += 1;
    } else if (size > 600) {
      encryptedCount += 1;
    } else if (size < 450) {
      decryptedCount += 1;
    } else {
      ignoredCount += 1;
    }
  }

  const state =
    encryptedCount > 0 && decryptedCount > 0
      ? 'mixed'
      : encryptedCount > 0
        ? 'encrypted'
        : 'decrypted';

  return { state, encryptedCount, decryptedCount, ignoredCount };
};

module.exports = { classifyCoinFileSizes };
