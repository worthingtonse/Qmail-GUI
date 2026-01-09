// --- mockDataService.js ---
// Comprehensive mock data for testing QMail dashboard without backend

// Enable/disable mock mode (set to true for testing without backend)
export const MOCK_MODE = true;

// Simulated delay for API calls (milliseconds)
const MOCK_DELAY = 500;

// Helper to simulate API delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Generate random ID
const generateId = () => Math.random().toString(36).substring(2, 15);

// Mock server health
export const mockServerHealth = {
  status: "healthy",
  service: "QMail Client Core (MOCK)",
  version: "1.0.0-mock",
  timestamp: Date.now()
};

// Mock wallet balance
export const mockWalletBalance = {
  walletPath: "/home/user/.cloudcoin/wallet",
  walletName: "Test Wallet",
  totalCoins: 150,
  totalValue: 150.0,
  folders: {
    bank: { coins: 100, value: 100.0 },
    fracked: { coins: 45, value: 45.0 },
    limbo: { coins: 5, value: 5.0 }
  },
  denominations: {
    "1": 50,
    "5": 15,
    "25": 3,
    "100": 1
  },
  warnings: []
};

// Mock folders
export const mockFolders = [
  { name: "inbox", displayName: "Inbox" },
  { name: "sent", displayName: "Sent" },
  { name: "drafts", displayName: "Drafts" },
  { name: "trash", displayName: "Trash" }
];

// Generate realistic timestamps
const getTimestamp = (daysAgo = 0, hoursAgo = 0) => {
  const now = new Date();
  now.setDate(now.getDate() - daysAgo);
  now.setHours(now.getHours() - hoursAgo);
  return now.toISOString();
};

const formatTime = (isoString) => {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

// Mock email database with different states
export const mockEmailDatabase = {
  // Downloaded emails with full content
  "email_001": {
    EmailID: "email_001",
    Subject: "Welcome to QMail - Getting Started Guide",
    sender: "QMail Team",
    senderEmail: "support@qmail.cloud",
    body: `Welcome to QMail!\n\nWe're excited to have you on board. QMail is a decentralized, quantum-safe email system that operates independently of DNS infrastructure.\n\nHere are some key features:\n\n1. Quantum-Safe Encryption: Your emails are protected with next-generation cryptography\n2. DNS-Independent: No reliance on centralized DNS servers\n3. CloudCoin Integration: Use CloudCoin for secure, private communications\n4. Distributed Architecture: Your data is protected across 25 RAIDA servers\n\nGetting started is easy:\n- Compose your first email using the blue "Compose" button\n- Add contacts to your address book\n- Explore the settings in your Account page\n\nIf you have any questions, feel free to reach out to our support team.\n\nBest regards,\nThe QMail Team`,
    ReceivedTimestamp: getTimestamp(0, 2),
    SentTimestamp: getTimestamp(0, 2),
    is_read: false,
    is_starred: false,
    is_trashed: false,
    downloaded: true,
    folder: "inbox",
    locker_code: "0000000000000000000000000000000000000000000000000000000000000000",
    tags: ["welcome", "important"]
  },
  
  // Downloaded email - Read
  "email_002": {
    EmailID: "email_002",
    Subject: "Your December Statement is Ready",
    sender: "CloudCoin Finance",
    senderEmail: "statements@cloudcoin.global",
    body: `Dear User,\n\nYour December account statement is now available.\n\nAccount Summary:\n- Starting Balance: 100 CC\n- Incoming Transactions: 75 CC\n- Outgoing Transactions: 25 CC\n- Ending Balance: 150 CC\n\nThank you for using CloudCoin.\n\nBest regards,\nCloudCoin Finance Team`,
    ReceivedTimestamp: getTimestamp(1, 5),
    SentTimestamp: getTimestamp(1, 5),
    is_read: true,
    is_starred: true,
    is_trashed: false,
    downloaded: true,
    folder: "inbox",
    locker_code: "0000000000000000000000000000000000000000000000000000000000000000",
    tags: ["finance"]
  },
  
  // NOT downloaded - shows placeholder, has locker_code
  "email_003": {
    EmailID: "email_003",
    Subject: "Email 72bc4813... (Pending Download)",
    sender: "Unknown",
    senderEmail: "",
    body: "",
    ReceivedTimestamp: getTimestamp(0, 1),
    SentTimestamp: getTimestamp(0, 1),
    is_read: false,
    is_starred: false,
    is_trashed: false,
    downloaded: false,
    folder: "inbox",
    locker_code: "72bc4813a5e2f94d6b1c8e7f3a9d5b2c4e6f8a1b3c5d7e9f0a2b4c6d8e0f1a3b",
    tags: []
  },
  
  // Downloaded with attachments
  "email_004": {
    EmailID: "email_004",
    Subject: "Project Proposal - Q1 2026",
    sender: "Sarah Mitchell",
    senderEmail: "sarah.mitchell@techcorp.qmail",
    body: `Hi Team,\n\nPlease find attached the project proposal for Q1 2026. I've included:\n\n- Budget breakdown\n- Timeline overview\n- Resource allocation plan\n- Risk assessment\n\nLooking forward to your feedback in tomorrow's meeting.\n\nBest,\nSarah`,
    ReceivedTimestamp: getTimestamp(0, 8),
    SentTimestamp: getTimestamp(0, 8),
    is_read: false,
    is_starred: false,
    is_trashed: false,
    downloaded: true,
    folder: "inbox",
    locker_code: "0000000000000000000000000000000000000000000000000000000000000000",
    tags: ["work", "urgent"],
    attachments: [
      {
        attachmentId: "att_001",
        name: "Q1_2026_Proposal.pdf",
        size: 2457600, // 2.4 MB
        fileExtension: "pdf"
      },
      {
        attachmentId: "att_002",
        name: "Budget_Breakdown.xlsx",
        size: 524288, // 512 KB
        fileExtension: "xlsx"
      },
      {
        attachmentId: "att_003",
        name: "Timeline.png",
        size: 156000, // 156 KB
        fileExtension: "png"
      }
    ]
  },
  
  // Another pending download
  "email_005": {
    EmailID: "email_005",
    Subject: "Email a9f3c7e1... (Pending Download)",
    sender: "Unknown",
    senderEmail: "",
    body: "",
    ReceivedTimestamp: getTimestamp(0, 3),
    SentTimestamp: getTimestamp(0, 3),
    is_read: false,
    is_starred: false,
    is_trashed: false,
    downloaded: false,
    folder: "inbox",
    locker_code: "a9f3c7e1b5d2a4c6e8f0a1b3c5d7e9f1a2b4c6d8e0f1a3b5c7d9e1f2a4b6c8d0",
    tags: []
  },
  
  // Sent email
  "email_006": {
    EmailID: "email_006",
    Subject: "Re: Meeting Schedule for Next Week",
    sender: "You",
    senderEmail: "john.doe@qmail.cloud",
    body: `Hi Michael,\n\nTuesday at 2 PM works great for me. I'll send out the agenda tomorrow morning.\n\nLooking forward to it!\n\nJohn`,
    ReceivedTimestamp: getTimestamp(1, 0),
    SentTimestamp: getTimestamp(1, 0),
    is_read: true,
    is_starred: false,
    is_trashed: false,
    downloaded: true,
    folder: "sent",
    locker_code: "0000000000000000000000000000000000000000000000000000000000000000",
    tags: []
  },
  
  // Email in trash
  "email_007": {
    EmailID: "email_007",
    Subject: "Special Offer: 50% Off Everything!",
    sender: "Marketing Bot",
    senderEmail: "noreply@spam.com",
    body: "This is a spam email that was moved to trash.",
    ReceivedTimestamp: getTimestamp(3, 0),
    SentTimestamp: getTimestamp(3, 0),
    is_read: true,
    is_starred: false,
    is_trashed: true,
    downloaded: true,
    folder: "trash",
    locker_code: "0000000000000000000000000000000000000000000000000000000000000000",
    tags: []
  },
  
  // More realistic emails
  "email_008": {
    EmailID: "email_008",
    Subject: "Security Alert: New Login Detected",
    sender: "QMail Security",
    senderEmail: "security@qmail.cloud",
    body: `We detected a new login to your account:\n\nDevice: Chrome on Windows\nLocation: Srinagar, Jammu and Kashmir, IN\nTime: ${new Date().toLocaleString()}\n\nIf this was you, no action is needed. If not, please secure your account immediately.`,
    ReceivedTimestamp: getTimestamp(0, 12),
    SentTimestamp: getTimestamp(0, 12),
    is_read: true,
    is_starred: false,
    is_trashed: false,
    downloaded: true,
    folder: "inbox",
    locker_code: "0000000000000000000000000000000000000000000000000000000000000000",
    tags: ["security"]
  },
  
  "email_009": {
    EmailID: "email_009",
    Subject: "Boom America Filming Schedule Update",
    sender: "Production Team",
    senderEmail: "production@boomamerica.tv",
    body: `Hi Sean,\n\nExciting news! We've finalized the filming schedule for your segment.\n\nFilming Dates:\n- January 15-17: Initial interviews\n- January 20-22: Business presentation\n- January 25: Investor pitch day\n\nPlease confirm your availability. We'll send travel arrangements separately.\n\nLooking forward to showcasing RaidaTech!\n\nBest,\nProduction Team`,
    ReceivedTimestamp: getTimestamp(0, 6),
    SentTimestamp: getTimestamp(0, 6),
    is_read: false,
    is_starred: true,
    is_trashed: false,
    downloaded: true,
    folder: "inbox",
    locker_code: "0000000000000000000000000000000000000000000000000000000000000000",
    tags: ["important", "business"]
  },
  
  "email_010": {
    EmailID: "email_010",
    Subject: "Weekly RAIDA Server Status Report",
    sender: "System Monitor",
    senderEmail: "monitor@raida.network",
    body: `RAIDA Network Status Report - Week of January 1, 2026\n\nAll Systems Operational\n\nServer Health:\n- 25/25 servers online (100%)\n- Average response time: 45ms\n- Zero downtime this week\n- Successful authentications: 1,247,893\n\nSecurity:\n- No breach attempts detected\n- All quantum-safe protocols functioning\n- Identity coin validations: 100% success rate\n\nNext scheduled maintenance: January 15, 2026 at 2:00 AM UTC`,
    ReceivedTimestamp: getTimestamp(2, 0),
    SentTimestamp: getTimestamp(2, 0),
    is_read: true,
    is_starred: false,
    is_trashed: false,
    downloaded: true,
    folder: "inbox",
    locker_code: "0000000000000000000000000000000000000000000000000000000000000000",
    tags: ["system", "weekly-report"]
  }
};

// Mock mail counts
export const mockMailCounts = {
  inbox: { unread: 4, total: 8 },
  sent: { unread: 0, total: 1 },
  drafts: { unread: 0, total: 2 },
  trash: { unread: 0, total: 1 }
};

// Mock drafts
export const mockDrafts = [
  {
    id: "draft_001",
    subject: "Investor Update - December Progress",
    body: "Dear Investors,\n\nI wanted to share some exciting updates about QMail's progress...\n\n[Draft in progress]",
    created_at: getTimestamp(0, 4),
    timestamp: formatTime(getTimestamp(0, 4)),
    preview: "Dear Investors, I wanted to share some exciting updates about QMail's progress..."
  },
  {
    id: "draft_002",
    subject: "",
    body: "",
    created_at: getTimestamp(1, 0),
    timestamp: formatTime(getTimestamp(1, 0)),
    preview: "Empty draft"
  }
];

// Helper to get emails by folder
export const getEmailsByFolder = (folder) => {
  return Object.values(mockEmailDatabase)
    .filter(email => email.folder === folder)
    .map(email => ({
      ...email,
      timestamp: formatTime(email.ReceivedTimestamp),
      preview: email.body ? email.body.substring(0, 120) + "..." : "No preview available"
    }));
};

// Mock API responses
export const mockApiResponses = {
  health: async () => {
    await delay(MOCK_DELAY);
    return { success: true, data: mockServerHealth };
  },
  
  walletBalance: async () => {
    await delay(MOCK_DELAY);
    return { success: true, data: mockWalletBalance };
  },
  
  mailFolders: async () => {
    await delay(MOCK_DELAY);
    return { 
      success: true, 
      data: { folders: mockFolders } 
    };
  },
  
  mailCount: async () => {
    await delay(MOCK_DELAY);
    const summary = {
      total_unread: Object.values(mockMailCounts).reduce((sum, c) => sum + c.unread, 0),
      total: Object.values(mockMailCounts).reduce((sum, c) => sum + c.total, 0)
    };
    return { 
      success: true, 
      data: { 
        counts: mockMailCounts,
        summary
      } 
    };
  },
  
  mailList: async (folder = "inbox", limit = 50, offset = 0) => {
    await delay(MOCK_DELAY);
    const emails = getEmailsByFolder(folder);
    return {
      success: true,
      data: {
        folder,
        emails,
        totalCount: emails.length,
        limit,
        offset
      }
    };
  },
  
  getEmailById: async (emailId) => {
    await delay(MOCK_DELAY);
    const email = mockEmailDatabase[emailId];
    
    if (!email) {
      return {
        success: false,
        error: `Email ${emailId} not found`
      };
    }
    
    // Simulate downloading if not downloaded
    if (!email.downloaded) {
      // Simulate the download process
      return {
        success: true,
        data: {
          ...email,
          Subject: `Email ${emailId.substring(6, 14)}... (Pending Download)`,
          body: "This email content needs to be downloaded from RAIDA servers.",
          needsDownload: true,
          timestamp: formatTime(email.ReceivedTimestamp)
        }
      };
    }
    
    return {
      success: true,
      data: {
        ...email,
        timestamp: formatTime(email.ReceivedTimestamp),
        preview: email.body.substring(0, 120) + "..."
      }
    };
  },
  
  downloadEmail: async (emailId) => {
    await delay(2000); // Simulate longer download time
    const email = mockEmailDatabase[emailId];
    
    if (!email) {
      return { success: false, error: "Email not found" };
    }
    
    // Mark as downloaded and update with real content
    email.downloaded = true;
    email.Subject = `Successfully Downloaded Email`;
    email.body = `This email was just downloaded from RAIDA servers.\n\nEmail ID: ${emailId}\nLocker Code: ${email.locker_code}\n\nThe content has been decrypted and is now available for viewing.`;
    
    return {
      success: true,
      data: {
        message: "Email downloaded successfully",
        email: email
      }
    };
  },
  
  getAttachments: async (emailId) => {
    await delay(MOCK_DELAY);
    const email = mockEmailDatabase[emailId];
    
    if (!email || !email.attachments) {
      return {
        success: true,
        data: { attachments: [] }
      };
    }
    
    return {
      success: true,
      data: { attachments: email.attachments }
    };
  },
  
  drafts: async () => {
    await delay(MOCK_DELAY);
    return {
      success: true,
      data: { drafts: mockDrafts }
    };
  },
  
  ping: async () => {
    await delay(MOCK_DELAY);
    // Randomly simulate new mail occasionally
    const hasNewMail = Math.random() < 0.1; // 10% chance
    
    return {
      success: true,
      data: {
        status: "ok",
        timestamp: Date.now(),
        beaconStatus: "active",
        hasMail: hasNewMail,
        messageCount: hasNewMail ? 1 : 0,
        messages: hasNewMail ? ["email_new_001"] : []
      }
    };
  },
  
  markRead: async (emailId, isRead) => {
    await delay(MOCK_DELAY);
    const email = mockEmailDatabase[emailId];
    if (email) {
      email.is_read = isRead;
    }
    return {
      success: true,
      data: {
        message: `Marked as ${isRead ? 'read' : 'unread'}`,
        emailId,
        isRead
      }
    };
  },
  
  moveEmail: async (emailId, folder) => {
    await delay(MOCK_DELAY);
    const email = mockEmailDatabase[emailId];
    if (email) {
      email.folder = folder;
      if (folder === 'trash') {
        email.is_trashed = true;
      }
    }
    return {
      success: true,
      data: {
        message: `Moved to ${folder}`,
        emailId,
        folder
      }
    };
  },
  
  deleteEmail: async (emailId) => {
    await delay(MOCK_DELAY);
    return mockApiResponses.moveEmail(emailId, 'trash');
  },
  
  search: async (query, limit, offset) => {
    await delay(MOCK_DELAY);
    const allEmails = Object.values(mockEmailDatabase);
    const results = allEmails.filter(email => 
      email.Subject.toLowerCase().includes(query.toLowerCase()) ||
      email.body.toLowerCase().includes(query.toLowerCase()) ||
      email.sender.toLowerCase().includes(query.toLowerCase())
    );
    
    return {
      success: true,
      data: {
        results: results.map(email => ({
          ...email,
          timestamp: formatTime(email.ReceivedTimestamp),
          preview: email.body.substring(0, 120) + "..."
        })),
        total: results.length
      }
    };
  }
};