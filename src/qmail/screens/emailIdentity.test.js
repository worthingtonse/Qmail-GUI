import { describe, expect, it } from "vitest";
import {
  getEmailDisplayIdentityFields,
  getEmailSenderFields,
} from "./emailIdentity";

// Emails as qmailApiServices shapes them for the dashboard: sender_name /
// recipient_name are the backend-resolved contact display names ("" when the
// party is not a saved contact), sender_address / recipient_address are the
// canonical QMail addresses.

describe("getEmailSenderFields (incoming display identity)", () => {
  it("shows the contact name as the label and keeps the address for hover/copy", () => {
    const fields = getEmailSenderFields({
      sender_name: "Alice Johnson",
      sender_address: "16.0.0@kilo",
      sender: "16.0.0@kilo",
      sender_sn: 1048576,
      sender_denomination_code: 2,
    });
    expect(fields.senderDisplayName).toBe("Alice Johnson");
    expect(fields.senderDisplayAddress).toBe("16.0.0@kilo");
  });

  it("collapses a first-name-only contact to just the name (already trimmed by backend)", () => {
    const fields = getEmailSenderFields({
      sender_name: "Bob",
      sender_address: "5@byte",
      sender: "5@byte",
      sender_sn: 5,
      sender_denomination_code: 1,
    });
    expect(fields.senderDisplayName).toBe("Bob");
    expect(fields.senderDisplayAddress).toBe("5@byte");
  });

  it("leaves the display name empty for a non-contact so the UI falls back to the address", () => {
    const fields = getEmailSenderFields({
      sender_name: "",
      sender_address: "197@bit",
      sender: "197@bit",
      sender_sn: 197,
      sender_denomination_code: 0,
    });
    expect(fields.senderDisplayName).toBe("");
    expect(fields.senderDisplayAddress).toBe("197@bit");
  });

  it("trims whitespace-only backend names down to empty", () => {
    const fields = getEmailSenderFields({
      sender_name: "   ",
      sender_address: "197@bit",
      sender: "197@bit",
      sender_sn: 197,
    });
    expect(fields.senderDisplayName).toBe("");
  });

  it("prefers the camelCase senderName field when present", () => {
    const fields = getEmailSenderFields({
      senderName: "Carol",
      sender_address: "9@bit",
      sender: "9@bit",
      sender_sn: 9,
    });
    expect(fields.senderDisplayName).toBe("Carol");
  });

  it("falls back to the serial number for the copy address when no address string exists", () => {
    const fields = getEmailSenderFields({
      sender_name: "",
      sender_sn: 42,
    });
    // No parseable address string, so the address surfaces the bare SN.
    expect(fields.senderDisplayName).toBe("");
    expect(fields.senderDisplayAddress).toBe("42");
  });

  it("works on legacy rows that carry no name fields at all", () => {
    const fields = getEmailSenderFields({
      sender: "6.197@bit",
      senderEmail: "6.197@bit",
      sender_sn: 197,
    });
    expect(fields.senderDisplayName).toBe("");
    expect(fields.senderDisplayAddress).toBe("6.197@bit");
  });
});

describe("getEmailDisplayIdentityFields — folder routing", () => {
  it("uses the SENDER for incoming folders (inbox/trash/starred/archive)", () => {
    const email = {
      sender_name: "Alice Johnson",
      sender_address: "16.0.0@kilo",
      sender: "16.0.0@kilo",
      sender_sn: 1048576,
      // A recipient block is present on inbox rows too — it must be ignored.
      recipient_name: "Should Not Appear",
      recipient_address: "99@bit",
      recipient_sn: 99,
      recipient_count: 1,
    };
    for (const folder of ["inbox", "trash", "starred", "archive"]) {
      const fields = getEmailDisplayIdentityFields(email, folder);
      expect(fields.senderDisplayName).toBe("Alice Johnson");
      expect(fields.senderDisplayAddress).toBe("16.0.0@kilo");
    }
  });

  it("uses the RECIPIENT for outgoing folders (sent/drafts)", () => {
    const email = {
      // Sender is the user themselves — not a saved contact.
      sender_name: "",
      sender_sn: 999,
      recipient_name: "Alice Johnson",
      recipient_address: "16.0.0@kilo",
      recipient_sn: 1048576,
      recipient_denomination_code: 2,
      recipient_count: 1,
    };
    for (const folder of ["sent", "drafts"]) {
      const fields = getEmailDisplayIdentityFields(email, folder);
      expect(fields.senderDisplayName).toBe("Alice Johnson");
      expect(fields.senderDisplayAddress).toBe("16.0.0@kilo");
      expect(fields.senderSn).toBe(1048576);
    }
  });
});

describe("getEmailDisplayIdentityFields — outgoing recipient display", () => {
  it("falls back to the recipient address when the recipient is not a contact", () => {
    const fields = getEmailDisplayIdentityFields(
      {
        recipient_name: "",
        recipient_address: "197@bit",
        recipient_sn: 197,
        recipient_count: 1,
      },
      "sent",
    );
    expect(fields.senderDisplayName).toBe("");
    expect(fields.senderDisplayAddress).toBe("197@bit");
  });

  it("appends a +N hint to the display name but not the copyable address for multiple recipients", () => {
    const fields = getEmailDisplayIdentityFields(
      {
        recipient_name: "Alice Johnson",
        recipient_address: "16.0.0@kilo",
        recipient_sn: 1048576,
        recipient_count: 3,
      },
      "sent",
    );
    // Visible labels keep +N; hover/copy address is the bare primary only.
    expect(fields.senderDisplayName).toBe("Alice Johnson +2");
    expect(fields.senderDisplayAddress).toBe("16.0.0@kilo");
    // The legacy `sender` label (used by the avatar) also carries the hint.
    expect(fields.sender).toBe("Alice Johnson +2");
  });

  it("keeps +N on the visible label but not the address when there is no recipient name", () => {
    const fields = getEmailDisplayIdentityFields(
      {
        recipient_name: "",
        recipient_address: "197@bit",
        recipient_sn: 197,
        recipient_count: 4,
      },
      "sent",
    );
    // Consumers render senderDisplayName || senderDisplayAddress, so the
    // visible label must carry the +N hint even without a contact name,
    // while the copyable address stays clean.
    expect(fields.senderDisplayName).toBe("197@bit +3");
    expect(fields.senderDisplayAddress).toBe("197@bit");
    expect(fields.sender).toBe("197@bit +3");
  });

  it("does not add a +N hint for a single recipient", () => {
    const fields = getEmailDisplayIdentityFields(
      {
        recipient_name: "Alice Johnson",
        recipient_address: "16.0.0@kilo",
        recipient_sn: 1048576,
        recipient_count: 1,
      },
      "sent",
    );
    expect(fields.senderDisplayName).toBe("Alice Johnson");
    expect(fields.senderDisplayAddress).toBe("16.0.0@kilo");
  });

  it("copyable address never includes a +N suffix even for multi-recipient sent mail", () => {
    const fields = getEmailDisplayIdentityFields(
      {
        recipient_name: "Bob",
        recipient_address: "20.100@giga",
        recipient_sn: 20,
        recipient_count: 5,
      },
      "sent",
    );
    expect(fields.senderDisplayName).toBe("Bob +4");
    expect(fields.senderDisplayAddress).toBe("20.100@giga");
    expect(fields.senderDisplayAddress).not.toMatch(/\+\d/);
  });
});
