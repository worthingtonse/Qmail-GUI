# QMail GUI Manual Smoke Checklist

This checklist is designed for a human-observed smoke pass of the QMail GUI using two isolated test clients (`client1` and `client2`).

**Important Note on Known Issues:** Several backend features are currently incomplete. **Do not report GUI bugs** for the following known issues:
*   **CORE-A:** Sent folder may not persist all outbound mail.
*   **CORE-E:** Send progress shows raw backend text instead of friendly stages.
*   **CORE-H:** Drafts might not be deleted after sending.
*   **CORE-J:** Starred view/filter is blocked.
*   **CORE-K:** Search "top 50 results" notice may appear even if there are exactly 50 matches.
*   **CORE-M:** Attachment paths containing `,` or `;` are currently rejected by the GUI.

---

## 1. Preparation & Setup (Do This First)

1.  **Verify Backend Processes:** Ensure no stray `core.exe` processes are running before you start.
2.  **Create Test Directory:** Set up a clean directory on `E:\` (e.g., `E:\QMail-Smoke\<date>\`).
3.  **Create Client Folders:** Create `E:\QMail-Smoke\<date>\client1\` and `E:\QMail-Smoke\<date>\client2\`.
4.  **Populate Client Data:**
    *   Place `core.exe` in both client folders.
    *   Ensure each has its own `Client_Data` folder with distinct `rest_core.conf` (e.g., port 8081 for client1, 8082 for client2) and unique `qmail.db` and `Wallets`.
5.  **Prepare Attachments:** Create a folder `E:\QMail-Smoke\<date>\attachments\` and populate it with test files:
    *   `small.txt`
    *   `filename with spaces.txt`
    *   `sample.png`
    *   `sample.pdf`
    *   `sample.bin`
6.  **Start Backends:** Navigate to each client folder and run `core.exe`. Ensure both are running simultaneously.
7.  **Start GUIs:**
    *   **Option A (Dev Mode - Recommended):** Run `npm run dev` and open `http://localhost:5173/?backendPort=8081`. Then run `npm run dev2` and open `http://localhost:5174/?backendPort=8082`.
    *   **Option B (Packaged):** Build the portable app (`npm run build-portable`), copy it to both client folders, and launch them.

## 2. Identity Verification

1.  **Verify Client 1:** In client 1, check AccountPane -> Profile. Confirm the identity (e.g., `@chariot.pyramid.byte`) and verify the wallet has a non-zero balance.
2.  **Verify Client 2:** In client 2, check AccountPane -> Profile. Confirm it shows a different identity (e.g., `@chariot.harbor.byte`).
3.  **Add Contacts:** Add client2 to client1's contacts, and client1 to client2's contacts.

## 3. Basic Messaging (Core Flow)

1.  **Send Plain Email:** In client1, compose a plain text email (To, Subject, Body) to client2 and send it.
2.  **Receive & Decrypt:** In client2, wait for the pending row to appear, click it, and verify the decrypted body, sender, and subject match.
3.  **Reply:** In client2, click Reply on the received message. Verify the Compose Modal opens with the correct To, "Re:" subject, and quoted body. Send the reply.
4.  **Forward:** In client2, select a message and Forward. Verify new compose opens with empty To, "Fwd:" subject, and quoted body.

## 4. Attachments

1.  **Send Attachments:** In client1, compose a new message to client2. Attach `small.txt` and a binary/document file (e.g., `sample.pdf`). Send.
2.  **Receive & Verify:** In client2, open the message. Verify attachment chips show correct filenames.
3.  **Download:** Download the attachments in client2 and verify the contents match the original files on `E:\`.
4.  **Reverse Direction:** Send an attachment from client2 back to client1 to verify bidirectional flow.

## 5. Drafts

1.  **Create & Autosave:** In client1, start a draft, add a subject and body. Close the modal without sending. Wait 5+ seconds and watch for the "Saved" indicator flashing.
2.  **Restore:** Switch to the Drafts folder, re-open the draft. Verify all fields (subject, body, recipients) hydrate correctly.
3.  **Send Draft:** Send the draft. *(Note: Due to CORE-H, the draft may remain in the list).*

## 6. Contacts & Search

1.  **Autocomplete:** Verify `To` autocomplete works by finding client2 from client1 using both display name and QMail address/SN.
2.  **Delete Contact:** Delete a contact and verify the in-app confirmation modal appears (not a browser confirm). Use the "undo" toast to restore it.
3.  **Search Lookup:** Use the Search icon. Type a known SN and verify local lookup works.
4.  **Search Limits:** Search for a term with more than 50 results. Verify the "Showing top 50 results" notice appears.

## 7. Mailbox Management

1.  **Read/Unread:** In client2's inbox, open a read email and click "Mark Unread". Verify the unread indicator appears. Open an unread email and verify the button is hidden.
2.  **Archive:** In client2's inbox, select a message and click the Archive action button. Verify it moves out of the Inbox.
3.  **Trash/Delete:** Move a message to Trash. Go to Trash, select "Delete these N messages permanently". Verify the confirmation modal appears and the action succeeds.

## 8. Network & UI State

1.  **Refresh Flow:** Click the unified Refresh button. Verify a single spinner runs through all steps and a single success toast appears at the end.
2.  **Offline State:** Briefly stop client1's `core.exe`. Attempt to send or refresh. Verify the network-warning banner appears with a Retry button. Restart `core.exe` and verify recovery.
3.  **Empty States:** Verify an empty message body shows the preview "(no message body)" in italics.