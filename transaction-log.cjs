'use strict';

function parseCsvRow(line) {
  const fields = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ',') {
      fields.push(field.trim());
      field = '';
    } else {
      field += character;
    }
  }

  fields.push(field.trim());
  return fields;
}

function parseTransactionCsv(content, wallet, receiptFilenames = []) {
  const receiptNames = new Map(
    receiptFilenames.map((name) => [String(name).toLowerCase(), String(name)]),
  );
  const lines = String(content || '').split(/\r?\n/).slice(1);

  return lines.flatMap((line, index) => {
    if (!line.trim()) return [];
    const fields = parseCsvRow(line);
    if (fields.length < 8) return [];

    const [symbol, receiptId, datetime, type, deposit, withdraw, description, balance] = fields;
    const candidates = receiptId
      ? [receiptId, `${receiptId}.json`, `${receiptId}.txt`]
      : [];
    const receiptFilename = candidates
      .map((candidate) => receiptNames.get(candidate.toLowerCase()))
      .find(Boolean) || null;

    return [{
      id: `${wallet.path}:${receiptId || index}:${index}`,
      walletName: wallet.name,
      walletPath: wallet.path,
      symbol,
      datetime,
      type,
      deposit,
      withdraw,
      description,
      balance,
      receiptFilename,
    }];
  });
}

module.exports = { parseCsvRow, parseTransactionCsv };
