# Backlog ticket — `/api/system/theme` spec/code reconciliation

Track C deliverable. Compares the PHP reference spec at
`D:/Code/src/PHP/cloudcoin.org-main/commands/system-theme.php` to the
C implementation at
`D:/Code/src/C/rest_core/api_src/api_handlers_system.c` (function
`api_handle_system_theme`, lines 964–1048).

Five discrepancies were called out in `opu.theme.plan.txt` §8. Re-audit
on 2026-05-23 found that **two are already resolved in the C code**
and **two are real and small**. The fifth was always informational.
One additional inconsistency surfaced during the re-audit.

The GUI's `themeService.js` already accepts both spec and legacy
response shapes (with a one-time `console.warn` on legacy), so none of
these block the GUI. They are quality-of-life fixes that let the
defensive shim be removed cleanly.

---

## Severity ladder

| Sub-task | Severity   | What it changes                              |
| -------- | ---------- | -------------------------------------------- |
| D1       | none       | Storage path — informational only            |
| D2       | major      | GET creates default stub when file missing   |
| D3       | **already resolved** — code emits `command` + `success` |
| D4       | minor      | Oversize POST returns 413, not 400           |
| D5       | none       | DELETE 404 — already correct                 |
| D6       | minor      | DELETE behaviour leaves an empty file (new)  |

## Sequencing recommendation

D2 and D4 are the only behavioural fixes. They are isolated; either
order is fine, and they can ship in one commit. D6 is a polish item
that touches the same handler — bundle it with D2.

D1 / D3 / D5 are "no action" sub-tasks; close them as already-resolved
or out-of-scope after the team confirms.

---

## D1 — Storage path is informational

**Title:** Theme handler storage path — informational only

**Severity:** none (no code change)

**Spec says (line 87 of `system-theme.php`):**

> The `/api/system/theme` endpoint manages the custom theme configuration
> file stored at `Data/Themes/custom_theme.txt`.

**C code today** (`api_handlers_system.c` :968–974):

```c
char theme_dir[MAX_PATH_LEN];
snprintf(theme_dir, sizeof(theme_dir), "%s%sThemes",
         g_config.client_data_path, PATH_SEPARATOR_STR);

char theme_path[MAX_PATH_LEN];
snprintf(theme_path, sizeof(theme_path), "%s%scustom_theme.txt",
         theme_dir, PATH_SEPARATOR_STR);
```

`g_config.client_data_path` is wherever the runtime config points
(typically `Data/Wallets` based on the `client_data_path` config var).
The spec's `Data/Themes/` is shorthand for "under the data root, in a
Themes subdir" — which is what the C code does. The two paths coincide
in practice when `client_data_path` is `Data`.

**Action:** none required. If the C team wants to align the spec's
wording with the config variable name, that's a doc tweak in the PHP
file. The GUI never sees the absolute path.

---

## D2 — GET should create the default stub when the file is missing

**Title:** Theme handler — GET creates default stub on first read

**Severity:** major (GUI semantics depend on it)

**Spec says (line 176 of `system-theme.php`):**

```json
{
  "command": "system-theme",
  "success": true,
  "file":    "custom_theme.txt",
  "path":    "Data/Themes/custom_theme.txt",
  "content": "# Custom Theme Configuration\n# Add your theme settings here\n",
  "size":    68,
  "exists":  false
}
```

That is: on first GET, the server creates a 68-byte stub file with
that exact text, returns it as `content`, and signals `exists: false`
to indicate "this is freshly created — show first-run defaults to the
user".

**C code today** (`api_handlers_system.c` :1027–1046):

```c
// GET: read theme
FILE *fp = fopen(theme_path, "r");
bool exists = (fp != NULL);
char content[8192] = "";
int size = 0;

if (fp) {
    size = (int)fread(content, 1, sizeof(content) - 1, fp);
    content[size] = '\0';
    fclose(fp);
}

json_builder_t jb;
json_success_response(&jb, "theme");
json_add_bool(&jb, "exists", exists);
json_add_int(&jb, "size", size);
json_add_string(&jb, "content", content);
json_object_end(&jb);
```

If the file is missing, `exists:false`, `size:0`, `content:""` — no
stub is created.

**Exact change required** (insert just before the existing read block):

```c
// GET: ensure the theme file exists by writing the default stub on
// first read. The spec requires this so subsequent GETs return a
// stable file. exists:false continues to mean "freshly-created stub
// — show first-run defaults to the user".
static const char THEME_DEFAULT_STUB[] =
    "# Custom Theme Configuration\n# Add your theme settings here\n";

bool created_stub = false;
if (!file_exists(theme_path)) {
    create_directory_recursive(theme_dir);
    FILE *seed = fopen(theme_path, "wb");
    if (seed) {
        fwrite(THEME_DEFAULT_STUB, 1, sizeof(THEME_DEFAULT_STUB) - 1, seed);
        fclose(seed);
        created_stub = true;
    }
}

// existing read block continues:
FILE *fp = fopen(theme_path, "r");
bool exists = (fp != NULL) && !created_stub;  // ← was: (fp != NULL)
char content[8192] = "";
int size = 0;
/* ... rest unchanged ... */
```

The only call-site change in the existing block is the assignment to
`exists`: `exists` now means "user has saved a real theme", not "a
file exists on disk". When `created_stub` is true, we read back the
stub content so the JSON `content` field carries the 68-byte default —
matching the spec.

**Rationale:** the GUI's `ThemeProvider` reads `exists:false` as "no
saved custom theme — fall back to base". If the server permanently
returns `exists:false` (no file ever created), the GUI can't tell
"first run" from "the file got deleted between sessions". With the
stub, the file always exists after the first GET, and `exists:false`
unambiguously means "fresh / show defaults".

**Test plan:**

```bash
# Delete the stub if present
rm -f $CLIENT_DATA_PATH/Themes/custom_theme.txt

# First GET creates the stub and returns exists:false
curl -s http://127.0.0.1:8080/api/system/theme | jq .
# Expect: { "command": "theme", "success": true,
#          "exists": false, "size": 60, "content": "# Custom Theme..." }

# File now exists on disk
test -f $CLIENT_DATA_PATH/Themes/custom_theme.txt && echo "stub created"

# Subsequent GET returns same content (still exists:false because user
# hasn't saved yet)
curl -s http://127.0.0.1:8080/api/system/theme | jq .

# After a POST, exists:true
curl -s -X POST http://127.0.0.1:8080/api/system/theme \
  -H 'content-type: application/json' \
  -d '{"schema":"qmail-theme/1","base":"dark","tokens":{"--accent-primary":"#22c55e"}}'
curl -s http://127.0.0.1:8080/api/system/theme | jq '.exists'
# Expect: true
```

---

## D3 — Response field names — already resolved

**Title:** Theme handler response envelope — already spec-conformant

**Severity:** none (no code change)

**Spec says:** every endpoint response is `{ command, success, ... }`
(plus per-endpoint fields).

**C code today** (`simple_json.c` :223–228, called from every theme
handler branch):

```c
void json_success_response(json_builder_t* jb, const char* command) {
    json_init(jb);
    json_object_begin(jb);
    json_add_string(jb, "command", command);
    json_add_bool(jb, "success", true);
}
```

The plan's §8 description (`{ status, ... }`) was stale — the helper
was upgraded to emit both `command` and `success:true` before the
plan was written. Every theme handler branch (POST/DELETE/GET) calls
`json_success_response(&jb, "theme")` and is automatically
spec-conformant.

**Action:** no code change. Close as already-resolved. The GUI's
`themeService.js` carries a defensive shim that accepts the legacy
`{ status: "success" }` shape too, so if any *other* endpoint still
emits the old shape, the GUI will still parse it but emit a one-time
`console.warn`. That shim can be removed in a future cleanup once
nothing in the C codebase still uses the old shape; an audit script
could grep for any `json_add_string(jb, "status", "success")` to find
strays.

---

## D4 — Oversize POST should return HTTP 413

**Title:** Theme handler POST — oversize returns 413, not 400

**Severity:** minor (cosmetic; GUI handles either status)

**Spec says (line 191 + line 321 of `system-theme.php`):**

> The theme file has a maximum size limit of 8 KB (8,192 bytes).
> Requests exceeding this limit will be rejected with HTTP 413
> (Payload Too Large).

**C code today** (`api_handlers_system.c` :982–984):

```c
if (request->body_length > 8192) {
    json_error_response_from_string(response, "Theme too large (max 8192 bytes)", 400);
    return;
}
```

Returns 400, not 413.

**Exact change required:**

```c
if (request->body_length > 8192) {
    json_error_response_from_string(response, "Theme too large (max 8192 bytes)", 413);
    return;
}
```

One character. The error message text is fine as-is.

**Rationale:** the GUI's `saveUserTheme` already detects oversize on
either HTTP 413 (spec) or HTTP 400 with `/too large/i` in the message
(legacy). Fixing the status code lets the legacy `if (response.status
=== 400 && /too large/i.test(msg))` branch be removed cleanly.

**Test plan:**

```bash
# Generate a >8192-byte body
python -c 'import json; print(json.dumps({"schema":"qmail-theme/1","base":"dark","tokens":{"--x":"a"*9000}}))' \
  | curl -s -o /dev/null -w '%{http_code}\n' \
    -X POST http://127.0.0.1:8080/api/system/theme \
    -H 'content-type: application/json' \
    --data-binary @-
# Expect: 413
```

---

## D5 — DELETE of a missing file returns 404 — already correct

**Title:** Theme handler DELETE — 404 on missing file matches spec

**Severity:** none

**Spec says:** DELETE on a missing file returns HTTP 404 with message
"Theme file does not exist".

**C code today** (`api_handlers_system.c` :1007–1010):

```c
if (!file_exists(theme_path)) {
    json_error_response_from_string(response, "Theme file does not exist", 404);
    return;
}
```

Matches the spec byte-for-byte (status, message text).

**Action:** none. Close as already-resolved.

---

## D6 — DELETE leaves an empty file instead of removing it (new finding)

**Title:** Theme handler DELETE — should remove the file, not truncate

**Severity:** minor (only matters together with D2)

**Spec implies** (the DELETE endpoint description, lines around 299):
DELETE removes the user's saved theme. Combined with D2 (next GET
creates the stub) this gives a clean "back to defaults" cycle.

**C code today** (`api_handlers_system.c` :1005–1023):

```c
} else if (strcmp(request->method, "DELETE") == 0) {
    // DELETE: clear theme file contents (keep file, reset to empty)
    if (!file_exists(theme_path)) {
        json_error_response_from_string(response, "Theme file does not exist", 404);
        return;
    }

    FILE *fp = fopen(theme_path, "wb");   // ← truncates to zero bytes
    if (!fp) {
        json_error_response_from_string(response, "Failed to clear theme file", 500);
        return;
    }
    fclose(fp);
    /* ... */
}
```

After DELETE, the file exists on disk at 0 bytes. The next GET (under
the current code, before D2 ships) returns `exists:true, size:0,
content:""` — which the GUI reads as "user has a saved theme that
happens to be empty" rather than "no saved theme". Not catastrophic,
but inconsistent with the "clean slate" intent.

**Exact change required:** replace the truncate with an unlink, and
update the comment.

```c
} else if (strcmp(request->method, "DELETE") == 0) {
    // DELETE: remove the theme file. Subsequent GET will see no file
    // and re-create the default stub (matches D2).
    if (!file_exists(theme_path)) {
        json_error_response_from_string(response, "Theme file does not exist", 404);
        return;
    }

    if (remove(theme_path) != 0) {
        json_error_response_from_string(response, "Failed to remove theme file", 500);
        return;
    }
    /* response envelope unchanged */
}
```

`remove()` is in `<stdio.h>` which is already included.

**Rationale:** with D2's stub-on-GET in place, DELETE-then-GET should
result in `{ exists:false, content:"<stub>" }`. That requires DELETE
to actually remove the file rather than truncate it.

**Sequencing:** bundle with D2. D6 alone (without D2) leaves DELETE
incompatible with the spec's "next GET sees the stub" behaviour
because there's no stub yet.

**Test plan:**

```bash
# After D2 ships and the stub exists from a prior GET:
curl -s -X DELETE http://127.0.0.1:8080/api/system/theme
test ! -f $CLIENT_DATA_PATH/Themes/custom_theme.txt && echo "file removed"

# Next GET re-creates the stub
curl -s http://127.0.0.1:8080/api/system/theme | jq '.exists, .content'
# Expect: false, "# Custom Theme Configuration..."
```

---

## After the C fixes ship

When D2 + D4 + D6 land, the GUI's `themeService.js` carries two
compatibility shims that can be removed in a follow-up:

1. `extractMessage` for `{ status: "success" }` legacy shape (D3, already
   safe to remove if `json_success_response` is the only success-emit
   path across the C codebase).
2. `if (response.status === 400 && /too large/i.test(msg))` (D4).

The shims emit one-time `console.warn`s when they fire, so the C-team
can watch the GUI console during integration testing to confirm
nothing exercises the legacy paths anymore.

## Source citations

- PHP spec: `D:/Code/src/PHP/cloudcoin.org-main/commands/system-theme.php`
- C handler: `D:/Code/src/C/rest_core/api_src/api_handlers_system.c` :964–1048
- JSON envelope helper: `D:/Code/src/C/rest_core/api_src/simple_json.c` :223
- GUI parser: `D:/Code/src/JavaScript/Qmail-GUI/src/api/themeService.js`
- GUI parser tests (30): `D:/Code/src/JavaScript/Qmail-GUI/src/api/themeService.test.js`

---

## Related

- `docs/opu.theme.plan.txt` §8 — the original discrepancy list (now
  partially stale; D3 was already resolved by the time this audit ran).
- `docs/opu.theme.handoff.txt` G8/G9 — handoff notes on the GUI's
  defensive behaviour around these discrepancies.
- `docs/theme.custom-format.md` — the JSON file format the C side
  stores opaquely.
