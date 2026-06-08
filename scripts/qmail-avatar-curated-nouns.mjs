import { createHash } from "node:crypto";

const FRAME_FILL = "#23364b";
const GLYPH_FILL = "#f4edd1";
const GLYPH_HIGHLIGHT = "#fff4bf";

const NOUN_SPECS = buildNounSpecs();

const RENDERERS = {
  crest: renderCrestGlyph,
  institution: renderInstitutionGlyph,
  workshop: renderWorkshopGlyph,
  warehouse: renderWarehouseGlyph,
  residence: renderResidenceGlyph,
  market: renderMarketGlyph,
  settlement: renderSettlementGlyph,
  road: renderRoadGlyph,
  junction: renderJunctionGlyph,
  trail: renderTrailGlyph,
  bridge: renderBridgeGlyph,
  harbor: renderHarborGlyph,
  boat: renderBoatGlyph,
  shore: renderShoreGlyph,
  waterway: renderWaterwayGlyph,
  stillwater: renderStillWaterGlyph,
  falls: renderFallsGlyph,
  shallows: renderShallowsGlyph,
  island: renderIslandGlyph,
  forest: renderForestGlyph,
  garden: renderGardenGlyph,
  field: renderFieldGlyph,
  farm: renderFarmGlyph,
  peak: renderPeakGlyph,
  canyon: renderCanyonGlyph,
  stone: renderStoneGlyph,
  cave: renderCaveGlyph,
  sanctuary: renderSanctuaryGlyph,
  tower: renderTowerGlyph,
  sports: renderSportsGlyph,
  festival: renderFestivalGlyph,
  lookout: renderLookoutGlyph,
  grid: renderGridGlyph,
  galactic: renderGalacticGlyph,
  downunder: renderDownunderGlyph,
  locker: renderLockerGlyph,
  well: renderWellGlyph,
};

const SPECIAL_NOUN_RENDERERS = {
  spur: renderSpurHintGlyph,
  view: renderViewHintGlyph,
  kitchen: renderKitchenHintGlyph,
  road: renderRoadHintGlyph,
  lighthouse: renderLighthouseHintGlyph,
  downunder: renderAustraliaHintGlyph,
  strip: renderStripHintGlyph,
  gorge: renderGorgeHintGlyph,
  boulevard: renderBoulevardHintGlyph,
  woods: renderWoodsHintGlyph,
  tower: renderTowerHintGlyph,
  loop: renderLoopHintGlyph,
  trails: renderTrailsHintGlyph,
  library: renderLibraryHintGlyph,
  vineyard: renderVineyardHintGlyph,
  glade: renderGladeHintGlyph,
  crater: renderCraterHintGlyph,
  colony: renderColonyHintGlyph,
  forest: renderForestHintGlyph,
  alley: renderAlleyHintGlyph,
  borough: renderBoroughHintGlyph,
  pueblo: renderPuebloHintGlyph,
  cinema: renderCinemaHintGlyph,
  peninsula: renderPeninsulaHintGlyph,
  plateau: renderPlateauHintGlyph,
  cape: renderCapeHintGlyph,
  port: renderPortHintGlyph,
  motorway: renderMotorwayHintGlyph,
  dock: renderDockHintGlyph,
  highlands: renderHighlandsHintGlyph,
  village: renderVillageHintGlyph,
  terrace: renderTerraceHintGlyph,
  keys: renderKeysHintGlyph,
  pool: renderPoolHintGlyph,
  plains: renderPlainsHintGlyph,
  bar: renderBarHintGlyph,
  station: renderStationHintGlyph,
  grove: renderGroveHintGlyph,
  circle: renderCircleHintGlyph,
  court: renderCourtHintGlyph,
  reef: renderReefHintGlyph,
  reservoir: renderReservoirHintGlyph,
  bayou: renderBayouHintGlyph,
  oasis: renderOasisHintGlyph,
  marina: renderMarinaHintGlyph,
  mesa: renderMesaHintGlyph,
  springs: renderSpringsHintGlyph,
  acres: renderAcresHintGlyph,
  palace: renderPalaceHintGlyph,
  church: renderChurchHintGlyph,
  lane: renderLaneHintGlyph,
  shoal: renderShoalHintGlyph,
  shallows: renderShallowsHintGlyph,
  fortress: renderFortressHintGlyph,
  arcade: renderArcadeHintGlyph,
  causeway: renderCausewayHintGlyph,
  bluffs: renderBluffsHintGlyph,
  getaway: renderGetawayHintGlyph,
  walkway: renderWalkwayHintGlyph,
  retreat: renderRetreatHintGlyph,
  dunes: renderDunesHintGlyph,
  delta: renderDeltaHintGlyph,
  square: renderSquareHintGlyph,
  desert: renderDesertHintGlyph,
};

export function hasSemanticNounGlyph(word) {
  return NOUN_SPECS.has(word);
}

export function renderSemanticNounGlyph(word, index) {
  const specialRenderer = SPECIAL_NOUN_RENDERERS[word];
  if (specialRenderer) {
    const hash = wordHash(word, index, "semantic-noun-special");
    return toSvg(specialRenderer(hash));
  }

  const spec = NOUN_SPECS.get(word);
  if (!spec) {
    return null;
  }

  const renderer = RENDERERS[spec.kind];
  if (!renderer) {
    throw new Error(`Missing renderer '${spec.kind}' for noun '${word}'`);
  }

  const hash = wordHash(word, index, "semantic-noun");
  return toSvg(renderer(hash, spec));
}

function buildNounSpecs() {
  const map = new Map();

  setWords(map, ["kingdom", "empire", "realms"], "crest", { emblem: "crown" });
  setWords(map, ["republic", "nation"], "crest", { emblem: "star" });
  setWords(map, ["union"], "crest", { emblem: "nodes" });
  setWords(map, ["domain"], "crest", { emblem: "shield" });

  setWords(map, ["academy", "college"], "institution", { emblem: "columns" });
  setWords(map, ["bank"], "institution", { emblem: "vault" });
  setWords(map, ["library"], "institution", { emblem: "book" });
  setWords(map, ["clinic"], "institution", { emblem: "cross" });
  setWords(map, ["cinema"], "institution", { emblem: "reel" });
  setWords(map, ["laboratory"], "institution", { emblem: "flask" });
  setWords(map, ["aquarium", "fishery"], "institution", { emblem: "fish" });
  setWords(map, ["gallery"], "institution", { emblem: "frame" });
  setWords(map, ["aviary"], "institution", { emblem: "bird" });
  setWords(map, ["zoo"], "institution", { emblem: "paw" });
  setWords(map, ["gym"], "institution", { emblem: "dumbbell" });
  setWords(map, ["symposium"], "institution", { emblem: "podium" });
  setWords(map, ["kitchen"], "institution", { emblem: "pot" });

  setWords(map, ["mill"], "workshop", { emblem: "wheel" });
  setWords(map, ["foundry", "workshop"], "workshop", { emblem: "gear" });
  setWords(map, ["forge"], "workshop", { emblem: "hammer" });

  setWords(map, ["storehouse", "depot"], "warehouse", { emblem: "crate" });
  setWords(map, ["station"], "warehouse", { emblem: "rail" });
  setWords(map, ["base", "hq"], "warehouse", { emblem: "flag" });
  setWords(map, ["anex"], "warehouse", { emblem: "wing" });

  setWords(map, ["house", "homestead"], "residence", { variant: "house" });
  setWords(map, ["manor", "mansion"], "residence", { variant: "manor" });
  setWords(map, ["cabin", "lodge"], "residence", { variant: "cabin" });
  setWords(map, ["hotel", "inn"], "residence", { variant: "hotel" });
  setWords(map, ["loft"], "residence", { variant: "loft" });
  setWords(map, ["hall"], "residence", { variant: "hall" });
  setWords(map, ["hideout", "hideaway", "retreat", "getaway"], "residence", { variant: "hide" });
  setWords(map, ["roadhouse"], "residence", { variant: "roadhouse" });
  setWords(map, ["club"], "residence", { variant: "club" });
  setWords(map, ["camp"], "residence", { variant: "camp" });

  setWords(map, ["mall", "market"], "market", { variant: "market" });
  setWords(map, ["plaza", "square", "commons", "court"], "market", { variant: "plaza" });
  setWords(map, ["arcade"], "market", { variant: "arcade" });
  setWords(map, ["tavern", "bar"], "market", { variant: "tavern" });

  setWords(map, ["colony", "borough", "pueblo", "estates", "province", "parish", "township", "village"], "settlement", { variant: "village" });
  setWords(map, ["district", "center", "city"], "settlement", { variant: "city" });
  setWords(map, ["metro"], "grid", { variant: "metro" });
  setWords(map, ["place"], "lookout", { variant: "place" });

  setWords(map, ["road", "boulevard", "avenue", "throughway", "freeway", "highway", "turnpike", "route", "expressway", "motorway", "parkway", "bypass"], "road", { variant: "major" });
  setWords(map, ["street", "drive", "way", "lane", "walkway", "alley", "strip"], "road", { variant: "minor" });
  setWords(map, ["tunnel"], "road", { variant: "tunnel" });

  setWords(map, ["portal", "gate", "gateway", "entry"], "junction", { variant: "gate" });
  setWords(map, ["crossing", "junction", "crossroads"], "junction", { variant: "cross" });
  setWords(map, ["branch", "spur", "fork"], "junction", { variant: "fork" });
  setWords(map, ["loop"], "junction", { variant: "loop" });
  setWords(map, ["circle", "circles"], "junction", { variant: "rings" });
  setWords(map, ["corner"], "junction", { variant: "corner" });

  setWords(map, ["path", "trails", "passage", "pass"], "trail", { variant: "trail" });

  setWords(map, ["viaduct", "causeway", "skyway"], "bridge", { variant: "bridge" });

  setWords(map, ["harbor", "haven", "port", "dock", "wharf", "marina", "landing"], "harbor", { variant: "harbor" });
  setWords(map, ["ship"], "boat", { variant: "ship" });
  setWords(map, ["ferry"], "boat", { variant: "ferry" });

  setWords(map, ["shore", "coast", "beach"], "shore", { variant: "shore" });
  setWords(map, ["inlet", "gulf", "bay"], "shore", { variant: "bay" });
  setWords(map, ["ocean"], "shore", { variant: "ocean" });

  setWords(map, ["canal", "creek", "river", "brook", "bayou"], "waterway", { variant: "river" });
  setWords(map, ["narrows"], "waterway", { variant: "narrows" });
  setWords(map, ["delta"], "waterway", { variant: "delta" });

  setWords(map, ["lakes", "waters", "pool", "pond", "reservoir"], "stillwater", { variant: "stillwater" });
  setWords(map, ["marsh"], "stillwater", { variant: "marsh" });
  setWords(map, ["rapids", "falls", "waterfall"], "falls", { variant: "falls" });
  setWords(map, ["ford", "atoll", "reef", "shoal", "shallows"], "shallows", { variant: "shallows" });
  setWords(map, ["peninsula", "cape", "island", "point", "keys", "oasis"], "island", { variant: "island" });

  setWords(map, ["baths", "well", "fountain", "springs"], "well", { variant: "well" });

  setWords(map, ["jungle", "woods", "forest", "palms", "grove", "pines", "roost"], "forest", { variant: "forest" });
  setWords(map, ["vineyard", "orchard", "glade", "park", "gardens"], "garden", { variant: "garden" });
  setWords(map, ["grounds", "meadows", "prairie", "fields", "acres", "plains", "flats", "mounds", "desert", "dunes"], "field", { variant: "field" });
  setWords(map, ["greens"], "sports", { variant: "greens" });
  setWords(map, ["dairy", "farm", "ranch", "farmstead"], "farm", { variant: "farm" });

  setWords(map, ["summit", "mountain", "foothills", "ridge", "crest", "peak", "hills", "highlands", "knoll", "heights"], "peak", { variant: "peak" });
  setWords(map, ["plateau", "buttes", "mesa", "cliff", "bluffs", "terrace", "palisade", "wall", "arches"], "stone", { variant: "stone" });
  setWords(map, ["gorge", "glen", "hollow", "canyon", "valley"], "canyon", { variant: "canyon" });
  setWords(map, ["crater", "grotto", "cave"], "cave", { variant: "cave" });

  setWords(map, ["pyramid", "castle", "fort", "pagoda", "temple", "palace", "church", "fortress", "abbey"], "sanctuary", { variant: "sanctuary" });
  setWords(map, ["lighthouse", "tower", "obelisk", "dome", "pavilion"], "tower", { variant: "tower" });

  setWords(map, ["fairway", "course", "track", "raceway", "stadium", "games"], "sports", { variant: "sports" });
  setWords(map, ["carnival"], "festival", { variant: "festival" });
  setWords(map, ["view", "vista", "lookout"], "lookout", { variant: "lookout" });
  setWords(map, ["grid", "subway"], "grid", { variant: "grid" });
  setWords(map, ["galactic"], "galactic", { variant: "galactic" });
  setWords(map, ["downunder"], "downunder", { variant: "downunder" });
  setWords(map, ["locker"], "locker", { variant: "locker" });

  return map;
}

function setWords(map, words, kind, options) {
  for (const word of words) {
    if (map.has(word)) {
      throw new Error(`Duplicate noun spec for '${word}'`);
    }
    map.set(word, { kind, word, ...options });
  }
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

function emblemAt(type, x = 50, y = 52, scale = 1) {
  const markup = renderEmblem(type);
  return `<g transform="translate(${x} ${y}) scale(${scale}) translate(-50 -50)">${markup}</g>`;
}

function renderEmblem(type) {
  switch (type) {
    case "crown":
      return `<path d="M38 54 L42 42 L50 50 L58 42 L62 54 V60 H38 Z" fill="${GLYPH_HIGHLIGHT}" />`;
    case "star":
      return `<path d="M50 40 L53.5 48 H62 L55 53.3 L57.8 62 L50 56.8 L42.2 62 L45 53.3 L38 48 H46.5 Z" fill="${GLYPH_HIGHLIGHT}" />`;
    case "nodes":
      return `
        <circle cx="42" cy="48" r="4" fill="${GLYPH_HIGHLIGHT}" />
        <circle cx="58" cy="48" r="4" fill="${GLYPH_HIGHLIGHT}" />
        <circle cx="50" cy="58" r="4" fill="${GLYPH_HIGHLIGHT}" />
        <path d="M45 50 L55 50 L50 56" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      `;
    case "shield":
      return `<path d="M42 42 H58 V52 C58 58 54 62 50 64 C46 62 42 58 42 52 Z" fill="${GLYPH_HIGHLIGHT}" />`;
    case "columns":
      return `
        <path d="M40 44 H60" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
        <path d="M42 44 V60 M50 44 V60 M58 44 V60" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
        <path d="M38 60 H62" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
      `;
    case "vault":
      return `
        <circle cx="50" cy="52" r="10" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" />
        <path d="M50 46 V58 M44 52 H56" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
      `;
    case "book":
      return `
        <path d="M40 44 H49 C52 44 54 46 54 49 V60 H45 C42 60 40 58 40 55 Z" fill="${GLYPH_HIGHLIGHT}" />
        <path d="M60 44 H51 C48 44 46 46 46 49 V60 H55 C58 60 60 58 60 55 Z" fill="${GLYPH_HIGHLIGHT}" />
      `;
    case "cross":
      return `<path d="M47 42 H53 V49 H60 V55 H53 V62 H47 V55 H40 V49 H47 Z" fill="${GLYPH_HIGHLIGHT}" />`;
    case "flask":
      return `<path d="M46 42 H54 V48 L60 60 V64 H40 V60 L46 48 Z" fill="${GLYPH_HIGHLIGHT}" />`;
    case "reel":
      return `
        <rect x="40" y="46" width="20" height="14" rx="3" fill="${GLYPH_HIGHLIGHT}" />
        <circle cx="44" cy="49" r="2.1" fill="${FRAME_FILL}" />
        <circle cx="56" cy="49" r="2.1" fill="${FRAME_FILL}" />
        <path d="M50 46 V60" stroke="${FRAME_FILL}" stroke-width="2.6" stroke-linecap="round" />
      `;
    case "fish":
      return `<path d="M40 52 C44 46 51 46 57 52 C51 58 44 58 40 52 Z M57 52 L63 48 V56 Z" fill="${GLYPH_HIGHLIGHT}" />`;
    case "frame":
      return `
        <rect x="41" y="43" width="18" height="18" rx="2" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" />
        <path d="M44 57 L49 51 L53 55 L56 52" stroke="${GLYPH_HIGHLIGHT}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />
      `;
    case "bird":
      return `<path d="M40 56 C44 50 48 48 50 50 C52 48 56 50 60 56" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" />`;
    case "paw":
      return `
        <circle cx="44" cy="47" r="2.8" fill="${GLYPH_HIGHLIGHT}" />
        <circle cx="50" cy="44" r="2.8" fill="${GLYPH_HIGHLIGHT}" />
        <circle cx="56" cy="47" r="2.8" fill="${GLYPH_HIGHLIGHT}" />
        <path d="M43 56 C43 52, 57 52, 57 56 C57 60, 43 60, 43 56 Z" fill="${GLYPH_HIGHLIGHT}" />
      `;
    case "dumbbell":
      return `
        <rect x="39" y="49" width="22" height="6" rx="3" fill="${GLYPH_HIGHLIGHT}" />
        <rect x="35" y="46" width="3" height="12" rx="1.5" fill="${GLYPH_HIGHLIGHT}" />
        <rect x="62" y="46" width="3" height="12" rx="1.5" fill="${GLYPH_HIGHLIGHT}" />
      `;
    case "podium":
      return `<path d="M44 60 V48 L58 44 V56 L52 58 V60 Z" fill="${GLYPH_HIGHLIGHT}" />`;
    case "pot":
      return `
        <path d="M42 48 H58 V58 C58 61 55 64 52 64 H48 C45 64 42 61 42 58 Z" fill="${GLYPH_HIGHLIGHT}" />
        <path d="M40 50 H42 M58 50 H60" stroke="${GLYPH_HIGHLIGHT}" stroke-width="2.6" stroke-linecap="round" />
      `;
    case "gear":
      return `
        <circle cx="50" cy="52" r="7" fill="${GLYPH_HIGHLIGHT}" />
        <circle cx="50" cy="52" r="3" fill="${FRAME_FILL}" />
        <path d="M50 42 V46 M50 58 V62 M40 52 H44 M56 52 H60 M43 45 L46 48 M54 56 L57 59 M57 45 L54 48 M46 56 L43 59" stroke="${GLYPH_HIGHLIGHT}" stroke-width="2.6" stroke-linecap="round" />
      `;
    case "hammer":
      return `
        <path d="M44 46 H58 V52 H52 V60 H48 V52 H44 Z" fill="${GLYPH_HIGHLIGHT}" />
        <path d="M48 52 L58 62" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
      `;
    case "wheel":
      return `
        <circle cx="50" cy="52" r="8" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" />
        <path d="M50 44 V60 M42 52 H58 M44 46 L56 58 M56 46 L44 58" stroke="${GLYPH_HIGHLIGHT}" stroke-width="2.4" stroke-linecap="round" />
      `;
    case "milk":
      return `<path d="M46 42 H54 V48 L58 52 V62 C58 64, 56 66, 54 66 H46 C44 66, 42 64, 42 62 V52 L46 48 Z" fill="${GLYPH_HIGHLIGHT}" />`;
    case "crate":
      return `
        <rect x="42" y="46" width="16" height="14" rx="2" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" />
        <path d="M42 46 L58 60 M58 46 L42 60" stroke="${GLYPH_HIGHLIGHT}" stroke-width="2.4" stroke-linecap="round" />
      `;
    case "rail":
      return `
        <path d="M42 46 V60 M58 46 V60" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
        <path d="M40 48 H60 M40 56 H60" stroke="${GLYPH_HIGHLIGHT}" stroke-width="2.6" stroke-linecap="round" />
      `;
    case "flag":
      return `
        <path d="M44 42 V62" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
        <path d="M46 42 H60 L56 50 H46 Z" fill="${GLYPH_HIGHLIGHT}" />
      `;
    case "wing":
      return `<path d="M40 54 C46 44, 54 44, 60 54 M42 58 C48 50, 52 50, 58 58" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />`;
    case "mug":
      return `
        <path d="M42 46 H56 V58 C56 61 54 63 51 63 H47 C44 63 42 61 42 58 Z" fill="${GLYPH_HIGHLIGHT}" />
        <path d="M56 49 H60 C61.5 49 62 50.5 62 52 C62 53.5 61.5 55 60 55 H56" stroke="${GLYPH_HIGHLIGHT}" stroke-width="2.6" stroke-linecap="round" />
      `;
    default:
      return `<circle cx="50" cy="52" r="8" fill="${GLYPH_HIGHLIGHT}" />`;
  }
}

function renderCrestGlyph(hash, spec) {
  const width = rangeValue(hash, 1, 26, 34);
  return `
    <path d="M${50 - width / 2} 24 H${50 + width / 2} V48 C${50 + width / 2} 62, 58 70, 50 76 C42 70, ${50 - width / 2} 62, ${50 - width / 2} 48 Z" fill="${GLYPH_FILL}" />
    ${emblemAt(spec.emblem, 50, 50, 1)}
    <path d="M30 76 H70" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
  `;
}

function renderInstitutionGlyph(hash, spec) {
  const roofY = rangeValue(hash, 1, 26, 30);
  const width = rangeValue(hash, 2, 44, 52);
  const left = 50 - width / 2;
  const right = 50 + width / 2;
  const sideWindows = spec.emblem === "columns" ? "" : `
    <rect x="${left + 6}" y="60" width="7" height="7" rx="2" fill="${GLYPH_HIGHLIGHT}" />
    <rect x="${right - 13}" y="60" width="7" height="7" rx="2" fill="${GLYPH_HIGHLIGHT}" />
  `;
  return `
    <path d="M${left} 80 V${roofY + 10} L50 ${roofY} L${right} ${roofY + 10} V80 H${left} Z" fill="${GLYPH_FILL}" />
    ${spec.emblem === "columns" ? `<path d="M${left + 10} 46 H${right - 10}" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />` : ""}
    ${emblemAt(spec.emblem, 50, 52, 1)}
    ${sideWindows}
    <path d="M${left + 10} 80 V68 H${right - 10} V80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
  `;
}

function renderWorkshopGlyph(hash, spec) {
  const chimney = rangeValue(hash, 1, 26, 34);
  return `
    <path d="M20 80 V44 L34 34 H66 L80 44 V80 H20 Z" fill="${GLYPH_FILL}" />
    <rect x="62" y="${chimney}" width="8" height="${44 - chimney}" rx="2" fill="${GLYPH_FILL}" />
    ${emblemAt(spec.emblem, 48, 54, 1)}
    <path d="M28 80 V64 H42 V80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
  `;
}

function renderWarehouseGlyph(hash, spec) {
  const roofInset = rangeValue(hash, 1, 10, 16);
  const flag = spec.emblem === "flag" ? `<path d="M50 24 V36" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" /><path d="M52 24 H64 L60 30 H52 Z" fill="${GLYPH_HIGHLIGHT}" />` : "";
  return `
    ${flag}
    <path d="M18 80 V40 L${50 - roofInset} 28 H${50 + roofInset} L82 40 V80 H18 Z" fill="${GLYPH_FILL}" />
    ${emblemAt(spec.emblem, 50, 52, 0.95)}
    <rect x="42" y="62" width="16" height="18" rx="2" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderResidenceGlyph(hash, spec) {
  if (spec.variant === "camp") {
    return `
      <path d="M24 80 L50 34 L76 80 H24 Z" fill="${GLYPH_FILL}" />
      <path d="M50 34 V80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
      <path d="M42 80 V64 H58 V80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    `;
  }

  const tall = spec.variant === "manor" || spec.variant === "hotel" || spec.variant === "loft";
  const roofY = tall ? 26 : 34;
  const left = spec.variant === "loft" ? 34 : 24;
  const right = spec.variant === "loft" ? 66 : 76;
  const sign = spec.variant === "club"
    ? `<path d="M30 40 V26" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" /><path d="M32 26 H42 L38 32 H32 Z" fill="${GLYPH_HIGHLIGHT}" />`
    : spec.variant === "roadhouse"
      ? `<path d="M18 78 H82" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.6" stroke-linecap="round" />`
      : "";
  const inner = spec.variant === "hide"
    ? `<path d="M30 58 C38 48, 46 44, 54 44 C64 44, 70 50, 74 58" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />`
    : spec.variant === "hotel"
      ? emblemAt("flag", 50, 52, 0.9)
      : "";
  return `
    ${sign}
    <path d="M${left} 80 V${roofY + 10} L50 ${roofY} L${right} ${roofY + 10} V80 H${left} Z" fill="${GLYPH_FILL}" />
    ${inner}
    <path d="M42 80 V64 H58 V80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    ${spec.variant === "cabin" ? `<path d="M34 50 H66 M34 58 H66" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />` : ""}
  `;
}

function renderMarketGlyph(hash, spec) {
  const canopyHeight = rangeValue(hash, 1, 10, 14);
  const sign = spec.variant === "tavern" ? emblemAt("mug", 50, 58, 0.9) : "";
  const arcadeArch = spec.variant === "arcade"
    ? `<path d="M26 80 V58 C26 44, 74 44, 74 58 V80" fill="${GLYPH_HIGHLIGHT}" />`
    : "";
  const plazaBase = spec.variant === "plaza"
    ? `<path d="M28 80 L38 68 H62 L72 80" fill="${GLYPH_HIGHLIGHT}" />`
    : "";
  return `
    <path d="M20 42 H80 V52 C80 56, 76 58, 74 62 V80 H26 V62 C24 58, 20 56, 20 52 Z" fill="${GLYPH_FILL}" />
    <path d="M22 42 L30 ${42 + canopyHeight} L38 42 L46 ${42 + canopyHeight} L54 42 L62 ${42 + canopyHeight} L70 42 L78 ${42 + canopyHeight}" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" />
    ${arcadeArch}
    ${plazaBase}
    ${sign}
  `;
}

function renderSettlementGlyph(hash, spec) {
  const tall = spec.variant === "city";
  const leftHeight = tall ? 34 : 26;
  const centerHeight = tall ? 48 : 34;
  const rightHeight = tall ? 30 : 24;
  return `
    <rect x="18" y="${80 - leftHeight}" width="18" height="${leftHeight}" rx="2" fill="${GLYPH_FILL}" />
    <rect x="40" y="${80 - centerHeight}" width="20" height="${centerHeight}" rx="2" fill="${GLYPH_FILL}" />
    <rect x="64" y="${80 - rightHeight}" width="18" height="${rightHeight}" rx="2" fill="${GLYPH_FILL}" />
    <path d="M24 ${80 - leftHeight + 8} V${80 - leftHeight + 16} M50 ${80 - centerHeight + 8} V${80 - centerHeight + 20} M74 ${80 - rightHeight + 8} V${80 - rightHeight + 16}" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
    ${spec.word === "pueblo" ? `<path d="M18 80 H82" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />` : ""}
  `;
}

function renderRoadGlyph(hash, spec) {
  if (spec.variant === "tunnel") {
    return `
      <path d="M22 80 V52 C22 34, 78 34, 78 52 V80" fill="${GLYPH_FILL}" />
      <path d="M38 80 V62 C38 52, 62 52, 62 62 V80" fill="${FRAME_FILL}" />
      <path d="M50 54 V74" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="8 6" />
    `;
  }

  const topInset = spec.variant === "major" ? rangeValue(hash, 1, 14, 20) : rangeValue(hash, 1, 24, 30);
  const bottomInset = spec.variant === "major" ? rangeValue(hash, 2, 6, 10) : rangeValue(hash, 2, 18, 22);
  const lanes = spec.variant === "major"
    ? `<rect x="47" y="28" width="6" height="10" rx="2" fill="${FRAME_FILL}" /><rect x="47" y="46" width="6" height="10" rx="2" fill="${FRAME_FILL}" /><rect x="47" y="64" width="6" height="10" rx="2" fill="${FRAME_FILL}" />`
    : `<path d="M50 28 V76" stroke="${FRAME_FILL}" stroke-width="4" stroke-linecap="round" stroke-dasharray="10 8" />`;
  return `
    <path d="M${bottomInset} 84 H${100 - bottomInset} L${100 - topInset} 22 H${topInset} Z" fill="${GLYPH_FILL}" />
    ${lanes}
  `;
}

function renderJunctionGlyph(hash, spec) {
  if (spec.variant === "gate") {
    return `
      <path d="M26 80 V48 C26 30, 74 30, 74 48 V80" fill="${GLYPH_FILL}" />
      <path d="M38 80 V58 C38 48, 62 48, 62 58 V80" fill="${FRAME_FILL}" />
      <path d="M34 42 H66" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    `;
  }

  if (spec.variant === "fork") {
    return `
      <path d="M50 80 V58" stroke="${GLYPH_FILL}" stroke-width="8" stroke-linecap="round" />
      <path d="M50 58 C50 48, 40 40, 28 30" stroke="${GLYPH_FILL}" stroke-width="8" stroke-linecap="round" />
      <path d="M50 58 C50 48, 60 40, 72 30" stroke="${GLYPH_FILL}" stroke-width="8" stroke-linecap="round" />
    `;
  }

  if (spec.variant === "loop") {
    return `
      <path d="M34 34 C20 46, 20 66, 34 74 C48 82, 66 76, 70 64 C74 52, 64 42, 52 44 C44 46, 40 56, 46 62 C50 66, 58 64, 60 58" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    `;
  }

  if (spec.variant === "rings") {
    return `
      <circle cx="42" cy="52" r="14" stroke="${GLYPH_FILL}" stroke-width="5" />
      <circle cx="58" cy="52" r="14" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" />
    `;
  }

  if (spec.variant === "corner") {
    return `<path d="M28 30 V72 H72" stroke="${GLYPH_FILL}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />`;
  }

  return `
    <path d="M18 52 H82" stroke="${GLYPH_FILL}" stroke-width="8" stroke-linecap="round" />
    <path d="M50 20 V84" stroke="${GLYPH_FILL}" stroke-width="8" stroke-linecap="round" />
  `;
}

function renderTrailGlyph(hash) {
  const bend = rangeValue(hash, 1, 10, 16);
  return `
    <path d="M24 80 C30 68, 38 62, 46 54 C56 44, ${56 + bend} 36, 74 24" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <path d="M22 80 C32 72, 44 72, 56 80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
  `;
}

function renderBridgeGlyph(hash, spec) {
  const archHeight = spec.word === "skyway" ? 24 : rangeValue(hash, 1, 14, 20);
  return `
    <path d="M18 68 H82" stroke="${GLYPH_FILL}" stroke-width="5.2" stroke-linecap="round" />
    <path d="M24 68 C34 ${68 - archHeight}, 46 ${68 - archHeight}, 56 68" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.6" stroke-linecap="round" />
    <path d="M44 68 C56 ${68 - archHeight - 4}, 68 ${68 - archHeight - 4}, 76 68" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.6" stroke-linecap="round" />
    <path d="M28 68 V80 M50 68 V82 M72 68 V80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
  `;
}

function renderHarborGlyph(hash, spec) {
  const mastX = spec.word === "landing" ? 36 : 44;
  const dockLength = rangeValue(hash, 1, 18, 26);
  return `
    <path d="M18 74 C30 70, 42 70, 54 74 S78 78, 84 74" fill="none" stroke="${GLYPH_FILL}" stroke-width="4.8" stroke-linecap="round" />
    <path d="M${mastX} 70 H${mastX + dockLength}" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    <path d="M${mastX + 6} 70 V48 M${mastX + 18} 70 V52 M${mastX + 30} 70 V56" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
    ${spec.word === "marina" ? `<path d="M58 62 L68 44 L68 62 Z" fill="${GLYPH_HIGHLIGHT}" />` : ""}
  `;
}

function renderBoatGlyph(hash, spec) {
  if (spec.variant === "ferry") {
    return `
      <path d="M24 70 H76 L68 80 H32 Z" fill="${GLYPH_FILL}" />
      <rect x="36" y="52" width="28" height="18" rx="3" fill="${GLYPH_FILL}" />
      <path d="M44 52 V44 H58" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
      <path d="M18 82 C30 78, 42 78, 54 82 S78 86, 84 82" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
    `;
  }

  return `
    <path d="M24 70 H76 L66 80 H34 Z" fill="${GLYPH_FILL}" />
    <path d="M48 28 V70" stroke="${GLYPH_FILL}" stroke-width="4" stroke-linecap="round" />
    <path d="M50 30 L68 48 L50 54 Z" fill="${GLYPH_HIGHLIGHT}" />
    <path d="M18 82 C30 78, 42 78, 54 82 S78 86, 84 82" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderShoreGlyph(hash, spec) {
  if (spec.variant === "ocean") {
    return `
      <path d="M16 38 C28 26, 40 26, 52 38 S76 50, 84 40" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
      <path d="M18 54 C30 42, 44 42, 56 54 S78 66, 84 56" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
      <path d="M20 70 C32 58, 46 58, 58 70 S80 82, 84 72" fill="none" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    `;
  }

  if (spec.variant === "bay") {
    return `
      <path d="M18 34 C30 26, 40 28, 50 42 C60 28, 70 26, 82 34" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" fill="none" />
      <path d="M20 74 C28 60, 38 54, 50 54 C62 54, 72 60, 80 74" fill="${GLYPH_FILL}" />
      <path d="M30 74 C36 68, 42 64, 50 64 C58 64, 64 68, 70 74" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    `;
  }

  return `
    <path d="M18 78 C30 60, 42 54, 56 54 C66 54, 74 58, 82 68" fill="${GLYPH_FILL}" />
    <path d="M20 48 C34 42, 46 42, 58 48 S78 56, 84 52" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M22 68 C34 62, 46 62, 58 68 S78 76, 84 72" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderWaterwayGlyph(hash, spec) {
  if (spec.variant === "delta") {
    return `
      <path d="M50 18 V46" stroke="${GLYPH_FILL}" stroke-width="7" stroke-linecap="round" />
      <path d="M50 46 C50 54, 40 62, 28 78" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
      <path d="M50 46 C50 54, 50 62, 50 80" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
      <path d="M50 46 C50 54, 60 62, 72 78" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    `;
  }

  if (spec.variant === "narrows") {
    return `
      <path d="M34 18 C28 34, 28 66, 34 82" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4.2" stroke-linecap="round" />
      <path d="M66 18 C72 34, 72 66, 66 82" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4.2" stroke-linecap="round" />
      <path d="M50 18 C44 34, 44 66, 50 82 C56 66, 56 34, 50 18 Z" fill="${GLYPH_FILL}" />
    `;
  }

  const sway = rangeValue(hash, 1, 6, 12);
  return `
    <path d="M42 18 C${42 - sway} 34, ${42 - sway} 60, 42 82" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M58 18 C${58 + sway} 34, ${58 + sway} 60, 58 82" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M50 18 C${50 - sway / 2} 34, ${50 + sway / 2} 60, 50 82" stroke="${GLYPH_FILL}" stroke-width="7" stroke-linecap="round" />
  `;
}

function renderStillWaterGlyph(hash, spec) {
  if (spec.variant === "marsh") {
    return `
      <ellipse cx="50" cy="62" rx="24" ry="12" fill="${GLYPH_FILL}" />
      <path d="M32 54 V38 M42 56 V40 M58 56 V38 M68 54 V40" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
      <path d="M28 62 C36 58, 44 58, 52 62 S68 66, 72 62" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
    `;
  }

  const width = rangeValue(hash, 1, 22, 30);
  return `
    <ellipse cx="50" cy="58" rx="${width}" ry="16" fill="${GLYPH_FILL}" />
    <path d="M34 54 C42 50, 58 50, 66 54" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    <path d="M38 62 C44 60, 56 60, 62 62" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
  `;
}

function renderFallsGlyph(hash, spec) {
  if (spec.word === "rapids") {
    return `
      <path d="M24 40 C34 34, 44 34, 54 40 S74 48, 82 42" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
      <path d="M20 58 C30 50, 42 50, 52 58 S74 66, 82 60" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
      <path d="M26 74 C36 68, 46 68, 56 74 S74 80, 80 76" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    `;
  }

  return `
    <path d="M26 26 H74" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M34 26 V72 M50 26 V78 M66 26 V72" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <path d="M24 80 C34 76, 44 76, 54 80 S74 84, 80 80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderShallowsGlyph(hash, spec) {
  if (spec.word === "atoll") {
    return `
      <ellipse cx="50" cy="56" rx="24" ry="18" fill="${GLYPH_FILL}" />
      <ellipse cx="50" cy="56" rx="12" ry="8" fill="${FRAME_FILL}" />
      <path d="M30 56 C34 50, 40 48, 46 48" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
    `;
  }

  if (spec.word === "ford") {
    return `
      <path d="M18 60 C32 52, 44 52, 58 60 S80 68, 84 64" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
      <circle cx="36" cy="58" r="4" fill="${GLYPH_HIGHLIGHT}" />
      <circle cx="50" cy="60" r="4" fill="${GLYPH_HIGHLIGHT}" />
      <circle cx="64" cy="62" r="4" fill="${GLYPH_HIGHLIGHT}" />
    `;
  }

  return `
    <path d="M18 66 C32 58, 46 58, 58 66 S78 74, 84 70" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    <path d="M30 58 C36 50, 44 48, 52 50 C58 52, 64 52, 72 48" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    <circle cx="64" cy="64" r="4" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderIslandGlyph(hash, spec) {
  if (spec.word === "oasis") {
    return `
      <ellipse cx="50" cy="66" rx="22" ry="10" fill="${GLYPH_FILL}" />
      <path d="M42 44 C40 56, 40 64, 44 80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
      <path d="M56 40 C54 54, 54 62, 58 78" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
      <path d="M44 48 C34 38, 32 30, 44 34" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
      <path d="M58 44 C68 34, 70 28, 58 32" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
    `;
  }

  if (spec.word === "keys") {
    return `
      <path d="M18 70 C26 66, 34 66, 40 70" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
      <path d="M40 66 C48 62, 56 62, 62 66" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
      <path d="M62 62 C70 58, 78 58, 82 62" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
      <path d="M46 46 L56 36" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
    `;
  }

  return `
    <path d="M18 78 C28 62, 40 54, 54 54 C66 54, 74 60, 82 70" fill="${GLYPH_FILL}" />
    <path d="M44 54 C42 46, 42 38, 46 28" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M46 34 C36 28, 34 22, 46 22" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderForestGlyph(hash, spec) {
  if (spec.word === "palms") {
    return `
      <path d="M44 80 C42 62, 42 48, 48 32" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
      <path d="M58 80 C56 64, 56 52, 60 38" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
      <path d="M48 34 C32 22, 30 16, 48 18" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
      <path d="M48 34 C48 18, 66 16, 68 26" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
      <path d="M60 40 C46 28, 46 22, 60 22" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    `;
  }

  if (spec.word === "pines") {
    return `
      <path d="M30 80 L42 56 L54 80 H30 Z" fill="${GLYPH_FILL}" />
      <path d="M46 80 L58 50 L70 80 H46 Z" fill="${GLYPH_FILL}" />
      <path d="M58 44 L50 54 H66 Z" fill="${GLYPH_HIGHLIGHT}" />
    `;
  }

  if (spec.word === "roost") {
    return `
      <path d="M28 80 C34 62, 44 50, 56 32" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
      <path d="M46 58 C52 52, 62 52, 68 58" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
      <path d="M50 62 C54 58, 60 58, 64 62" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
    `;
  }

  const canopy = spec.word === "jungle" ? 12 : 9;
  return `
    <path d="M32 80 V58 C32 48, 40 42, 50 42 C60 42, 68 48, 68 58 V80" fill="${GLYPH_FILL}" />
    <path d="M28 54 C34 ${54 - canopy}, 44 ${54 - canopy}, 50 54" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M50 54 C56 ${54 - canopy}, 66 ${54 - canopy}, 72 54" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
  `;
}

function renderGardenGlyph(hash, spec) {
  if (spec.word === "vineyard") {
    return `
      <path d="M30 80 V34 M50 80 V28 M70 80 V34" stroke="${GLYPH_FILL}" stroke-width="4" stroke-linecap="round" />
      <path d="M30 44 H70 M30 58 H70" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
      <circle cx="50" cy="38" r="5" fill="${GLYPH_HIGHLIGHT}" />
    `;
  }

  if (spec.word === "orchard") {
    return `
      <path d="M36 80 V54 M64 80 V54" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
      <circle cx="36" cy="46" r="12" fill="${GLYPH_FILL}" />
      <circle cx="64" cy="46" r="12" fill="${GLYPH_FILL}" />
      <circle cx="64" cy="46" r="4" fill="${GLYPH_HIGHLIGHT}" />
    `;
  }

  return `
    <path d="M24 80 C28 58, 38 44, 50 36 C62 44, 72 58, 76 80" fill="${GLYPH_FILL}" />
    <path d="M34 62 C42 54, 58 54, 66 62" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
  `;
}

function renderFieldGlyph(hash, spec) {
  if (spec.word === "dunes" || spec.word === "desert") {
    return `
      <path d="M14 74 C26 50, 42 50, 54 74 S82 90, 86 62" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
      <path d="M18 58 C32 42, 44 42, 56 58 S78 74, 82 50" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    `;
  }

  const bands = spec.word === "mounds" ? [62, 72] : [56, 68];
  return `
    <path d="M16 ${bands[0]} C28 ${bands[0] - 10}, 42 ${bands[0] - 10}, 54 ${bands[0]} S80 ${bands[0] + 8}, 84 ${bands[0]}" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <path d="M20 ${bands[1]} C34 ${bands[1] - 8}, 48 ${bands[1] - 8}, 60 ${bands[1]} S78 ${bands[1] + 6}, 82 ${bands[1]}" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
  `;
}

function renderFarmGlyph(hash, spec) {
  const silo = spec.word === "farm" || spec.word === "farmstead" ? `<rect x="62" y="44" width="12" height="36" rx="4" fill="${GLYPH_FILL}" />` : "";
  const accent = spec.word === "dairy" ? emblemAt("milk", 50, 56, 0.95) : "";
  return `
    <path d="M20 80 V46 L36 34 H56 L72 46 V80 H20 Z" fill="${GLYPH_FILL}" />
    ${silo}
    ${accent}
    <path d="M28 80 V62 H42 V80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
  `;
}

function renderPeakGlyph(hash, spec) {
  if (["hills", "foothills", "knoll"].includes(spec.word)) {
    return `
      <path d="M18 74 C30 56, 42 56, 54 74" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
      <path d="M42 74 C52 52, 64 52, 82 74" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
      <path d="M26 66 C34 60, 42 60, 48 66" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    `;
  }

  if (spec.word === "ridge" || spec.word === "crest" || spec.word === "heights") {
    return `
      <path d="M16 74 L34 54 L48 62 L66 36 L84 74 Z" fill="${GLYPH_FILL}" />
      <path d="M32 58 L36 54 L40 58" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    `;
  }

  return `
    <path d="M16 74 L40 34 L56 58 L68 42 L84 74 Z" fill="${GLYPH_FILL}" />
    <path d="M36 42 L40 34 L45 44" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
  `;
}

function renderCanyonGlyph(hash, spec) {
  if (spec.word === "valley" || spec.word === "hollow") {
    return `
      <path d="M20 24 C24 44, 28 62, 34 80" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
      <path d="M80 24 C76 44, 72 62, 66 80" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
      <path d="M40 80 C46 64, 54 64, 60 80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.6" stroke-linecap="round" />
    `;
  }

  return `
    <path d="M22 24 C30 44, 34 60, 38 80" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <path d="M78 24 C70 44, 66 60, 62 80" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <path d="M46 80 C50 68, 52 60, 54 50" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.6" stroke-linecap="round" />
  `;
}

function renderStoneGlyph(hash, spec) {
  if (spec.word === "arches") {
    return `
      <path d="M18 80 V52 C18 34, 42 34, 42 52 V80" fill="${GLYPH_FILL}" />
      <path d="M58 80 V52 C58 34, 82 34, 82 52 V80" fill="${GLYPH_FILL}" />
    `;
  }

  if (spec.word === "wall" || spec.word === "palisade") {
    return `
      <path d="M18 80 V40 H82 V80" fill="${GLYPH_FILL}" />
      <path d="M24 40 V32 M36 40 V32 M48 40 V32 M60 40 V32 M72 40 V32" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    `;
  }

  return `
    <path d="M20 80 L18 56 L34 34 L58 28 L80 44 L82 70 L68 80 H20 Z" fill="${GLYPH_FILL}" />
    <path d="M34 44 L50 58 L64 44" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" />
  `;
}

function renderCaveGlyph(hash, spec) {
  if (spec.word === "crater") {
    return `
      <ellipse cx="50" cy="56" rx="24" ry="18" fill="${GLYPH_FILL}" />
      <ellipse cx="50" cy="56" rx="10" ry="6" fill="${FRAME_FILL}" />
      <path d="M32 46 C38 38, 46 36, 54 38" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    `;
  }

  return `
    <path d="M18 80 C22 54, 34 38, 50 38 C66 38, 78 54, 82 80 H18 Z" fill="${GLYPH_FILL}" />
    <path d="M40 80 V62 C40 54, 60 54, 60 62 V80" fill="${FRAME_FILL}" />
    ${spec.word === "grotto" ? `<path d="M32 50 C40 46, 60 46, 68 50" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />` : ""}
  `;
}

function renderSanctuaryGlyph(hash, spec) {
  if (spec.word === "pyramid") {
    return `
      <path d="M16 80 L50 24 L84 80 H16 Z" fill="${GLYPH_FILL}" />
      <path d="M28 62 H72 M34 50 H66" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    `;
  }

  if (spec.word === "pagoda") {
    return `
      <path d="M28 34 L50 24 L72 34 L66 40 H34 Z" fill="${GLYPH_FILL}" />
      <path d="M34 50 L50 42 L66 50 L62 56 H38 Z" fill="${GLYPH_FILL}" />
      <path d="M40 64 L50 58 L60 64 L58 80 H42 Z" fill="${GLYPH_FILL}" />
      <path d="M34 80 H66" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    `;
  }

  if (spec.word === "church" || spec.word === "abbey") {
    return `
      <path d="M22 80 V42 H44 V28 H56 V42 H78 V80 H22 Z" fill="${GLYPH_FILL}" />
      <path d="M50 28 V20" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.6" stroke-linecap="round" />
      <path d="M46 24 H54" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
    `;
  }

  if (spec.word === "temple") {
    return `
      <path d="M20 42 L50 26 L80 42" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M24 80 V46 H76 V80" fill="${GLYPH_FILL}" />
      <path d="M34 48 V80 M50 48 V80 M66 48 V80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
    `;
  }

  if (spec.word === "palace") {
    return `
      <path d="M18 80 V42 H32 V32 H44 V42 H56 V32 H68 V42 H82 V80 H18 Z" fill="${GLYPH_FILL}" />
      <path d="M32 32 H68" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    `;
  }

  if (spec.word === "fort" || spec.word === "fortress" || spec.word === "castle") {
    return `
      <path d="M18 80 V38 H32 V28 H44 V38 H56 V28 H68 V38 H82 V80 H18 Z" fill="${GLYPH_FILL}" />
      <path d="M24 54 H76" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    `;
  }

  return `
    <path d="M20 80 V48 C20 34, 80 34, 80 48 V80" fill="${GLYPH_FILL}" />
    <path d="M34 80 V58 H66 V80" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderTowerGlyph(hash, spec) {
  if (spec.word === "lighthouse") {
    return `
      <path d="M40 80 L46 28 H54 L60 80 H40 Z" fill="${GLYPH_FILL}" />
      <path d="M36 30 H64" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
      <path d="M26 40 H36 M64 40 H74" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
    `;
  }

  if (spec.word === "obelisk") {
    return `
      <path d="M44 80 L50 24 L56 80 H44 Z" fill="${GLYPH_FILL}" />
      <path d="M40 80 H60" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    `;
  }

  if (spec.word === "dome") {
    return `
      <path d="M22 80 V54 C22 36, 78 36, 78 54 V80 H22 Z" fill="${GLYPH_FILL}" />
      <path d="M50 28 V38" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    `;
  }

  if (spec.word === "pavilion") {
    return `
      <path d="M20 44 L50 28 L80 44" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M24 80 V48 H76 V80" fill="${GLYPH_FILL}" />
      <path d="M34 48 V80 M50 48 V80 M66 48 V80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
    `;
  }

  return `
    <rect x="40" y="24" width="20" height="50" rx="4" fill="${GLYPH_FILL}" />
    <path d="M32 28 L50 16 L68 28 Z" fill="${GLYPH_FILL}" />
    <rect x="42" y="76" width="16" height="6" rx="2" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderSportsGlyph(hash, spec) {
  if (spec.word === "fairway" || spec.word === "greens") {
    return `
      <path d="M20 80 C28 54, 44 46, 62 44 C70 44, 76 46, 82 52" fill="${GLYPH_FILL}" />
      <path d="M58 30 V58" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.6" stroke-linecap="round" />
      <path d="M60 30 H72 L66 38 H60 Z" fill="${GLYPH_HIGHLIGHT}" />
    `;
  }

  if (spec.word === "track" || spec.word === "raceway") {
    return `
      <path d="M28 42 C18 52, 18 70, 30 78 H68 C80 70, 80 52, 70 42 H28 Z" fill="${GLYPH_FILL}" />
      <path d="M40 52 H60" stroke="${FRAME_FILL}" stroke-width="4" stroke-linecap="round" stroke-dasharray="8 6" />
    `;
  }

  if (spec.word === "stadium") {
    return `
      <path d="M18 66 C18 48, 82 48, 82 66 V80 H18 Z" fill="${GLYPH_FILL}" />
      <path d="M26 58 H74" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
      <path d="M34 66 H66" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    `;
  }

  if (spec.word === "games") {
    return `
      <circle cx="40" cy="52" r="10" fill="${GLYPH_FILL}" />
      <circle cx="60" cy="52" r="10" fill="${GLYPH_FILL}" />
      <path d="M50 42 L50 62" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    `;
  }

  return `
    <path d="M22 80 C28 54, 44 46, 62 44 C70 44, 76 46, 82 52" fill="${GLYPH_FILL}" />
    <path d="M42 66 C48 60, 56 60, 62 66" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderFestivalGlyph() {
  return `
    <path d="M20 80 V48 L36 34 L50 48 L64 34 L80 48 V80 H20 Z" fill="${GLYPH_FILL}" />
    <path d="M28 34 H72" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    <path d="M36 28 L44 22 L52 28 L60 22 L68 28" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" />
  `;
}

function renderLookoutGlyph(hash, spec) {
  if (spec.variant === "place") {
    return `
      <path d="M50 20 C38 20, 30 28, 30 40 C30 52, 42 64, 50 78 C58 64, 70 52, 70 40 C70 28, 62 20, 50 20 Z" fill="${GLYPH_FILL}" />
      <circle cx="50" cy="40" r="8" fill="${GLYPH_HIGHLIGHT}" />
    `;
  }

  return `
    <circle cx="50" cy="34" r="10" fill="${GLYPH_HIGHLIGHT}" />
    <path d="M18 80 L38 50 H62 L82 80 H18 Z" fill="${GLYPH_FILL}" />
    <path d="M34 80 C42 74, 50 70, 60 70 C68 70, 76 74, 84 80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
  `;
}

function renderGridGlyph(hash, spec) {
  if (spec.word === "subway") {
    return `
      <path d="M22 80 V48 C22 34, 78 34, 78 48 V80" fill="${GLYPH_FILL}" />
      <path d="M36 80 V62 C36 54, 64 54, 64 62 V80" fill="${FRAME_FILL}" />
      <path d="M40 44 H60" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    `;
  }

  const cols = spec.word === "metro" ? 4 : 3;
  const rows = spec.word === "metro" ? 4 : 3;
  const blocks = [];
  const cellWidth = 48 / cols;
  const cellHeight = 48 / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const x = 26 + column * cellWidth;
      const y = 24 + row * cellHeight;
      blocks.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cellWidth - 4).toFixed(1)}" height="${(cellHeight - 4).toFixed(1)}" rx="2" fill="${column === row ? GLYPH_HIGHLIGHT : GLYPH_FILL}" />`);
    }
  }
  return blocks.join("");
}

function renderGalacticGlyph(hash) {
  const orbit = rangeValue(hash, 1, 20, 28);
  return `
    <circle cx="50" cy="50" r="8" fill="${GLYPH_FILL}" />
    <ellipse cx="50" cy="50" rx="${orbit}" ry="10" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" />
    <ellipse cx="50" cy="50" rx="10" ry="${orbit}" stroke="${GLYPH_HIGHLIGHT}" stroke-width="2.8" transform="rotate(30 50 50)" />
    <circle cx="${50 + orbit}" cy="50" r="4" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderDownunderGlyph() {
  return `
    <circle cx="50" cy="44" r="18" stroke="${GLYPH_FILL}" stroke-width="5" />
    <path d="M50 38 V62" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M42 54 L50 62 L58 54" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M34 44 H66" stroke="${GLYPH_FILL}" stroke-width="3" stroke-linecap="round" opacity="0.85" />
  `;
}

function renderLockerGlyph(hash) {
  const vents = Array.from({ length: 3 }, (_, index) => 44 + index * 8)
    .map((y) => `<path d="M44 ${y} H56" stroke="${GLYPH_HIGHLIGHT}" stroke-width="2.8" stroke-linecap="round" />`)
    .join("");
  return `
    <rect x="34" y="22" width="32" height="58" rx="4" fill="${GLYPH_FILL}" />
    ${vents}
    <circle cx="58" cy="58" r="2.5" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderWellGlyph(hash, spec) {
  if (spec.word === "fountain" || spec.word === "springs") {
    return `
      <path d="M30 72 H70 L64 80 H36 Z" fill="${GLYPH_FILL}" />
      <path d="M50 34 V68" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
      <path d="M50 34 C44 44, 44 48, 50 56 C56 48, 56 44, 50 34 Z" fill="${GLYPH_HIGHLIGHT}" />
    `;
  }

  if (spec.word === "baths") {
    return `
      <path d="M24 62 H76 V72 C76 77, 72 80, 67 80 H33 C28 80, 24 77, 24 72 Z" fill="${GLYPH_FILL}" />
      <path d="M34 48 C34 42, 40 42, 40 36 M50 48 C50 42, 56 42, 56 36 M62 48 C62 42, 68 42, 68 36" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
    `;
  }

  return `
    <path d="M26 80 V52 C26 38, 74 38, 74 52 V80" fill="${GLYPH_FILL}" />
    <path d="M34 52 H66" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M50 38 V24" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
  `;
}

function renderSpurHintGlyph() {
  return `
    <path d="M28 64 C28 48, 38 40, 54 40 H64 V50 H56 V62 C56 70, 50 76, 42 76 H32 Z" fill="${GLYPH_FILL}" />
    <path d="M56 60 H72" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <circle cx="76" cy="60" r="6" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" />
    <path d="M30 76 H44" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
  `;
}

function renderViewHintGlyph() {
  return `
    <circle cx="38" cy="54" r="14" fill="${GLYPH_FILL}" />
    <circle cx="62" cy="54" r="14" fill="${GLYPH_FILL}" />
    <path d="M46 48 H54 V60 H46 Z" fill="${GLYPH_HIGHLIGHT}" />
    <path d="M26 54 H18 M82 54 H74" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
  `;
}

function renderKitchenHintGlyph() {
  return `
    <rect x="24" y="38" width="52" height="34" rx="4" fill="${GLYPH_FILL}" />
    <rect x="34" y="48" width="32" height="16" rx="3" fill="${FRAME_FILL}" />
    <circle cx="34" cy="44" r="2.8" fill="${GLYPH_HIGHLIGHT}" />
    <circle cx="42" cy="44" r="2.8" fill="${GLYPH_HIGHLIGHT}" />
    <path d="M42 34 C40 28, 40 24, 42 20 M50 34 C48 28, 48 24, 50 20 M58 34 C56 28, 56 24, 58 20" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderRoadHintGlyph() {
  return `
    <path d="M18 66 H82" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <rect x="34" y="48" width="24" height="12" rx="5" fill="${GLYPH_FILL}" />
    <path d="M40 48 L46 42 H56 L60 48 Z" fill="${GLYPH_FILL}" />
    <circle cx="40" cy="62" r="4" fill="${GLYPH_HIGHLIGHT}" />
    <circle cx="58" cy="62" r="4" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderLighthouseHintGlyph() {
  return `
    <path d="M40 80 L46 30 H54 L60 80 H40 Z" fill="${GLYPH_FILL}" />
    <rect x="38" y="24" width="24" height="10" rx="4" fill="${GLYPH_HIGHLIGHT}" />
    <path d="M32 28 H18 M82 28 H68" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    <path d="M40 80 H60" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
  `;
}

function renderAustraliaHintGlyph() {
  return `
    <path d="M34 36 L44 28 L56 30 L66 38 L74 52 L68 68 L54 74 L42 70 L32 60 L26 48 Z" fill="${GLYPH_FILL}" />
    <circle cx="64" cy="70" r="4" fill="${GLYPH_HIGHLIGHT}" />
    <path d="M42 48 L48 42 L56 46 L58 54 L50 60 L42 56 Z" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderStripHintGlyph() {
  return `
    <path d="M18 58 H82" stroke="${GLYPH_FILL}" stroke-width="5.2" stroke-linecap="round" />
    <path d="M20 44 H68 C78 44, 80 34, 74 28" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
  `;
}

function renderGorgeHintGlyph() {
  return `
    <path d="M28 24 V80" stroke="${GLYPH_FILL}" stroke-width="8" stroke-linecap="round" />
    <path d="M72 24 V80" stroke="${GLYPH_FILL}" stroke-width="8" stroke-linecap="round" />
    <path d="M32 34 H68" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4.4" stroke-linecap="round" />
  `;
}

function renderBoulevardHintGlyph() {
  return `
    <path d="M50 22 V78" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    <rect x="40" y="28" width="20" height="30" rx="4" fill="${GLYPH_FILL}" />
    <circle cx="50" cy="36" r="4" fill="${GLYPH_HIGHLIGHT}" />
    <circle cx="50" cy="44" r="4" fill="${GLYPH_HIGHLIGHT}" opacity="0.8" />
    <circle cx="50" cy="52" r="4" fill="${GLYPH_HIGHLIGHT}" opacity="0.6" />
  `;
}

function renderWoodsHintGlyph() {
  return renderPineGroupGlyph(2);
}

function renderTowerHintGlyph() {
  return `
    <path d="M38 80 V36 C38 28, 62 28, 62 36 V80" fill="${GLYPH_FILL}" />
    <path d="M34 36 L50 18 L66 36 Z" fill="${GLYPH_FILL}" />
    <rect x="44" y="46" width="12" height="16" rx="4" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderLoopHintGlyph() {
  return `<path d="M56 24 C38 24, 30 36, 30 52 C30 66, 40 76, 52 76 C62 76, 70 68, 70 58 C70 50, 64 44, 58 44 C52 44, 48 48, 48 54 V82" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />`;
}

function renderTrailsHintGlyph() {
  return `
    <path d="M18 80 L40 44 L54 62 L70 34 L82 80 Z" fill="${GLYPH_FILL}" />
    <path d="M36 74 C38 64, 42 58, 48 52 C52 48, 58 42, 62 34" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderLibraryHintGlyph() {
  return `
    <rect x="24" y="26" width="12" height="48" rx="2" fill="${GLYPH_FILL}" />
    <rect x="40" y="22" width="12" height="52" rx="2" fill="${GLYPH_FILL}" />
    <rect x="56" y="28" width="12" height="46" rx="2" fill="${GLYPH_FILL}" />
    <path d="M30 34 V66 M46 30 V66 M62 36 V66" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
  `;
}

function renderVineyardHintGlyph() {
  return `
    <circle cx="44" cy="42" r="5" fill="${GLYPH_FILL}" />
    <circle cx="52" cy="42" r="5" fill="${GLYPH_FILL}" />
    <circle cx="48" cy="50" r="5" fill="${GLYPH_FILL}" />
    <circle cx="40" cy="50" r="5" fill="${GLYPH_FILL}" />
    <circle cx="56" cy="50" r="5" fill="${GLYPH_FILL}" />
    <circle cx="44" cy="58" r="5" fill="${GLYPH_FILL}" />
    <circle cx="52" cy="58" r="5" fill="${GLYPH_FILL}" />
    <path d="M50 30 C56 24, 62 24, 66 30" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderGladeHintGlyph() {
  return Array.from({ length: 9 }, (_, index) => {
    const x = 22 + index * 7;
    const height = index % 2 === 0 ? 34 : 26;
    return `<path d="M${x} 80 V${80 - height}" stroke="${GLYPH_FILL}" stroke-width="3.2" stroke-linecap="round" />`;
  }).join("");
}

function renderCraterHintGlyph() {
  return `
    <path d="M18 66 C24 54, 30 54, 36 66 C42 54, 48 54, 54 66 C60 54, 66 54, 72 66 C76 72, 80 74, 82 72" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M26 66 H74" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
  `;
}

function renderColonyHintGlyph() {
  return `<polygon points="50 22, 72 34, 72 58, 50 70, 28 58, 28 34" fill="${GLYPH_FILL}" /><polygon points="50 34, 60 40, 60 52, 50 58, 40 52, 40 40" fill="${GLYPH_HIGHLIGHT}" />`;
}

function renderForestHintGlyph() {
  return renderPineGroupGlyph(3);
}

function renderAlleyHintGlyph() {
  return `
    <rect x="24" y="24" width="18" height="56" rx="3" fill="${GLYPH_FILL}" />
    <rect x="58" y="24" width="18" height="56" rx="3" fill="${GLYPH_FILL}" />
    <path d="M50 28 V76" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" stroke-dasharray="8 8" />
  `;
}

function renderBoroughHintGlyph() {
  return `
    <path d="M18 74 C28 50, 40 42, 54 42 C68 42, 78 52, 82 74" fill="${GLYPH_FILL}" />
    <ellipse cx="50" cy="62" rx="9" ry="7" fill="${FRAME_FILL}" />
  `;
}

function renderPuebloHintGlyph() {
  return `
    <rect x="20" y="50" width="24" height="24" rx="2" fill="${GLYPH_FILL}" />
    <rect x="42" y="40" width="24" height="34" rx="2" fill="${GLYPH_FILL}" />
    <rect x="58" y="52" width="20" height="22" rx="2" fill="${GLYPH_FILL}" />
    <rect x="28" y="58" width="4" height="4" rx="1" fill="${GLYPH_HIGHLIGHT}" />
    <rect x="50" y="48" width="4" height="4" rx="1" fill="${GLYPH_HIGHLIGHT}" />
    <rect x="64" y="60" width="4" height="4" rx="1" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderCinemaHintGlyph() {
  return `
    <rect x="30" y="46" width="30" height="18" rx="3" fill="${GLYPH_FILL}" />
    <circle cx="34" cy="38" r="7" fill="${GLYPH_FILL}" />
    <circle cx="50" cy="36" r="7" fill="${GLYPH_FILL}" />
    <path d="M60 50 L72 44 V66 L60 60 Z" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderPeninsulaHintGlyph() {
  return `
    <path d="M40 20 L58 24 L64 34 L60 44 L62 58 L56 76 L48 80 L44 70 L46 58 L42 46 L34 38 L34 28 Z" fill="${GLYPH_FILL}" />
    <path d="M34 48 C26 50, 22 58, 24 68" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderPlateauHintGlyph() {
  return `<path d="M16 80 L34 48 H66 L84 80 Z" fill="${GLYPH_FILL}" /><path d="M34 48 H66" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />`;
}

function renderCapeHintGlyph() {
  return `
    <path d="M18 52 C30 44, 40 44, 52 52" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M16 68 C28 60, 38 60, 50 68" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M50 78 C56 60, 64 52, 78 50 C74 64, 70 72, 66 78 Z" fill="${GLYPH_FILL}" />
  `;
}

function renderPortHintGlyph() {
  return `
    <path d="M20 74 H82" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M26 64 H62 L56 74 H34 Z" fill="${GLYPH_FILL}" />
    <rect x="32" y="50" width="16" height="14" rx="2" fill="${GLYPH_FILL}" />
    <path d="M48 50 V42 H56" stroke="${GLYPH_FILL}" stroke-width="3.2" stroke-linecap="round" />
    <path d="M34 40 C34 34, 40 34, 40 28 M42 38 C42 32, 48 32, 48 26" stroke="${GLYPH_HIGHLIGHT}" stroke-width="2.8" stroke-linecap="round" />
  `;
}

function renderMotorwayHintGlyph() {
  return `
    <path d="M16 68 H84" stroke="${GLYPH_FILL}" stroke-width="5.2" stroke-linecap="round" />
    <path d="M28 58 H60 L68 54 L74 56 L70 62 H30 Z" fill="${GLYPH_FILL}" />
    <path d="M44 58 L50 50 H58" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
    <circle cx="38" cy="66" r="4" fill="${GLYPH_HIGHLIGHT}" />
    <circle cx="62" cy="66" r="4" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderDockHintGlyph() {
  return `
    <circle cx="50" cy="54" r="18" stroke="${GLYPH_FILL}" stroke-width="4.6" />
    <circle cx="50" cy="54" r="5" fill="${GLYPH_HIGHLIGHT}" />
    <path d="M50 36 V72 M32 54 H68 M38 42 L62 66 M62 42 L38 66" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
  `;
}

function renderHighlandsHintGlyph() {
  return `
    <path d="M38 76 V40 C38 34, 44 30, 50 30 C56 30, 62 34, 62 40 V76" fill="${GLYPH_FILL}" />
    <path d="M62 40 H70 V76" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    <path d="M70 46 H76 M70 56 H76 M70 66 H76" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
    <path d="M38 44 C30 42, 26 50, 30 58 C34 66, 38 68, 42 70" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderVillageHintGlyph() {
  return `
    <path d="M18 78 V56 L30 46 L42 56 V78 H18 Z" fill="${GLYPH_FILL}" />
    <path d="M40 78 V50 L52 40 L64 50 V78 H40 Z" fill="${GLYPH_FILL}" />
    <path d="M62 78 V58 L72 50 L82 58 V78 H62 Z" fill="${GLYPH_FILL}" />
  `;
}

function renderTerraceHintGlyph() {
  return `<path d="M18 80 H34 V68 H50 V56 H66 V44 H82" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />`;
}

function renderKeysHintGlyph() {
  return `
    <circle cx="38" cy="48" r="10" stroke="${GLYPH_FILL}" stroke-width="5" />
    <path d="M48 48 H74 V56 H66 V62 H60 V56 H54 V62 H48 Z" fill="${GLYPH_FILL}" />
  `;
}

function renderPoolHintGlyph() {
  return `<path d="M28 58 C28 40, 44 34, 58 38 C70 42, 72 54, 64 64 C56 74, 38 76, 30 68 C26 64, 26 62, 28 58 Z" fill="${GLYPH_FILL}" /><path d="M36 58 C40 54, 48 54, 54 58" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />`;
}

function renderPlainsHintGlyph() {
  return `
    <path d="M24 70 C30 58, 40 54, 50 54 C62 54, 70 60, 76 70" fill="${GLYPH_FILL}" />
    <path d="M34 62 L42 56 L52 58 L62 56 L70 62" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M32 70 V76 M46 70 V78 M62 70 V78" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
  `;
}

function renderBarHintGlyph() {
  return `<path d="M42 24 H58 V36 L62 46 V74 C62 78, 58 82, 54 82 H46 C42 82, 38 78, 38 74 V46 L42 36 Z" fill="${GLYPH_FILL}" /><path d="M42 36 H58" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />`;
}

function renderStationHintGlyph() {
  return `
    <rect x="24" y="46" width="34" height="18" rx="4" fill="${GLYPH_FILL}" />
    <rect x="52" y="52" width="18" height="12" rx="3" fill="${GLYPH_FILL}" />
    <path d="M58 46 V38 H68" stroke="${GLYPH_FILL}" stroke-width="3.2" stroke-linecap="round" />
    <circle cx="36" cy="68" r="4" fill="${GLYPH_HIGHLIGHT}" />
    <circle cx="58" cy="68" r="4" fill="${GLYPH_HIGHLIGHT}" />
    <path d="M20 76 H72" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderGroveHintGlyph() {
  return renderCircleGridGlyph(3, 3, 5);
}

function renderCircleHintGlyph() {
  return `<circle cx="50" cy="52" r="22" stroke="${GLYPH_FILL}" stroke-width="6" />`;
}

function renderCourtHintGlyph() {
  return `
    <path d="M34 40 H58 V50 H34 Z" fill="${GLYPH_FILL}" />
    <path d="M54 46 L70 62" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    <path d="M28 72 H72" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
  `;
}

function renderReefHintGlyph() {
  return `
    <circle cx="42" cy="48" r="8" stroke="${GLYPH_FILL}" stroke-width="4" />
    <path d="M50 48 H66" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    <path d="M56 54 L66 66 M54 52 L48 66 M62 52 L70 62" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
  `;
}

function renderReservoirHintGlyph() {
  return `
    <path d="M18 74 L36 46 H60 L76 74 Z" fill="${GLYPH_FILL}" />
    <path d="M60 46 C68 52, 74 58, 80 66" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.6" stroke-linecap="round" />
    <path d="M60 54 C68 58, 72 62, 78 70" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
  `;
}

function renderBayouHintGlyph() {
  return `
    <path d="M24 56 L34 46 H54 L70 52 L76 60 L66 66 H54 L48 74 H34 L28 66 H22 Z" fill="${GLYPH_FILL}" />
    <circle cx="68" cy="56" r="2.6" fill="${GLYPH_HIGHLIGHT}" />
    <path d="M28 56 L20 50 M28 62 L20 66 M44 46 V38 M52 74 V82" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
  `;
}

function renderOasisHintGlyph() {
  return `
    <path d="M50 80 C46 62, 46 48, 50 32" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <path d="M50 38 C34 28, 30 22, 42 22" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M50 38 C50 24, 66 20, 70 28" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M50 48 C38 42, 34 36, 42 34" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.6" stroke-linecap="round" />
  `;
}

function renderMarinaHintGlyph() {
  return `
    <path d="M50 20 V62" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    <path d="M34 38 H66" stroke="${GLYPH_FILL}" stroke-width="4" stroke-linecap="round" />
    <path d="M34 38 C34 56, 40 68, 50 76 C60 68, 66 56, 66 38" fill="none" stroke="${GLYPH_FILL}" stroke-width="4" stroke-linecap="round" />
    <path d="M38 80 H62" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
  `;
}

function renderMesaHintGlyph() {
  return `<path d="M12 80 L28 52 H72 L88 80 Z" fill="${GLYPH_FILL}" /><path d="M28 52 H72" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />`;
}

function renderSpringsHintGlyph() {
  return `
    <path d="M50 72 C40 56, 36 44, 34 30 M50 72 C46 54, 48 42, 50 24 M50 72 C54 54, 56 42, 66 30" stroke="${GLYPH_FILL}" stroke-width="4.2" stroke-linecap="round" />
    <path d="M50 72 C58 56, 64 48, 74 40" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
  `;
}

function renderAcresHintGlyph() {
  return `
    <path d="M18 74 H82" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    <path d="M30 74 V52" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M30 58 C22 50, 22 42, 30 44 M30 58 C38 50, 38 42, 30 44" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderPalaceHintGlyph() {
  return `
    <path d="M34 72 H66 L60 80 H40 Z" fill="${GLYPH_FILL}" />
    <path d="M40 62 H60 L56 68 H44 Z" fill="${GLYPH_FILL}" />
    <path d="M46 50 H54 L52 56 H48 Z" fill="${GLYPH_FILL}" />
    <path d="M50 28 V48" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    <path d="M34 72 C40 68, 60 68, 66 72" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
  `;
}

function renderChurchHintGlyph() {
  return `
    <path d="M22 80 V42 H44 V28 H56 V42 H78 V80 H22 Z" fill="${GLYPH_FILL}" />
    <path d="M50 28 V20" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    <path d="M46 24 H54" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
    <path d="M44 62 Q50 50 56 62 V74 H44 Z" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderLaneHintGlyph() {
  return `
    <path d="M46 24 V78" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    <path d="M46 34 H68" stroke="${GLYPH_FILL}" stroke-width="4" stroke-linecap="round" />
    <path d="M64 34 V52" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
  `;
}

function renderShoalHintGlyph() {
  return `
    <path d="M18 60 C32 52, 44 52, 58 60 S80 68, 84 64" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    <path d="M20 72 C34 64, 48 64, 60 72 S78 80, 82 76" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    <circle cx="42" cy="58" r="4" fill="${GLYPH_FILL}" />
    <circle cx="60" cy="68" r="4" fill="${GLYPH_FILL}" />
  `;
}

function renderShallowsHintGlyph() {
  return `<path d="M24 48 C24 66, 38 76, 50 76 C62 76, 76 66, 76 48" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />`;
}

function renderFortressHintGlyph() {
  return `
    <path d="M18 80 V40 H30 V30 H42 V40 H58 V30 H70 V40 H82 V80 H18 Z" fill="${GLYPH_FILL}" />
    <path d="M30 40 H70" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
    <path d="M44 80 V58 H56 V80" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderArcadeHintGlyph() {
  return `
    <circle cx="38" cy="56" r="10" fill="${GLYPH_FILL}" />
    <circle cx="34" cy="54" r="2.4" fill="${GLYPH_HIGHLIGHT}" />
    <circle cx="42" cy="50" r="2.4" fill="${GLYPH_HIGHLIGHT}" />
    <circle cx="42" cy="60" r="2.4" fill="${GLYPH_HIGHLIGHT}" />
    <path d="M66 38 C72 48, 72 64, 66 74 C58 74, 54 68, 54 62 C54 56, 58 52, 62 50 C58 46, 58 42, 66 38 Z" fill="${GLYPH_FILL}" />
  `;
}

function renderCausewayHintGlyph() {
  return `
    <path d="M18 52 H82" stroke="${GLYPH_FILL}" stroke-width="5.2" stroke-linecap="round" />
    <path d="M28 52 V80 M42 52 V80 M58 52 V80 M72 52 V80" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3.4" stroke-linecap="round" />
  `;
}

function renderBluffsHintGlyph() {
  return `
    <path d="M16 80 L34 50 H68 L84 80 Z" fill="${GLYPH_FILL}" />
    <path d="M34 50 H68" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <circle cx="42" cy="46" r="3" fill="${GLYPH_HIGHLIGHT}" />
    <circle cx="52" cy="44" r="3" fill="${GLYPH_HIGHLIGHT}" />
    <circle cx="62" cy="46" r="3" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderGetawayHintGlyph() {
  return `
    <path d="M20 80 V58 C20 40, 80 40, 80 58 V80 H20 Z" fill="${GLYPH_FILL}" />
    <path d="M34 80 V58 C34 50, 66 50, 66 58 V80" fill="${FRAME_FILL}" />
    <path d="M28 52 H72" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
  `;
}

function renderWalkwayHintGlyph() {
  return `
    <path d="M18 72 H82" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    <circle cx="42" cy="40" r="4" fill="${GLYPH_HIGHLIGHT}" />
    <path d="M42 44 V56 M42 50 L34 58 M42 50 L50 56 M42 56 L36 68 M42 56 L50 68" stroke="${GLYPH_FILL}" stroke-width="3.2" stroke-linecap="round" />
  `;
}

function renderRetreatHintGlyph() {
  return `
    <path d="M40 24 V80" stroke="${GLYPH_FILL}" stroke-width="5" stroke-linecap="round" />
    <path d="M42 28 H72 L60 44 H42 Z" fill="${GLYPH_HIGHLIGHT}" />
  `;
}

function renderDunesHintGlyph() {
  return `
    <circle cx="68" cy="28" r="8" fill="${GLYPH_HIGHLIGHT}" />
    <path d="M16 72 C30 56, 44 56, 58 72 S80 88, 84 72" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <path d="M18 58 C34 44, 48 44, 62 58 S80 72, 84 58" fill="none" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
    <path d="M68 12 V4 M76 20 H84 M74 14 L80 8" stroke="${GLYPH_HIGHLIGHT}" stroke-width="2.8" stroke-linecap="round" />
  `;
}

function renderDeltaHintGlyph() {
  return `<path d="M50 24 L72 76 H28 Z" fill="none" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />`;
}

function renderSquareHintGlyph() {
  return `<rect x="30" y="32" width="40" height="40" rx="2" stroke="${GLYPH_FILL}" stroke-width="6" />`;
}

function renderDesertHintGlyph() {
  return `
    <path d="M42 80 V28" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <path d="M58 80 V40" stroke="${GLYPH_FILL}" stroke-width="6" stroke-linecap="round" />
    <path d="M42 42 H28 M42 56 H52 M58 50 H72" stroke="${GLYPH_HIGHLIGHT}" stroke-width="4" stroke-linecap="round" />
  `;
}

function renderPineGroupGlyph(count) {
  const startX = count === 2 ? 36 : 28;
  return Array.from({ length: count }, (_, index) => {
    const x = startX + index * 18;
    const baseY = 80;
    return `
      <path d="M${x - 8} ${baseY} L${x} ${baseY - 28} L${x + 8} ${baseY} Z" fill="${GLYPH_FILL}" />
      <path d="M${x - 10} ${baseY - 12} L${x} ${baseY - 40} L${x + 10} ${baseY - 12} Z" fill="${GLYPH_FILL}" />
      <path d="M${x} ${baseY - 6} V${baseY}" stroke="${GLYPH_HIGHLIGHT}" stroke-width="3" stroke-linecap="round" />
    `;
  }).join("");
}

function renderCircleGridGlyph(rows, columns, radius) {
  const circles = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      circles.push(`<circle cx="${36 + column * 14}" cy="${38 + row * 14}" r="${radius}" fill="${GLYPH_FILL}" />`);
    }
  }
  return circles.join("");
}
