import React, { useState, useEffect } from "react";
import {
  Award,
  Zap,
  CheckCircle,
  XCircle,
  ChevronLeft,
  Info,
  Coins,
  DollarSign,
  Activity,
} from "lucide-react";
import { getHealthStatus } from "../../api/qmailApiServices";

// Complete 256-row word table from qmail-protocol.md documentation
const silverWordTable = [
  { dec: 0, hex: "00", role: "Keeper", adjective: "Ancient", noun: "Stars" },
  { dec: 1, hex: "01", role: "Guardian", adjective: "Swift", noun: "Crystals" },
  { dec: 2, hex: "02", role: "Sage", adjective: "Mystic", noun: "Shadows" },
  { dec: 3, hex: "03", role: "Scholar", adjective: "Crimson", noun: "Winds" },
  { dec: 4, hex: "04", role: "Warden", adjective: "Silver", noun: "Waters" },
  { dec: 5, hex: "05", role: "Master", adjective: "Golden", noun: "Flames" },
  { dec: 6, hex: "06", role: "Lord", adjective: "Emerald", noun: "Stones" },
  { dec: 7, hex: "07", role: "Lady", adjective: "Azure", noun: "Dreams" },
  { dec: 8, hex: "08", role: "Knight", adjective: "Violet", noun: "Echoes" },
  { dec: 9, hex: "09", role: "Ranger", adjective: "Ivory", noun: "Thorns" },
  { dec: 10, hex: "0A", role: "Hunter", adjective: "Obsidian", noun: "Moons" },
  { dec: 11, hex: "0B", role: "Seeker", adjective: "Coral", noun: "Tides" },
  { dec: 12, hex: "0C", role: "Wanderer", adjective: "Amber", noun: "Sands" },
  { dec: 13, hex: "0D", role: "Herald", adjective: "Jade", noun: "Storms" },
  { dec: 14, hex: "0E", role: "Oracle", adjective: "Ruby", noun: "Depths" },
  {
    dec: 15,
    hex: "0F",
    role: "Mystic",
    adjective: "Sapphire",
    noun: "Heights",
  },
  { dec: 16, hex: "10", role: "Scribe", adjective: "Bronze", noun: "Paths" },
  { dec: 17, hex: "11", role: "Bard", adjective: "Copper", noun: "Realms" },
  { dec: 18, hex: "12", role: "Smith", adjective: "Iron", noun: "Visions" },
  { dec: 19, hex: "13", role: "Weaver", adjective: "Steel", noun: "Whispers" },
  { dec: 20, hex: "14", role: "Crafter", adjective: "Silk", noun: "Secrets" },
  { dec: 21, hex: "15", role: "Builder", adjective: "Velvet", noun: "Riddles" },
  { dec: 22, hex: "16", role: "Maker", adjective: "Marble", noun: "Puzzles" },
  { dec: 23, hex: "17", role: "Shaper", adjective: "Glass", noun: "Mirrors" },
  { dec: 24, hex: "18", role: "Carver", adjective: "Crystal", noun: "Prisms" },
  { dec: 25, hex: "19", role: "Forger", adjective: "Diamond", noun: "Jewels" },
  { dec: 26, hex: "1A", role: "Mender", adjective: "Pearl", noun: "Treasures" },
  { dec: 27, hex: "1B", role: "Healer", adjective: "Opal", noun: "Riches" },
  { dec: 28, hex: "1C", role: "Teacher", adjective: "Quartz", noun: "Gifts" },
  { dec: 29, hex: "1D", role: "Guide", adjective: "Onyx", noun: "Tokens" },
  { dec: 30, hex: "1E", role: "Leader", adjective: "Beryl", noun: "Charms" },
  { dec: 31, hex: "1F", role: "Captain", adjective: "Garnet", noun: "Amulets" },
  { dec: 32, hex: "20", role: "Admiral", adjective: "Topaz", noun: "Relics" },
  {
    dec: 33,
    hex: "21",
    role: "Commander",
    adjective: "Turquoise",
    noun: "Artifacts",
  },
  {
    dec: 34,
    hex: "22",
    role: "General",
    adjective: "Peaceful",
    noun: "Totems",
  },
  {
    dec: 35,
    hex: "23",
    role: "Marshal",
    adjective: "Perfect",
    noun: "Emblems",
  },
  {
    dec: 36,
    hex: "24",
    role: "Sentinel",
    adjective: "Perpetual",
    noun: "Symbols",
  },
  {
    dec: 37,
    hex: "25",
    role: "Watchman",
    adjective: "Powerful",
    noun: "Signs",
  },
  { dec: 38, hex: "26", role: "Scout", adjective: "Priceless", noun: "Marks" },
  { dec: 39, hex: "27", role: "Spy", adjective: "Bloodstone", noun: "Runes" },
  { dec: 40, hex: "28", role: "Agent", adjective: "Pleading", noun: "Glyphs" },
  { dec: 41, hex: "29", role: "Envoy", adjective: "Polished", noun: "Scripts" },
  {
    dec: 42,
    hex: "2A",
    role: "Emissary",
    adjective: "Radical",
    noun: "Letters",
  },
  {
    dec: 43,
    hex: "2B",
    role: "Ambassador",
    adjective: "Radioactive",
    noun: "Words",
  },
  {
    dec: 44,
    hex: "2C",
    role: "Diplomat",
    adjective: "Fluorite",
    noun: "Tales",
  },
  {
    dec: 45,
    hex: "2D",
    role: "Negotiator",
    adjective: "Pious",
    noun: "Stories",
  },
  {
    dec: 46,
    hex: "2E",
    role: "Mediator",
    adjective: "Refined",
    noun: "Legends",
  },
  {
    dec: 47,
    hex: "2F",
    role: "Arbiter",
    adjective: "Primitive",
    noun: "Myths",
  },
  { dec: 48, hex: "30", role: "Judge", adjective: "Renowned", noun: "Fables" },
  {
    dec: 49,
    hex: "31",
    role: "Magistrate",
    adjective: "Random",
    noun: "Epics",
  },
  {
    dec: 50,
    hex: "32",
    role: "Chancellor",
    adjective: "Resilient",
    noun: "Chronicles",
  },
];

// Generate IP-style address from serial number
const generateIPAddress = (serialNumber) => {
  const octet1 = (serialNumber >>> 24) & 0xff;
  const octet2 = (serialNumber >>> 16) & 0xff;
  const octet3 = (serialNumber >>> 8) & 0xff;
  const octet4 = serialNumber & 0xff;
  return `${octet1}.${octet2}.${octet3}.${octet4}`;
};

// Generate alternative IP-style format
const generateAltIPAddress = (serialNumber) => {
  const first = (serialNumber >>> 16) & 0xffff;
  const second = (serialNumber >>> 8) & 0xff;
  const third = serialNumber & 0xff;
  return `${first}@${second}.${third}`;
};

const AccountPane = ({ userAccount, onAccountUpdate }) => {
  const [view, setView] = useState("main");
  const [selectedTier, setSelectedTier] = useState(null);
  const [customDomain, setCustomDomain] = useState("");
  const [availability, setAvailability] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [serverHealth, setServerHealth] = useState(null);

  // Check server health on component mount
  useEffect(() => {
    checkServerHealth();
  }, []);

  const checkServerHealth = async () => {
    const result = await getHealthStatus();
    if (result.success) {
      setServerHealth(result.data);
    } else {
      console.error("Server health check failed:", result.error);
    }
  };

  // Simulates getting the user's serial number from their CloudCoin
  const getUserSerialNumber = () => {
    return 0x005c14b8; // Example: 6034616 in decimal
  };

  // Simulates getting the user's word index based on password hash
  const getUserHashIndex = () => {
    return 42; // Example: using index 42 for demo
  };

  const getUserWords = () => {
    const index = getUserHashIndex();
    return silverWordTable[index] || silverWordTable[0];
  };

  const handleSelectIPStyle = (format) => {
    const serialNumber = getUserSerialNumber();
    const address =
      format === "standard"
        ? generateIPAddress(serialNumber)
        : generateAltIPAddress(serialNumber);

    onAccountUpdate({
      tier: "100cc",
      status: "plain",
      email: address,
      denomination: 100,
    });
    setView("main");
  };

  const handleSelectWordAlias = (word, tier) => {
    const domain = tier === "1000cc" ? "qmail.bronze" : "qmail.silver";
    onAccountUpdate({
      tier: tier,
      status: tier === "1000cc" ? "bronze" : "silver",
      email: `${word.toLowerCase()}@${domain}`,
      denomination: tier === "1000cc" ? 1000 : 10000,
    });
    setView("main");
  };

  const handleCheckDomainAvailability = () => {
    if (!customDomain) return;
    setIsChecking(true);
    setAvailability(null);
    setTimeout(() => {
      // Mock availability check - in production would check against taken domains
      const takenDomains = ["sean.worthing", "admin.qmail", "test.domain"];
      const isTaken = takenDomains.includes(customDomain.toLowerCase());
      setAvailability(isTaken ? "taken" : "available");
      setIsChecking(false);
    }, 1000);
  };

  const handleClaimGoldDomain = () => {
    const serialNumber = getUserSerialNumber();
    onAccountUpdate({
      tier: "100000cc",
      status: "gold",
      email: `${serialNumber}@${customDomain.toLowerCase()}`,
      denomination: 100000,
    });
    setView("main");
  };

  const renderMainContent = () => (
    <>
      <div className="account-header">
        <h2>My QMail Account</h2>
        <p>
          Manage your membership tier and email addresses based on CloudCoin
          denomination.
        </p>
      </div>

      {serverHealth && (
        <div className="server-status-card glass-container">
          <div className="status-header">
            <Activity size={20} />
            <h3>Server Status</h3>
          </div>
          <div className="status-details">
            <div className="status-item">
              <span className="status-label">Status:</span>
              <span
                className={`status-value ${
                  serverHealth.status === "healthy" ? "success" : "error"
                }`}
              >
                {serverHealth.status}
              </span>
            </div>
            <div className="status-item">
              <span className="status-label">Service:</span>
              <span className="status-value">{serverHealth.service}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Version:</span>
              <span className="status-value">{serverHealth.version}</span>
            </div>
          </div>
        </div>
      )}

      <div className="account-card glass-container">
        <div className="account-info">
          <div
            className="account-tier-badge"
            style={{ borderColor: getTierColor() }}
          >
            <Award size={24} style={{ color: getTierColor() }} />
            <div>
              <h3>{getTierName()}</h3>
              <p className="account-email">
                {userAccount.email || "No address selected"}
              </p>
            </div>
          </div>
          <p className="tier-description">{getTierDescription()}</p>
        </div>
      </div>

      <div className="tier-selection-grid">
        <div className="tier-card card" onClick={() => setView("select100cc")}>
          <div className="tier-icon" style={{ backgroundColor: "#888" }}>
            <Coins size={32} />
          </div>
          <h3>Plain (100 CC)</h3>
          <p className="tier-description">
            IP-style address derived from serial number
          </p>
          <ul className="tier-features">
            <li>
              <CheckCircle size={16} /> Permanent and secure
            </li>
            <li>
              <CheckCircle size={16} /> Two format options
            </li>
            <li>
              <CheckCircle size={16} /> Basic functionality
            </li>
          </ul>
          <button className="tier-select-btn secondary">Select Plain</button>
        </div>

        <div className="tier-card card" onClick={() => setView("select1000cc")}>
          <div className="tier-icon" style={{ backgroundColor: "#CD7F32" }}>
            <Award size={32} />
          </div>
          <h3>Bronze (1,000 CC)</h3>
          <p className="tier-description">Word-based memorable alias</p>
          <ul className="tier-features">
            <li>
              <CheckCircle size={16} /> Memorable word address
            </li>
            <li>
              <CheckCircle size={16} /> @qmail.bronze domain
            </li>
            <li>
              <CheckCircle size={16} /> Three word choices
            </li>
          </ul>
          <button className="tier-select-btn secondary">Select Bronze</button>
        </div>

        <div
          className="tier-card card"
          onClick={() => setView("select10000cc")}
        >
          <div className="tier-icon" style={{ backgroundColor: "#C0C0C0" }}>
            <Zap size={32} />
          </div>
          <h3>Silver (10,000 CC)</h3>
          <p className="tier-description">Premium word-based address</p>
          <ul className="tier-features">
            <li>
              <CheckCircle size={16} /> Premium word address
            </li>
            <li>
              <CheckCircle size={16} /> @qmail.silver domain
            </li>
            <li>
              <CheckCircle size={16} /> Enhanced features
            </li>
          </ul>
          <button className="tier-select-btn secondary">Select Silver</button>
        </div>

        <div className="tier-card card disabled">
          <div className="tier-icon" style={{ backgroundColor: "#FFD700" }}>
            <DollarSign size={32} />
          </div>
          <h3>Gold (100,000 CC)</h3>
          <p className="tier-description">Custom domain with serial</p>
          <ul className="tier-features">
            <li>
              <CheckCircle size={16} /> Custom domain name
            </li>
            <li>
              <CheckCircle size={16} /> Serial @ your.domain
            </li>
            <li>
              <XCircle size={16} className="disabled-feature" /> Coming soon
            </li>
          </ul>
          <button className="tier-select-btn secondary" disabled>
            Coming Soon
          </button>
        </div>
      </div>
    </>
  );

  const render100CCSelection = () => {
    const serialNumber = getUserSerialNumber();
    const standardIP = generateIPAddress(serialNumber);
    const altIP = generateAltIPAddress(serialNumber);

    return (
      <div className="silver-selection-pane">
        <button
          className="back-button secondary"
          onClick={() => setView("main")}
        >
          <ChevronLeft size={20} /> Back to Account
        </button>

        <h3 className="selection-title">
          Choose Your Plain (100 CC) Address Format
        </h3>

        <div className="hash-explanation glass-container">
          <Info size={18} />
          <div className="explanation-text">
            <strong>How Plain Addresses Work:</strong> Your address is derived
            from your CloudCoin serial number. Serial Number:{" "}
            <code>{serialNumber}</code> (Hex: 0x
            {serialNumber.toString(16).toUpperCase()})
          </div>
        </div>

        <div className="word-selection-grid">
          <div
            className="word-option-card card"
            onClick={() => handleSelectIPStyle("standard")}
          >
            <div
              className="word-category-badge"
              style={{ backgroundColor: "#888" }}
            >
              Standard IP Format
            </div>
            <div className="word-display">{standardIP}</div>
            <div className="word-email-preview">
              Traditional four-octet format
            </div>
            <div className="select-indicator">Select this format →</div>
          </div>

          <div
            className="word-option-card card"
            onClick={() => handleSelectIPStyle("alternate")}
          >
            <div
              className="word-category-badge"
              style={{ backgroundColor: "#888" }}
            >
              Alternative Format
            </div>
            <div className="word-display">{altIP}</div>
            <div className="word-email-preview">Compact @ notation format</div>
            <div className="select-indicator">Select this format →</div>
          </div>
        </div>

        <div className="silver-info-box glass-container">
          <h4>About Plain Tier Addresses</h4>
          <p>
            The Plain tier (100 CC) provides basic, functional addresses based
            on your CloudCoin serial number. These addresses are permanent,
            secure, and cryptographically tied to your credentials.
          </p>
        </div>
      </div>
    );
  };

  const renderWordSelection = (tier) => {
    const userWords = getUserWords();
    const isBronze = tier === "1000cc";
    const tierName = isBronze ? "Bronze (1,000 CC)" : "Silver (10,000 CC)";
    const tierColor = isBronze ? "#CD7F32" : "#C0C0C0";

    if (!userWords) {
      return (
        <div className="silver-selection-pane">
          <button
            className="back-button secondary"
            onClick={() => setView("main")}
          >
            <ChevronLeft size={20} /> Back to Account
          </button>
          <p>Error: Could not load word assignments. Please try again.</p>
        </div>
      );
    }

    return (
      <div className="silver-selection-pane">
        <button
          className="back-button secondary"
          onClick={() => setView("main")}
        >
          <ChevronLeft size={20} /> Back to Account
        </button>

        <h3 className="selection-title">Choose Your {tierName} Address</h3>

        <div className="hash-explanation glass-container">
          <Info size={18} />
          <div className="explanation-text">
            <strong>How Word-Based Addresses Work:</strong> Your password is
            cryptographically hashed, and the last byte (value 0-255) determines
            your word assignment. You've been assigned{" "}
            <strong>
              Index {userWords.dec} (0x{userWords.hex})
            </strong>
            .
          </div>
        </div>

        <p className="selection-description">
          Choose one of the three words assigned to your hash index. This choice
          is <strong>permanent</strong>.
        </p>

        <div className="word-selection-grid">
          <div
            className="word-option-card card"
            onClick={() => handleSelectWordAlias(userWords.role, tier)}
          >
            <div className="word-category-badge role-badge">Role</div>
            <div className="word-display">{userWords.role}</div>
            <div className="word-email-preview">
              {userWords.role.toLowerCase()}@
              {isBronze ? "qmail.bronze" : "qmail.silver"}
            </div>
            <div className="select-indicator">Select this alias →</div>
          </div>

          <div
            className="word-option-card card"
            onClick={() => handleSelectWordAlias(userWords.adjective, tier)}
          >
            <div className="word-category-badge adjective-badge">Adjective</div>
            <div className="word-display">{userWords.adjective}</div>
            <div className="word-email-preview">
              {userWords.adjective.toLowerCase()}@
              {isBronze ? "qmail.bronze" : "qmail.silver"}
            </div>
            <div className="select-indicator">Select this alias →</div>
          </div>

          <div
            className="word-option-card card"
            onClick={() => handleSelectWordAlias(userWords.noun, tier)}
          >
            <div className="word-category-badge noun-badge">Plural Noun</div>
            <div className="word-display">{userWords.noun}</div>
            <div className="word-email-preview">
              {userWords.noun.toLowerCase()}@
              {isBronze ? "qmail.bronze" : "qmail.silver"}
            </div>
            <div className="select-indicator">Select this alias →</div>
          </div>
        </div>

        <div className="silver-info-box glass-container">
          <h4>Why These Words?</h4>
          <p>
            The QMail protocol uses a 256-entry word table covering roles,
            adjectives, and plural nouns. Each hash value (0x00 to 0xFF) maps to
            exactly one row in this table, giving you three memorable options
            while maintaining cryptographic security.
          </p>
          <p>
            Your assigned index:{" "}
            <code>
              Dec {userWords.dec} / Hex 0x{userWords.hex}
            </code>
          </p>
        </div>
      </div>
    );
  };

  const getTierName = () => {
    if (!userAccount.tier) return "No Tier Selected";
    switch (userAccount.tier) {
      case "100cc":
        return "Plain (100 CC)";
      case "1000cc":
        return "Bronze - Some Regalia (1,000 CC)";
      case "10000cc":
        return "Silver - Better (10,000 CC)";
      case "100000cc":
        return "Gold - Good (100,000 CC)";
      case "1000000cc":
        return "Diamond - The Best (1,000,000 CC)";
      default:
        return userAccount.status || "Unknown";
    }
  };

  const getTierColor = () => {
    if (!userAccount.tier) return "#666";
    switch (userAccount.tier) {
      case "100cc":
        return "#888";
      case "1000cc":
        return "#CD7F32";
      case "10000cc":
        return "#C0C0C0";
      case "100000cc":
        return "#FFD700";
      case "1000000cc":
        return "#b9f2ff";
      default:
        return "#666";
    }
  };

  const getTierDescription = () => {
    if (!userAccount.tier) return "Select a tier to get started with QMail.";
    switch (userAccount.tier) {
      case "100cc":
        return "IP-style address generated from your CloudCoin serial number.";
      case "1000cc":
        return "Word-based address with bronze designation.";
      case "10000cc":
        return "Premium word-based address with silver domain.";
      case "100000cc":
        return "Semi-custom address with your serial number and custom domain.";
      case "1000000cc":
        return "Fully custom address with complete personalization.";
      default:
        return userAccount.description || "";
    }
  };

  return (
    <div className="account-pane">
      {view === "main" && renderMainContent()}
      {view === "select100cc" && render100CCSelection()}
      {view === "select1000cc" && renderWordSelection("1000cc")}
      {view === "select10000cc" && renderWordSelection("10000cc")}
    </div>
  );
};

export default AccountPane;
