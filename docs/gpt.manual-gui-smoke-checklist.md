# QMail GUI Manual Smoke Checklist

Use this checklist for a human-observed smoke pass of the packaged GUI with two isolated QMail clients. Record pass/fail notes in `E:\QMail-Smoke\<date>\results\smoke-results.md`.

## 1. Stop Conditions

- [ ] Stop and ask before continuing if the current portable executable or packaged output cannot be found.
- [ ] Stop and ask before continuing if two separate test identities, locker passwords, QMail addresses, or SNs are not available.
- [ ] Stop and ask before continuing if `E:\` is unavailable.
- [ ] Stop and ask before continuing if either portable client cannot launch its backend.
- [ ] Stop and ask before continuing if testing would require production identities or sensitive files that were not already approved for smoke testing.

## 2. Preflight

- [ ] Record the current repo state:
  - Command: `git status --short`
  - Notes:
- [ ] From `D:\Code\src\JavaScript\Qmail-GUI`, run:
  - Command: `npm run lint`
  - Result:
- [ ] From `D:\Code\src\JavaScript\Qmail-GUI`, run:
  - Command: `npm run build`
  - Result:
- [ ] If no current portable build is available, create one:
  - Command: `npm run build-portable`
  - Portable output path:
- [ ] Create a fresh smoke folder:
  - Path: `E:\QMail-Smoke\<date>\`
- [ ] Create separate client folders:
  - `E:\QMail-Smoke\<date>\client1\`
  - `E:\QMail-Smoke\<date>\client2\`
- [ ] Copy the portable QMail executable or portable app output into `client1`.
- [ ] Copy the portable QMail executable or portable app output into `client2`.
- [ ] Confirm the two clients do not share a `Client_Data` folder.
- [ ] Create the results folder:
  - Path: `E:\QMail-Smoke\<date>\results\`
- [ ] Start `smoke-results.md` with:
  - Date:
  - Tester:
  - Build source:
  - Portable exe path:
  - client1 folder:
  - client2 folder:

## 3. Test Data

- [ ] Prepare `E:\QMail-Smoke\<date>\attachments\small.txt`.
- [ ] Prepare `E:\QMail-Smoke\<date>\attachments\filename with spaces.txt`.
- [ ] Prepare `E:\QMail-Smoke\<date>\attachments\sample.png`.
- [ ] Prepare `E:\QMail-Smoke\<date>\attachments\sample.pdf`.
- [ ] Prepare `E:\QMail-Smoke\<date>\attachments\sample.bin`.
- [ ] Optional: prepare `zero-byte.txt` only if the backend is expected to accept empty files.
- [ ] Optional: prepare `larger-attachment.bin` only if the backend upload limit is known.
- [ ] Optional: prepare `dangerous-test.exe` only for the dangerous attachment warning path.
- [ ] Confirm golden-path attachment file and folder names do not contain commas or semicolons.

## 4. Identity And Contact Setup

- [ ] Launch client1.
- [ ] Launch client2.
- [ ] Confirm client1 creates or uses only its own `Client_Data`.
- [ ] Confirm client2 creates or uses only its own `Client_Data`.
- [ ] Confirm client1 has its own wallet or locker.
- [ ] Confirm client2 has its own wallet or locker.
- [ ] Record client1 QMail address or SN in `smoke-results.md`.
- [ ] Record client2 QMail address or SN in `smoke-results.md`.
- [ ] Add client2 to client1 contacts.
- [ ] Add client1 to client2 contacts.
- [ ] Confirm each client still shows its own identity after both clients are open.

## 5. Core Send And Receive

- [ ] In client1, compose a plain message to client2.
  - To:
  - Subject:
  - Body:
- [ ] Send the client1 message.
- [ ] Refresh client2.
- [ ] Open the received message in client2.
- [ ] Verify sender is client1.
- [ ] Verify subject matches.
- [ ] Verify body matches.
- [ ] Verify timestamp is plausible.
- [ ] Verify read state changes after opening.
- [ ] In client2, use Reply from the received message.
- [ ] Send the reply to client1.
- [ ] Refresh client1.
- [ ] Open the reply in client1.
- [ ] Verify sender, subject, body, timestamp, and read state.

## 6. Attachments

- [ ] In client1, compose a message to client2 with `small.txt`.
- [ ] Add one binary or document attachment, such as `sample.pdf`, `sample.png`, or `sample.bin`.
- [ ] Send the attachment message.
- [ ] Refresh client2.
- [ ] Open the attachment message in client2.
- [ ] Verify attachment chips show the real filenames.
- [ ] Verify filenames with spaces display correctly if tested.
- [ ] Download, open, or save the attachments if supported.
- [ ] Compare downloaded filenames against the source files in `E:\QMail-Smoke\<date>\attachments`.
- [ ] Compare downloaded contents against the source files.
- [ ] Repeat the attachment send in the opposite direction: client2 to client1.
- [ ] Verify client1 receives, displays, and saves the returned attachments correctly.
- [ ] Optional: attach a path with a comma or semicolon and verify the GUI rejects it. This is expected until CORE-M is fixed.
- [ ] Optional: test dangerous attachment warning and confirmation with the approved dangerous test file.

## 7. Drafts

- [ ] In client1, start a new draft.
- [ ] Add To.
- [ ] Add Cc and Bcc if those fields are available.
- [ ] Add a unique subject.
- [ ] Add body text.
- [ ] Add an attachment if draft attachments are in scope for this run.
- [ ] Close compose.
- [ ] Reopen compose or the draft.
- [ ] Verify supported fields restore correctly.
- [ ] Send or discard the draft.
- [ ] Note any draft cleanup issue separately from GUI regressions if it matches known CORE-H or CORE-N limitations.

## 8. Contacts And Autocomplete

- [ ] Verify To autocomplete finds client2 from client1 by display name.
- [ ] Verify To autocomplete finds client2 from client1 by QMail address or SN.
- [ ] Verify Cc autocomplete works where available.
- [ ] Verify Bcc autocomplete works where available.
- [ ] Repeat autocomplete checks from client2 for client1.
- [ ] Delete a test contact.
- [ ] Verify delete uses the in-app confirmation modal.
- [ ] Re-add the contact if needed for later tests.
- [ ] Verify DRD or popular-contact "Add to My Contacts" persists locally if that path is available.

## 9. Mailbox Actions

- [ ] Mark a message unread.
- [ ] Verify the unread dot or unread styling appears.
- [ ] Mark the same message read.
- [ ] Verify the unread dot or unread styling disappears.
- [ ] Archive a message from Inbox.
- [ ] Verify the message leaves Inbox.
- [ ] Refresh.
- [ ] Verify mailbox counts and list state remain consistent.
- [ ] Move, delete, or trash a message if the backend route is available.
- [ ] Refresh again.
- [ ] Verify the action persists.
- [ ] Confirm Starred is not presented as a usable folder until CORE-J is complete.

## 10. Search

- [ ] Search for the unique subject used in this smoke run.
- [ ] Verify matching rows appear.
- [ ] Open a search result.
- [ ] Verify the message opens normally.
- [ ] Search for a term that should not exist.
- [ ] Verify the empty state is clear.
- [ ] If exactly 50 results appear, verify the "Refine your search" notice appears. This is expected until CORE-K is fixed.

## 11. Network And Send Feedback

- [ ] Confirm a healthy network check enables Send.
- [ ] Block or fail `/raida/echo` if a safe test method is available.
- [ ] Verify warning and retry behavior appears.
- [ ] Verify send-anyway override behaves according to the current product decision.
- [ ] Verify Send buttons are disabled during immediate post-click debounce.
- [ ] Verify flaky-network retry messaging is visible and understandable.
- [ ] Verify persistent send failure remains visible after closing and reopening compose.
- [ ] Confirm no "Parity Server" wording appears.
- [ ] Confirm detailed send-progress stages are not expected until CORE-E / FIX-26 is complete.

## 12. Refresh And Notifications

- [ ] Trigger a manual refresh.
- [ ] Verify refresh covers beacon ping.
- [ ] Verify refresh covers echo.
- [ ] Verify refresh covers notifications.
- [ ] Verify refresh covers mailbox counts.
- [ ] Verify refresh covers the message list.
- [ ] Verify only one spinner appears during refresh.
- [ ] Verify unified notifications are used.
- [ ] Verify pending-mail toast focuses or opens the matching row.
- [ ] Verify pending-mail manual decrypt behavior matches the current product decision.

## 13. Account And Navigation

- [ ] Verify AccountPane identity card renders correctly.
- [ ] Verify AccountPane balance card renders correctly.
- [ ] Verify AccountPane has no broken or raw CSS classes visible.
- [ ] Verify default folder icons render.
- [ ] Verify AccountPane Server Details either shows all 25 servers or is absent.
- [ ] Navigate through primary folders and panes.
- [ ] Verify there are no blank pages, stuck spinners, or obvious layout overlaps.

## 14. Expected Backend Gaps To Classify Carefully

- [ ] CORE-A: Sent folder persistence may still be incomplete.
- [ ] CORE-E / FIX-26: Detailed send-progress stages may not be exposed by the backend.
- [ ] CORE-H / FIX-23: Draft source cleanup and `deleteDraft` behavior may still be incomplete.
- [ ] CORE-J / FIX-18: Starred filter is backend-blocked.
- [ ] CORE-K / BUG-46: Search pagination beyond the current backend cap is unavailable.
- [ ] CORE-L: Draft recipient detail may be incomplete.
- [ ] CORE-M: Attachment paths containing commas or semicolons are rejected by the GUI.
- [ ] CORE-N: Draft attachment persistence may be incomplete.

## 15. Failure Logging

For each failure, record:

- [ ] Failure ID:
- [ ] Client: client1 / client2 / both
- [ ] Steps:
- [ ] Expected:
- [ ] Actual:
- [ ] Screenshot or log path:
- [ ] Backend-blocked: yes / no / unknown
- [ ] Follow-up file updated if needed:
  - Backend ambiguity or backend task: `docs\opu.note-to-backend.txt`
  - Out-of-scope GUI bug: `docs\gpt.bugs.txt`
  - Smoke result log: `E:\QMail-Smoke\<date>\results\smoke-results.md`

