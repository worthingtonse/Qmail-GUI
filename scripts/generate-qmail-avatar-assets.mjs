import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasSemanticNounGlyph, renderSemanticNounGlyph } from "./qmail-avatar-curated-nouns.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const wordListDir = path.join(projectRoot, "src", "qmail", "avatar", "wordlists");
const sourceAssetDir = path.join(projectRoot, "src", "qmail", "avatar", "source");
const outputDir = path.join(projectRoot, "public", "qmail-avatars");
const adjectiveOutputDir = path.join(outputDir, "adjectives");
const nounOutputDir = path.join(outputDir, "nouns");
const frameOutputDir = path.join(outputDir, "frames");
const manifestPath = path.join(outputDir, "manifest.json");

const WORD_LISTS = [
  {
    kind: "adjective",
    fileName: "qmail_adjectives.txt",
    outputDir: adjectiveOutputDir,
    sourceDir: path.join(sourceAssetDir, "adjectives"),
    renderGlyph: renderAdjectiveGlyph,
  },
  {
    kind: "noun",
    fileName: "qmail_nouns.txt",
    outputDir: nounOutputDir,
    sourceDir: path.join(sourceAssetDir, "nouns"),
    renderGlyph: renderNounGlyph,
  },
];

const FRAME_TIERS = [
  { name: "bit", color: "#7f8ea3", accent: "#aab6c5", level: 0, description: "plain slate" },
  { name: "byte", color: "#f4c14b", accent: "#ffe08a", level: 1, description: "warm brass" },
  { name: "kilo", color: "#5fd1d8", accent: "#b9f3f5", level: 2, description: "turquoise" },
  { name: "mega", color: "#a884ff", accent: "#e1d5ff", level: 3, description: "royal violet" },
  { name: "giga", color: "#f2d58a", accent: "#fff4cf", level: 4, description: "white-gold" },
];

const FRAME_FILL = "#23364b";
const GLYPH_FILL = "#f4edd1";
const GLYPH_HIGHLIGHT = "#fff4bf";

await ensureDir(outputDir);
await ensureDir(adjectiveOutputDir);
await ensureDir(nounOutputDir);
await ensureDir(frameOutputDir);
await clearSvgFiles(adjectiveOutputDir);
await clearSvgFiles(nounOutputDir);
await clearSvgFiles(frameOutputDir);

const wordLists = {};
const manualOverrides = {};
for (const list of WORD_LISTS) {
  const filePath = path.join(wordListDir, list.fileName);
  const fileContents = await fs.readFile(filePath, "utf8");
  const words = fileContents
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (words.length !== 256) {
    throw new Error(`${list.fileName} must contain exactly 256 non-empty entries; found ${words.length}`);
  }

  wordLists[list.kind] = words;
  manualOverrides[list.kind] = [];

  for (const [index, word] of words.entries()) {
    const fileId = `${String(index).padStart(3, "0")}.svg`;
    const overrideSvg = await readIfExists(path.join(list.sourceDir, fileId));
    if (list.kind === "noun" && !overrideSvg && !hasSemanticNounGlyph(word)) {
      throw new Error(`Missing curated noun glyph for '${word}' at index ${index}`);
    }
    const svg = overrideSvg ?? list.renderGlyph(word, index);
    if (overrideSvg) {
      manualOverrides[list.kind].push({
        index,
        word,
        file: fileId,
      });
    }
    await fs.writeFile(path.join(list.outputDir, `${String(index).padStart(3, "0")}.svg`), svg, "utf8");
  }
}

for (const tier of FRAME_TIERS) {
  await fs.writeFile(
    path.join(frameOutputDir, `${tier.name}.svg`),
    renderFrameSvg(tier),
    "utf8",
  );
}

const sourceHash = createHash("sha256")
  .update(wordLists.adjective.join("\n"))
  .update("\n--\n")
  .update(wordLists.noun.join("\n"))
  .digest("hex");

const manifest = {
  generatedAt: new Date().toISOString(),
  sourceHash,
  wordLists,
  tiers: FRAME_TIERS,
  manualOverrides,
};

await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Generated QMail avatar assets in ${outputDir}`);

function ensureDir(targetDir) {
  return fs.mkdir(targetDir, { recursive: true });
}

async function clearSvgFiles(targetDir) {
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".svg"))
      .map((entry) => fs.unlink(path.join(targetDir, entry.name))),
  );
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function renderFrameSvg(tier) {
  const strokeWidth = 3 + tier.level * 0.3;
  const accent = tier.accent;
  const baseTop = 82 - tier.level * 0.4;
  const baseHeight = 8 + tier.level * 0.35;
  const crown = tier.level >= 4
    ? `<path d="M39 10 L50 3 L61 10" fill="${tier.color}" /><path d="M39 10 H61" stroke="${accent}" stroke-width="1.8" stroke-linecap="round" />`
    : "";
  const innerRing = tier.level >= 2
    ? `<rect x="28" y="14" width="44" height="66" rx="13" fill="none" stroke="${accent}" stroke-width="1.2" />`
    : "";
  const flourish = tier.level >= 3
    ? `
      <path d="M33 14 C39 11, 61 11, 67 14" fill="none" stroke="${accent}" stroke-width="1.6" stroke-linecap="round" />
      <path d="M33 78 C39 81, 61 81, 67 78" fill="none" stroke="${accent}" stroke-width="1.6" stroke-linecap="round" />
    `
    : "";
  const sideAccents = tier.level >= 4
    ? `
      <path d="M19 88 L10 93 L19 96" fill="${accent}" />
      <path d="M81 88 L90 93 L81 96" fill="${accent}" />
      <path d="M29 87 H71" stroke="${accent}" stroke-width="1.6" stroke-linecap="round" />
      <path d="M30 91 H70" stroke="${accent}" stroke-width="1.1" stroke-linecap="round" />
    `
    : tier.level === 3
      ? `
        <path d="M30 86 H70" stroke="${accent}" stroke-width="1.6" stroke-linecap="round" />
      `
      : tier.level === 2
        ? `
          <circle cx="22" cy="90" r="2.2" fill="${accent}" />
          <circle cx="78" cy="90" r="2.2" fill="${accent}" />
        `
        : "";

  return toSvg(`
    ${crown}
    <rect x="24" y="10" width="52" height="76" rx="16" fill="${FRAME_FILL}" stroke="${tier.color}" stroke-width="${strokeWidth}" />
    <rect x="22" y="78" width="56" height="8" fill="${FRAME_FILL}" />
    ${innerRing}
    ${flourish}
    <rect x="${18 - tier.level * 0.6}" y="${baseTop}" width="${64 + tier.level * 1.2}" height="${baseHeight}" rx="4" fill="${tier.color}" />
    ${tier.level >= 1 ? `<rect x="24" y="${80 - tier.level * 0.4}" width="52" height="${4 + tier.level * 0.3}" rx="3" fill="${accent}" />` : ""}
    ${sideAccents}
  `);
}

function renderAdjectiveGlyph(word, index) {
  const hash = wordHash(word, index, "adjective");
  const families = [
    renderTorchGlyph,
    renderLeafGlyph,
    renderWindGlyph,
    renderMountainGlyph,
    renderCrownGlyph,
    renderWaveGlyph,
    renderStarGlyph,
    renderSpiralGlyph,
    renderBeamGlyph,
    renderBoltGlyph,
  ];
  return toSvg(families[hash[0] % families.length](hash));
}

function renderNounGlyph(word, index) {
  const semanticGlyph = renderSemanticNounGlyph(word, index);
  if (semanticGlyph) {
    return semanticGlyph;
  }

  const hash = wordHash(word, index, "noun");
  const families = [
    renderPagodaGlyph,
    renderPalmsGlyph,
    renderRoadGlyph,
    renderMapGlyph,
    renderTowerGlyph,
    renderHarborGlyph,
    renderArchGlyph,
    renderDistrictGlyph,
    renderBridgeGlyph,
    renderDuneGlyph,
  ];
  return toSvg(families[hash[0] % families.length](hash));
}

function wordHash(word, index, kind) {
  return createHash("sha1")
    .update(`${kind}:${index}:${word}`)
    .digest();
}

function toSvg(body) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">`,
    body,
    `</svg>`,
    "",
  ].join("\n");
}

function rangeValue(hash, offset, min, max) {
  return min + (hash[offset] % (max - min + 1));
}

function renderTorchGlyph(hash) {
  const flameWidth = rangeValue(hash, 1, 10, 18);
  const handleWidth = rangeValue(hash, 2, 8, 12);
  return `
    <path d="M50 14 L${50 + flameWidth} 38 L${50 + Math.round(flameWidth / 2)} 64 L50 54 L${50 - Math.round(flameWidth / 2)} 64 L${50 - flameWidth} 38 Z" fill="${GLYPH_FILL}" />
    <path d="M50 27 L${50 + Math.round(flameWidth / 2.6)} 43 L50 56 L${50 - Math.round(flameWidth / 2.6)} 43 Z" fill="${GLYPH_HIGHLIGHT}" />
    <rect x="${50 - Math.round(handleWidth / 2)}" y="54" width="${handleWidth}" height="28" rx="5" fill="${GLYPH_FILL}" />
  `;
}

function renderLeafGlyph(hash) {
  const spread = rangeValue(hash, 1, 18, 28);
  const stemWidth = rangeValue(hash, 2, 5, 8);
  const leaves = Array.from({ length: 4 }, (_, index) => {
    const y = 72 - index * 14;
    const offset = Math.max(spread - index * 4, 12);
    return `
      <path d="M50 ${y} C${50 - offset} ${y - 8}, ${50 - offset} ${y - 18}, 50 ${y - 20}" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.5" stroke-linecap="round" />
      <path d="M50 ${y} C${50 + offset} ${y - 8}, ${50 + offset} ${y - 18}, 50 ${y - 20}" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.5" stroke-linecap="round" />
    `;
  }).join("");
  return `
    <rect x="${50 - Math.round(stemWidth / 2)}" y="18" width="${stemWidth}" height="62" rx="${Math.max(3, stemWidth / 2)}" fill="${GLYPH_FILL}" />
    ${leaves}
  `;
}

function renderWindGlyph(hash) {
  const lines = Array.from({ length: 3 }, (_, index) => {
    const startX = 20 + index * 6;
    const endX = 82 - index * 3;
    const y = 28 + index * 18;
    return `<path d="M${startX} ${y} C${startX + 20} ${y - 10}, ${endX - 20} ${y - 10}, ${endX} ${y}" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />`;
  }).join("");
  const tail = rangeValue(hash, 1, 40, 54);
  return `
    ${lines}
    <path d="M20 70 C36 64, ${tail} 64, 74 70" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
  `;
}

function renderMountainGlyph(hash) {
  const leftPeak = rangeValue(hash, 1, 34, 44);
  const rightPeak = rangeValue(hash, 2, 18, 28);
  return `
    <path d="M16 74 L${leftPeak} 34 L56 74 Z" fill="${GLYPH_FILL}" />
    <path d="M44 74 L${68 + rightPeak / 2} 24 L84 74 Z" fill="${GLYPH_FILL}" />
    <path d="M${leftPeak - 4} 40 L${leftPeak} 34 L${leftPeak + 5} 44" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />
  `;
}

function renderCrownGlyph(hash) {
  const baseY = rangeValue(hash, 1, 56, 62);
  return `
    <path d="M20 ${baseY} L34 28 L50 ${baseY - 12} L66 28 L80 ${baseY} L80 ${baseY + 12} L20 ${baseY + 12} Z" fill="${GLYPH_FILL}" />
    <path d="M32 ${baseY + 2} H68" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
  `;
}

function renderWaveGlyph(hash) {
  const arcHeight = rangeValue(hash, 1, 10, 18);
  return Array.from({ length: 4 }, (_, index) => {
    const y = 26 + index * 14;
    return `<path d="M18 ${y} C32 ${y - arcHeight}, 44 ${y - arcHeight}, 58 ${y} S84 ${y + arcHeight}, 86 ${y}" fill="none" stroke="${GLYPH_FILL}" stroke-width="5.5" stroke-linecap="round" />`;
  }).join("");
}

function renderStarGlyph(hash) {
  const outer = rangeValue(hash, 1, 24, 32);
  const inner = Math.max(10, Math.round(outer * 0.45));
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (-90 + index * 36) * (Math.PI / 180);
    const x = 50 + Math.cos(angle) * radius;
    const y = 50 + Math.sin(angle) * radius;
    points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `
    <polygon points="${points.join(", ")}" fill="${GLYPH_FILL}" />
    <circle cx="50" cy="50" r="7" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderSpiralGlyph(hash) {
  const turn = rangeValue(hash, 1, 10, 18);
  return `
    <path d="M64 26 C44 12, 18 26, 20 48 C22 74, 58 80, 68 58 C76 42, 62 28, 48 34 C38 38, 36 50, 44 56 C50 60, 58 56, 58 48" fill="none" stroke="${GLYPH_FILL}" stroke-width="${turn / 3}" stroke-linecap="round" />
  `;
}

function renderBeamGlyph(hash) {
  const rayCount = rangeValue(hash, 1, 5, 7);
  const rays = Array.from({ length: rayCount }, (_, index) => {
    const angle = (-70 + index * (140 / Math.max(1, rayCount - 1))) * (Math.PI / 180);
    const innerX = 50 + Math.cos(angle) * 12;
    const innerY = 40 + Math.sin(angle) * 12;
    const outerX = 50 + Math.cos(angle) * 28;
    const outerY = 40 + Math.sin(angle) * 28;
    return `<path d="M${innerX.toFixed(1)} ${innerY.toFixed(1)} L${outerX.toFixed(1)} ${outerY.toFixed(1)}" stroke="${GLYPH_FILL}" stroke-width="4.2" stroke-linecap="round" />`;
  }).join("");
  return `
    <circle cx="50" cy="40" r="12" fill="${GLYPH_FILL}" />
    ${rays}
    <rect x="44" y="52" width="12" height="20" rx="6" fill="${GLYPH_FILL}" />
  `;
}

function renderBoltGlyph(hash) {
  const tipX = rangeValue(hash, 1, 44, 56);
  return `
    <path d="M44 18 L${tipX} 42 H54 L46 82 L58 50 H44 Z" fill="${GLYPH_FILL}" />
  `;
}

function renderPagodaGlyph(hash) {
  const widths = [rangeValue(hash, 1, 18, 26), rangeValue(hash, 2, 14, 20), rangeValue(hash, 3, 10, 14)];
  return `
    <path d="M${50 - widths[0]} 28 L50 18 L${50 + widths[0]} 28 L${50 + widths[0] - 5} 36 L${50 - widths[0] + 5} 36 Z" fill="${GLYPH_FILL}" />
    <path d="M${50 - widths[1]} 44 L50 36 L${50 + widths[1]} 44 L${50 + widths[1] - 4} 50 L${50 - widths[1] + 4} 50 Z" fill="${GLYPH_FILL}" />
    <path d="M${50 - widths[2]} 58 L50 50 L${50 + widths[2]} 58 L${50 + widths[2] - 3} 64 L${50 - widths[2] + 3} 64 Z" fill="${GLYPH_FILL}" />
    <rect x="42" y="64" width="16" height="18" rx="2" fill="${GLYPH_FILL}" />
    <rect x="34" y="80" width="32" height="6" rx="2" fill="${GLYPH_FILL}" />
  `;
}

function renderPalmsGlyph(hash) {
  const spread = rangeValue(hash, 1, 18, 26);
  return `
    <path d="M44 80 C42 60, 42 46, 48 30" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <path d="M58 80 C56 64, 56 52, 60 38" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <path d="M48 34 C${48 - spread} 20, ${48 - spread} 12, 48 18" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.4" stroke-linecap="round" />
    <path d="M48 34 C48 14, ${48 + spread} 12, ${48 + spread} 20" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.4" stroke-linecap="round" />
    <path d="M60 40 C${60 - spread} 24, ${60 - spread} 18, 60 20" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.4" stroke-linecap="round" />
    <path d="M60 40 C60 20, ${60 + spread - 4} 18, ${60 + spread - 2} 28" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.4" stroke-linecap="round" />
  `;
}

function renderRoadGlyph(hash) {
  const topInset = rangeValue(hash, 1, 16, 24);
  const bottomInset = rangeValue(hash, 2, 8, 14);
  return `
    <path d="M${bottomInset} 84 H${100 - bottomInset} L${100 - topInset} 22 H${topInset} Z" fill="${GLYPH_FILL}" />
    <rect x="47" y="28" width="6" height="10" rx="2" fill="${FRAME_FILL}" />
    <rect x="47" y="46" width="6" height="10" rx="2" fill="${FRAME_FILL}" />
    <rect x="47" y="64" width="6" height="10" rx="2" fill="${FRAME_FILL}" />
  `;
}

function renderMapGlyph(hash) {
  const skew = rangeValue(hash, 1, 6, 14);
  return `
    <path d="M20 24 L${44 - skew / 2} 16 L${66 + skew / 2} 24 L82 18 V76 L${58 + skew / 3} 84 L${36 - skew / 3} 76 L20 82 Z" fill="${GLYPH_FILL}" />
    <path d="M42 18 V78" stroke="${FRAME_FILL}" stroke-width="4.2" stroke-linecap="round" />
    <path d="M60 22 V82" stroke="${FRAME_FILL}" stroke-width="4.2" stroke-linecap="round" />
  `;
}

function renderTowerGlyph(hash) {
  const width = rangeValue(hash, 1, 18, 24);
  return `
    <rect x="${50 - width / 2}" y="24" width="${width}" height="50" rx="4" fill="${GLYPH_FILL}" />
    <path d="M${50 - width / 2 - 8} 26 L50 14 L${50 + width / 2 + 8} 26 Z" fill="${GLYPH_FILL}" />
    <rect x="42" y="76" width="16" height="8" rx="2" fill="${GLYPH_FILL}" />
  `;
}

function renderHarborGlyph(hash) {
  const mastHeight = rangeValue(hash, 1, 26, 36);
  return `
    <path d="M18 72 C30 68, 42 68, 54 72 S78 76, 84 72" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.8" stroke-linecap="round" />
    <path d="M42 64 L${42 + mastHeight / 3} 28 L${42 + mastHeight / 3} 64 Z" fill="${GLYPH_FILL}" />
    <path d="M42 64 V28" stroke="${GLYPH_FILL}" stroke-width="4.2" stroke-linecap="round" />
    <path d="M42 64 H62" stroke="${GLYPH_FILL}" stroke-width="4.2" stroke-linecap="round" />
  `;
}

function renderArchGlyph(hash) {
  const archWidth = rangeValue(hash, 1, 40, 52);
  return `
    <path d="M${50 - archWidth / 2} 82 V48 C${50 - archWidth / 2} 28, ${50 + archWidth / 2} 28, ${50 + archWidth / 2} 48 V82" fill="${GLYPH_FILL}" />
    <path d="M${50 - archWidth / 3} 82 V58 C${50 - archWidth / 3} 46, ${50 + archWidth / 3} 46, ${50 + archWidth / 3} 58 V82" fill="${FRAME_FILL}" />
  `;
}

function renderDistrictGlyph(hash) {
  const columns = 3 + (hash[1] % 2);
  const rows = 3 + (hash[2] % 2);
  const cellWidth = 52 / columns;
  const cellHeight = 46 / rows;
  const blocks = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if ((column + row + hash[3]) % 4 === 0) continue;
      const x = 24 + column * cellWidth;
      const y = 26 + row * cellHeight;
      blocks.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cellWidth - 4).toFixed(1)}" height="${(cellHeight - 4).toFixed(1)}" rx="2" fill="${GLYPH_FILL}" />`);
    }
  }
  return blocks.join("");
}

function renderBridgeGlyph(hash) {
  const archHeight = rangeValue(hash, 1, 12, 20);
  return `
    <path d="M18 70 H82" stroke="${GLYPH_FILL}" stroke-width="5.2" stroke-linecap="round" />
    <path d="M24 70 C34 ${70 - archHeight}, 46 ${70 - archHeight}, 56 70" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.6" stroke-linecap="round" />
    <path d="M44 70 C56 ${70 - archHeight - 4}, 68 ${70 - archHeight - 4}, 76 70" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.6" stroke-linecap="round" />
    <path d="M28 70 V80 M50 70 V82 M72 70 V80" stroke="${GLYPH_FILL}" stroke-width="4" stroke-linecap="round" />
  `;
}

function renderDuneGlyph(hash) {
  const crest = rangeValue(hash, 1, 18, 28);
  return `
    <path d="M14 74 C26 ${74 - crest}, 42 ${74 - crest}, 54 74 S82 ${74 + crest / 3}, 86 60" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <path d="M18 60 C32 ${60 - crest / 2}, 44 ${60 - crest / 2}, 56 60 S78 ${60 + crest / 4}, 82 50" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.4" stroke-linecap="round" />
  `;
}
