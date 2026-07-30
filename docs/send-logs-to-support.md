# Help → Send Logs To Support

## User flow

1. **Help → Send Logs To Support**
2. Confirm dialog (privacy notice)
3. Core builds `Client_Data/Zipped Logs/ForSupport.*.zip` (this backend instance’s port)
4. GUI attaches the zip and calls `/api/qmail/net/messages/upload_and_tell` to **`20.123@giga`**
5. Persist `task_id` in localStorage under a key scoped to this backend port;
   poll until core reports a **terminal** task status
   (connectivity loss is indeterminate — keep polling / block new sends;
   repeated HTTP 404 means the old task no longer exists and releases the stale record)
6. Outcome (ZIP is **always kept** under `Client_Data/Zipped Logs` for retry/troubleshooting):
   - **full**: `isFinished` + `isSuccessful` + `all_accepted===true` + zero failures/retries
   - **partial**: explicit incomplete delivery fields
   - **indeterminate**: missing delivery fields or unresolved status
   - **failed** / missing `task_id`: error toast

## Code map

| Piece | Location |
|-------|----------|
| Menu + confirm | `electron.cjs` Help submenu |
| IPC command | `send-logs-to-support` → `qmail:menu-command` |
| Handler | `QMailDashboard.jsx` → `handleSendLogsToSupport` |
| Pure rules | `src/qmail/supportLogsFlow.js` |
| Zip + send + poll | `qmailApiServices.createSupportZip` / `sendSupportLogs` / `pollSupportSendUntilTerminal` (same `API_BASE_URL` / `?backendPort=` as all QMail APIs) |
| Support address | `src/qmail/supportConstants.js` |

## Server-side (not GUI)

Free delivery / whitelist for `20.123@giga` is configured on the RAIDA/QMail servers.

## Core dependency

Requires a core build with practical support-zip (`full_path` under Client_Data). Core default branch is `main`.
