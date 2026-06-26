/**
 * qmail_db.c - SQLite Database Layer for QMail
 *
 * Persistent storage for emails, contacts, tells, sent tracking, and servers.
 * Uses SQLite amalgamation with WAL journal mode and FTS5 full-text search.
 */

#include "qmail/qmail_db.h"
#include "logging.h"
#include "sqlite3.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

// ============================================================================
// STATIC STATE
// ============================================================================

static sqlite3 *s_db = NULL;

// ============================================================================
// SCHEMA SQL
// ============================================================================

static const char *SCHEMA_SQL =
    "PRAGMA journal_mode=WAL;"
    "PRAGMA foreign_keys=ON;"

    "CREATE TABLE IF NOT EXISTS qmail_contacts ("
    "  serial_number INTEGER PRIMARY KEY,"
    "  denomination INTEGER,"
    "  custom_sn INTEGER,"
    "  first_name TEXT,"
    "  last_name TEXT,"
    "  auto_address TEXT UNIQUE,"
    "  description TEXT,"
    "  class_name TEXT,"
    "  beacon_raida INTEGER DEFAULT 11,"
    "  secondary_beacon_raida INTEGER DEFAULT 14,"
    "  inbox_fee INTEGER DEFAULT 0,"
    "  is_favorite INTEGER DEFAULT 0,"
    "  trust_level INTEGER DEFAULT 0,"
    "  user_notes TEXT,"
    "  send_count INTEGER DEFAULT 0,"
    "  last_sent_at INTEGER DEFAULT 0,"
    "  created_at INTEGER,"
    "  updated_at INTEGER"
    ");"

    "CREATE TABLE IF NOT EXISTS qmail_emails ("
    "  email_id BLOB PRIMARY KEY,"
    "  subject TEXT,"
    "  body TEXT,"
    "  received_timestamp INTEGER,"
    "  sent_timestamp INTEGER,"
    "  is_read INTEGER DEFAULT 0,"
    "  is_starred INTEGER DEFAULT 0,"
    "  is_trashed INTEGER DEFAULT 0,"
    "  folder INTEGER DEFAULT 0,"
    "  sender_sn INTEGER DEFAULT 0,"
    "  sender_denomination INTEGER DEFAULT 2,"
    "  inbox_fee INTEGER DEFAULT 0"
    ");"

    "CREATE VIRTUAL TABLE IF NOT EXISTS qmail_emails_fts USING fts5("
    "  subject, body,"
    "  content=qmail_emails,"
    "  content_rowid=rowid"
    ");"

    "CREATE TRIGGER IF NOT EXISTS qmail_emails_ai AFTER INSERT ON qmail_emails BEGIN"
    "  INSERT INTO qmail_emails_fts(rowid, subject, body)"
    "    VALUES (new.rowid, new.subject, new.body);"
    "END;"

    "CREATE TRIGGER IF NOT EXISTS qmail_emails_ad AFTER DELETE ON qmail_emails BEGIN"
    "  INSERT INTO qmail_emails_fts(qmail_emails_fts, rowid, subject, body)"
    "    VALUES ('delete', old.rowid, old.subject, old.body);"
    "END;"

    "CREATE TRIGGER IF NOT EXISTS qmail_emails_au AFTER UPDATE ON qmail_emails BEGIN"
    "  INSERT INTO qmail_emails_fts(qmail_emails_fts, rowid, subject, body)"
    "    VALUES ('delete', old.rowid, old.subject, old.body);"
    "  INSERT INTO qmail_emails_fts(rowid, subject, body)"
    "    VALUES (new.rowid, new.subject, new.body);"
    "END;"

    "CREATE TABLE IF NOT EXISTS qmail_email_contacts ("
    "  email_id BLOB,"
    "  serial_number INTEGER,"
    "  user_type INTEGER,"
    "  PRIMARY KEY (email_id, serial_number, user_type)"
    ");"

    "CREATE TABLE IF NOT EXISTS qmail_email_servers ("
    "  email_id BLOB,"
    "  server_raida_index INTEGER,"
    "  stripe_index INTEGER"
    ");"

    "CREATE TABLE IF NOT EXISTS qmail_attachments ("
    "  attachment_id INTEGER PRIMARY KEY AUTOINCREMENT,"
    "  email_id BLOB,"
    "  file_type INTEGER DEFAULT 0,"
    "  name TEXT,"
    "  extension TEXT,"
    "  storage_mode INTEGER,"
    "  data_blob BLOB,"
    "  file_path TEXT,"
    "  size_bytes INTEGER"
    ");"

    "CREATE TABLE IF NOT EXISTS qmail_received_tells ("
    "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
    "  file_guid BLOB UNIQUE,"
    "  locker_code BLOB,"
    "  sender_sn INTEGER,"
    "  sender_denomination INTEGER DEFAULT 2,"
    "  tell_type INTEGER,"
    "  server_list_json TEXT,"
    "  total_file_size INTEGER DEFAULT 0,"
    "  manifest_version INTEGER DEFAULT 0,"
    "  manifest_file_count INTEGER DEFAULT 0,"
    "  manifest_entry_size INTEGER DEFAULT 0,"
    "  manifest_len INTEGER DEFAULT 0,"
    "  manifest_flags INTEGER DEFAULT 0,"
    "  manifest_blob BLOB,"
    "  downloaded INTEGER DEFAULT 0,"
    "  is_trashed INTEGER DEFAULT 0,"
    "  read_status INTEGER DEFAULT 0,"
    "  payment_status INTEGER DEFAULT 0,"
    "  timestamp INTEGER"
    ");"

    "CREATE TABLE IF NOT EXISTS qmail_sent_emails ("
    "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
    "  file_guid BLOB UNIQUE,"
    "  subject TEXT,"
    "  recipients TEXT,"
    "  body_preview TEXT,"
    "  timestamp INTEGER"
    ");"

    "CREATE TABLE IF NOT EXISTS qmail_pending_tells ("
    "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
    "  file_guid BLOB,"
    "  recipient_sn INTEGER,"
    "  recipient_denomination INTEGER,"
    "  beacon_raida INTEGER,"
    "  tell_context_blob BLOB,"
    "  status TEXT DEFAULT 'pending',"
    "  retry_count INTEGER DEFAULT 0,"
    "  last_error TEXT,"
    "  created_at INTEGER,"
    "  last_attempt INTEGER"
    ");"

    "CREATE TABLE IF NOT EXISTS qmail_servers ("
    "  server_id INTEGER PRIMARY KEY,"
    "  raida_index INTEGER UNIQUE,"
    "  ip_address TEXT,"
    "  port INTEGER,"
    "  is_available INTEGER DEFAULT 1"
    ");"

    "CREATE TABLE IF NOT EXISTS qmail_locker_pool ("
    "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
    "  locker_key TEXT NOT NULL,"
    "  pool_type INTEGER NOT NULL,"
    "  funded_amount INTEGER NOT NULL,"
    "  status INTEGER DEFAULT 0,"
    "  created_at INTEGER,"
    "  consumed_at INTEGER,"
    /* file_guid: stamped on RESERVED rows so the Phase 8 reclamation
     * sweep can match a stuck inbox-fee locker back to a specific
     * email's receipt. Nullable for AVAILABLE pool entries. */
    "  file_guid BLOB"
    ");"

    "CREATE INDEX IF NOT EXISTS idx_locker_pool_avail"
    "  ON qmail_locker_pool(status, pool_type, funded_amount);";

// ============================================================================
// HELPERS
// ============================================================================

/** Copy a TEXT column into a fixed-size char buffer. */
static void copy_text_column(char *dest, size_t dest_size, sqlite3_stmt *stmt, int col) {
    const char *text = (const char *)sqlite3_column_text(stmt, col);
    if (text) {
        snprintf(dest, dest_size, "%s", text);
    } else {
        dest[0] = '\0';
    }
}

/** Copy a BLOB column into a fixed-size byte buffer. */
static void copy_blob_column(uint8_t *dest, size_t dest_size, sqlite3_stmt *stmt, int col) {
    const void *blob = sqlite3_column_blob(stmt, col);
    int blob_len = sqlite3_column_bytes(stmt, col);
    if (blob && blob_len > 0) {
        size_t n = (size_t)blob_len < dest_size ? (size_t)blob_len : dest_size;
        memcpy(dest, blob, n);
    } else {
        memset(dest, 0, dest_size);
    }
}

/** Read a contact row from a prepared statement. */
static void read_contact_row(sqlite3_stmt *stmt, qmail_contact_t *c) {
    memset(c, 0, sizeof(*c));
    c->serial_number = (uint32_t)sqlite3_column_int(stmt, 0);
    c->denomination  = (int8_t)sqlite3_column_int(stmt, 1);
    c->custom_sn     = (uint32_t)sqlite3_column_int(stmt, 2);
    copy_text_column(c->first_name,   sizeof(c->first_name),   stmt, 3);
    copy_text_column(c->last_name,    sizeof(c->last_name),    stmt, 4);
    copy_text_column(c->auto_address, sizeof(c->auto_address), stmt, 5);
    copy_text_column(c->description,  sizeof(c->description),  stmt, 6);
    copy_text_column(c->class_name,   sizeof(c->class_name),   stmt, 7);
    c->beacon_raida = (uint8_t)sqlite3_column_int(stmt, 8);
    c->is_favorite  = sqlite3_column_int(stmt, 9) != 0;
    c->created_at   = sqlite3_column_int64(stmt, 10);
    c->updated_at   = sqlite3_column_int64(stmt, 11);
    c->secondary_beacon_raida = (uint8_t)sqlite3_column_int(stmt, 12);
    c->inbox_fee = (uint32_t)sqlite3_column_int(stmt, 13);
    c->trust_level = (int8_t)sqlite3_column_int(stmt, 14);
    copy_text_column(c->user_notes, sizeof(c->user_notes), stmt, 15);
    /* New columns appended so existing positions don't shift. */
    c->send_count   = (uint32_t)sqlite3_column_int64(stmt, 16);
    c->last_sent_at = sqlite3_column_int64(stmt, 17);
}

/** Read an email row from a prepared statement (no recipients). */
static void read_email_row(sqlite3_stmt *stmt, qmail_email_t *e) {
    memset(e, 0, sizeof(*e));
    copy_blob_column(e->email_id, QMAIL_GUID_SIZE, stmt, 0);
    copy_text_column(e->subject, sizeof(e->subject), stmt, 1);

    /* Body is dynamically allocated */
    const char *body_text = (const char *)sqlite3_column_text(stmt, 2);
    if (body_text) {
        size_t len = strlen(body_text);
        e->body = malloc(len + 1);
        if (e->body) {
            memcpy(e->body, body_text, len + 1);
            e->body_len = len;
        }
    }

    e->received_timestamp = sqlite3_column_int64(stmt, 3);
    e->sent_timestamp     = sqlite3_column_int64(stmt, 4);
    e->is_read            = sqlite3_column_int(stmt, 5) != 0;
    e->is_starred         = sqlite3_column_int(stmt, 6) != 0;
    e->is_trashed         = sqlite3_column_int(stmt, 7) != 0;
    e->folder             = sqlite3_column_int(stmt, 8);
    e->sender_sn          = (uint32_t)sqlite3_column_int64(stmt, 9);
    e->sender_denomination = (uint8_t)sqlite3_column_int(stmt, 10);
    e->inbox_fee          = (uint32_t)sqlite3_column_int64(stmt, 11);
}

/** Load recipients for an email from qmail_email_contacts. */
static void load_email_recipients(qmail_email_t *e) {
    const char *sql =
        "SELECT serial_number, user_type FROM qmail_email_contacts WHERE email_id = ?";
    sqlite3_stmt *stmt = NULL;

    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) return;

    sqlite3_bind_blob(stmt, 1, e->email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    int count = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW && count < QMAIL_MAX_RECIPIENTS) {
        e->recipients[count].serial_number = (uint32_t)sqlite3_column_int(stmt, 0);
        e->recipients[count].recipient_type = (uint8_t)sqlite3_column_int(stmt, 1);
        count++;
    }
    e->recipient_count = count;
    sqlite3_finalize(stmt);
}

static void backfill_sent_folder_rows(void) {
    const char *sql =
        "INSERT OR IGNORE INTO qmail_emails"
        " (email_id, subject, body, received_timestamp, sent_timestamp,"
        "  is_read, is_starred, is_trashed, folder, sender_sn, sender_denomination, inbox_fee)"
        " SELECT file_guid, COALESCE(subject, ''), COALESCE(body_preview, ''),"
        "        COALESCE(timestamp, 0), COALESCE(timestamp, 0),"
        "        1, 0, 0, ?, 0, ?, 0"
        " FROM qmail_sent_emails"
        " WHERE file_guid IS NOT NULL";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_warn(LOG_CAT_GENERAL, "sent backfill prepare: %s", sqlite3_errmsg(s_db));
        return;
    }

    sqlite3_bind_int(stmt, 1, QMAIL_FOLDER_SENT);
    sqlite3_bind_int(stmt, 2, 2);
    rc = sqlite3_step(stmt);
    if (rc != SQLITE_DONE) {
        log_warn(LOG_CAT_GENERAL, "sent backfill step: %s", sqlite3_errmsg(s_db));
    }
    sqlite3_finalize(stmt);
}

// ============================================================================
// DATABASE LIFECYCLE
// ============================================================================

result_t qmail_db_open(const char *db_path) {
    if (s_db) {
        log_warn(LOG_CAT_GENERAL, "QMail DB already open");
        return RESULT_SUCCESS;
    }
    if (!db_path) return RESULT_INVALID_PARAM;

    int rc = sqlite3_open(db_path, &s_db);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "QMail DB open failed: %s", sqlite3_errmsg(s_db));
        sqlite3_close(s_db);
        s_db = NULL;
        return RESULT_FILE_ERROR;
    }

    char *err_msg = NULL;
    rc = sqlite3_exec(s_db, SCHEMA_SQL, NULL, NULL, &err_msg);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "QMail DB schema creation failed: %s", err_msg);
        sqlite3_free(err_msg);
        sqlite3_close(s_db);
        s_db = NULL;
        return RESULT_ERROR;
    }

    /* Migrations: add columns if missing (for pre-existing DBs).
     * ALTER TABLE ADD COLUMN silently fails if column already exists. */
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_contacts ADD COLUMN beacon_raida INTEGER DEFAULT 11",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_received_tells ADD COLUMN is_trashed INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_received_tells ADD COLUMN read_status INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_received_tells ADD COLUMN payment_status INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_received_tells ADD COLUMN sender_denomination INTEGER DEFAULT 2",
        NULL, NULL, NULL);
    /* Migration: add contact columns if missing */
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_contacts ADD COLUMN secondary_beacon_raida INTEGER DEFAULT 14;",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_contacts ADD COLUMN inbox_fee INTEGER DEFAULT 0;",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_emails ADD COLUMN sender_sn INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_emails ADD COLUMN sender_denomination INTEGER DEFAULT 2",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_emails ADD COLUMN inbox_fee INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_contacts ADD COLUMN trust_level INTEGER DEFAULT 0;",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_contacts ADD COLUMN user_notes TEXT;",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "UPDATE qmail_contacts"
        " SET beacon_raida = 11, secondary_beacon_raida = 14"
        " WHERE beacon_raida = 14"
        "   AND (secondary_beacon_raida IS NULL OR secondary_beacon_raida = 14)"
        "   AND (user_notes IS NULL OR user_notes = '')"
        "   AND (description IS NULL OR description = '')",
        NULL, NULL, NULL);
    /* Phase 1 popular-recipients tracking. Counter incremented per send;
     * last_sent_at is the unix ts of the most recent send to this SN.
     * Populated by qmail_db_contact_record_send. */
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_contacts ADD COLUMN send_count INTEGER DEFAULT 0;",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_contacts ADD COLUMN last_sent_at INTEGER DEFAULT 0;",
        NULL, NULL, NULL);
    /* Phase 2 hardening: stamp pool RESERVE rows with the file_guid
     * they were acquired for. Required to support split-commit (storage
     * confirmed at /upload time, inbox-fee committed at /tell time)
     * and the Phase 8 reclamation sweep. Old AVAILABLE rows have NULL. */
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_locker_pool ADD COLUMN file_guid BLOB",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_attachments ADD COLUMN file_type INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_received_tells ADD COLUMN manifest_version INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_received_tells ADD COLUMN manifest_file_count INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_received_tells ADD COLUMN manifest_entry_size INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_received_tells ADD COLUMN manifest_len INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_received_tells ADD COLUMN manifest_flags INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(s_db,
        "ALTER TABLE qmail_received_tells ADD COLUMN manifest_blob BLOB",
        NULL, NULL, NULL);

    backfill_sent_folder_rows();

    log_info(LOG_CAT_GENERAL, "QMail DB opened: %s", db_path);
    return RESULT_SUCCESS;
}

void qmail_db_close(void) {
    if (s_db) {
        sqlite3_close(s_db);
        s_db = NULL;
        log_info(LOG_CAT_GENERAL, "QMail DB closed");
    }
}

bool qmail_db_is_open(void) {
    return s_db != NULL;
}

// ============================================================================
// CONTACT CRUD
// ============================================================================

result_t qmail_db_contact_add(const qmail_contact_t *contact) {
    if (!s_db || !contact) return RESULT_INVALID_PARAM;

    /* send_count/last_sent_at are owned by qmail_db_contact_record_send;
     * preserve any existing values on INSERT OR REPLACE so a re-add does
     * not zero them out. The COALESCE subquery returns 0 for new SNs. */
    const char *sql =
        "INSERT OR REPLACE INTO qmail_contacts"
        " (serial_number, denomination, custom_sn, first_name, last_name,"
        "  auto_address, description, class_name, beacon_raida, is_favorite,"
        "  created_at, updated_at, secondary_beacon_raida, inbox_fee,"
        "  trust_level, user_notes, send_count, last_sent_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,"
        "         COALESCE((SELECT send_count   FROM qmail_contacts WHERE serial_number = ?), 0),"
        "         COALESCE((SELECT last_sent_at FROM qmail_contacts WHERE serial_number = ?), 0))";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "contact_add prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_int64(stmt, 1, (int64_t)contact->serial_number);
    sqlite3_bind_int(stmt, 2, contact->denomination);
    sqlite3_bind_int64(stmt, 3, (int64_t)contact->custom_sn);
    sqlite3_bind_text(stmt, 4, contact->first_name, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 5, contact->last_name, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 6, contact->auto_address, -1, SQLITE_STATIC);
    if (contact->description[0] == '\0') {
        sqlite3_bind_null(stmt, 7);
    } else {
        sqlite3_bind_text(stmt, 7, contact->description, -1, SQLITE_STATIC);
    }
    sqlite3_bind_text(stmt, 8, contact->class_name, -1, SQLITE_STATIC);
    sqlite3_bind_int(stmt, 9, (int)contact->beacon_raida);
    sqlite3_bind_int(stmt, 10, contact->is_favorite ? 1 : 0);
    sqlite3_bind_int64(stmt, 11, contact->created_at);
    sqlite3_bind_int64(stmt, 12, contact->updated_at);
    sqlite3_bind_int(stmt, 13, (int)contact->secondary_beacon_raida);
    sqlite3_bind_int64(stmt, 14, (int64_t)contact->inbox_fee);
    sqlite3_bind_int(stmt, 15, (int)contact->trust_level);
    if (contact->user_notes[0] == '\0') {
        sqlite3_bind_null(stmt, 16);
    } else {
        sqlite3_bind_text(stmt, 16, contact->user_notes, -1, SQLITE_STATIC);
    }
    /* Subquery binds for the COALESCE lookups (same SN, twice). */
    sqlite3_bind_int64(stmt, 17, (int64_t)contact->serial_number);
    sqlite3_bind_int64(stmt, 18, (int64_t)contact->serial_number);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "contact_add step: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    return RESULT_SUCCESS;
}

/**
 * Sync a contact from the RAIDA directory (smart merge).
 *
 * If the contact does NOT exist: inserts it with all RAIDA-sourced fields,
 * setting first_name/last_name/description from RAIDA data.
 *
 * If the contact ALREADY exists: updates only RAIDA-owned fields
 * (auto_address, denomination, class_name, beacon_raida, secondary_beacon_raida,
 * inbox_fee, updated_at) and fills in first_name/last_name/description ONLY
 * if the existing DB value is NULL or empty (does not overwrite user edits).
 *
 * Never touches: is_favorite, trust_level, user_notes.
 */
result_t qmail_db_contact_sync(const qmail_contact_t *contact) {
    if (!s_db || !contact) return RESULT_INVALID_PARAM;

    /* Check if the contact already exists */
    qmail_contact_t existing;
    memset(&existing, 0, sizeof(existing));
    result_t exists = qmail_db_contact_get(contact->serial_number, &existing);

    if (exists == RESULT_NOT_FOUND) {
        /* New contact — insert with all RAIDA-sourced data */
        return qmail_db_contact_add(contact);
    }

    if (exists != RESULT_SUCCESS) {
        return exists;  /* DB error */
    }

    /* Existing contact — update only RAIDA-owned fields, preserve user edits */
    const char *sql =
        "UPDATE qmail_contacts SET"
        " denomination = ?, custom_sn = ?, auto_address = ?,"
        " class_name = ?, beacon_raida = ?, secondary_beacon_raida = ?,"
        " inbox_fee = ?, updated_at = ?,"
        " first_name = CASE WHEN first_name IS NULL OR first_name = '' THEN ? ELSE first_name END,"
        " last_name = CASE WHEN last_name IS NULL OR last_name = '' THEN ? ELSE last_name END,"
        " description = CASE WHEN description IS NULL OR description = '' THEN ? ELSE description END"
        " WHERE serial_number = ?";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "contact_sync prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    /* RAIDA-owned fields (always overwritten) */
    sqlite3_bind_int(stmt, 1, contact->denomination);
    sqlite3_bind_int64(stmt, 2, (int64_t)contact->custom_sn);
    sqlite3_bind_text(stmt, 3, contact->auto_address, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 4, contact->class_name, -1, SQLITE_STATIC);
    sqlite3_bind_int(stmt, 5, (int)contact->beacon_raida);
    sqlite3_bind_int(stmt, 6, (int)contact->secondary_beacon_raida);
    sqlite3_bind_int64(stmt, 7, (int64_t)contact->inbox_fee);
    sqlite3_bind_int64(stmt, 8, contact->updated_at);

    /* Names/description: only fill if existing is NULL/empty */
    if (contact->first_name[0] != '\0') {
        sqlite3_bind_text(stmt, 9, contact->first_name, -1, SQLITE_STATIC);
    } else {
        sqlite3_bind_null(stmt, 9);
    }
    if (contact->last_name[0] != '\0') {
        sqlite3_bind_text(stmt, 10, contact->last_name, -1, SQLITE_STATIC);
    } else {
        sqlite3_bind_null(stmt, 10);
    }
    if (contact->description[0] != '\0') {
        sqlite3_bind_text(stmt, 11, contact->description, -1, SQLITE_STATIC);
    } else {
        sqlite3_bind_null(stmt, 11);
    }

    /* WHERE clause */
    sqlite3_bind_int64(stmt, 12, (int64_t)contact->serial_number);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "contact_sync step: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    return RESULT_SUCCESS;
}

result_t qmail_db_contact_get(uint32_t serial_number, qmail_contact_t *contact_out) {
    if (!s_db || !contact_out) return RESULT_INVALID_PARAM;

    const char *sql =
        "SELECT serial_number, denomination, custom_sn, first_name, last_name,"
        " auto_address, description, class_name, beacon_raida, is_favorite, created_at, updated_at, secondary_beacon_raida, inbox_fee, trust_level, user_notes,"
        " send_count, last_sent_at"
        " FROM qmail_contacts WHERE serial_number = ?";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "contact_get prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_int64(stmt, 1, (int64_t)serial_number);
    rc = sqlite3_step(stmt);

    if (rc == SQLITE_ROW) {
        read_contact_row(stmt, contact_out);
        sqlite3_finalize(stmt);
        return RESULT_SUCCESS;
    }

    sqlite3_finalize(stmt);
    return RESULT_NOT_FOUND;
}

result_t qmail_db_contact_get_by_address(const char *address, qmail_contact_t *contact_out) {
    if (!s_db || !address || !contact_out) return RESULT_INVALID_PARAM;

    const char *sql =
        "SELECT serial_number, denomination, custom_sn, first_name, last_name,"
        " auto_address, description, class_name, beacon_raida, is_favorite, created_at, updated_at, secondary_beacon_raida, inbox_fee, trust_level, user_notes,"
        " send_count, last_sent_at"
        " FROM qmail_contacts WHERE auto_address = ?";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "contact_get_by_address prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_text(stmt, 1, address, -1, SQLITE_STATIC);
    rc = sqlite3_step(stmt);

    if (rc == SQLITE_ROW) {
        read_contact_row(stmt, contact_out);
        sqlite3_finalize(stmt);
        return RESULT_SUCCESS;
    }

    sqlite3_finalize(stmt);
    return RESULT_NOT_FOUND;
}

result_t qmail_db_contact_delete(uint32_t serial_number) {
    if (!s_db) return RESULT_INVALID_PARAM;

    const char *sql = "DELETE FROM qmail_contacts WHERE serial_number = ?";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "contact_delete prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_int64(stmt, 1, (int64_t)serial_number);
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "contact_delete step: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    if (sqlite3_changes(s_db) == 0) {
        return RESULT_NOT_FOUND;
    }
    return RESULT_SUCCESS;
}

result_t qmail_db_contact_list(qmail_contact_t **contacts_out, int *count_out) {
    if (!s_db || !contacts_out || !count_out) return RESULT_INVALID_PARAM;

    *contacts_out = NULL;
    *count_out = 0;

    /* First get the count */
    const char *count_sql = "SELECT COUNT(*) FROM qmail_contacts";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, count_sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "contact_list count prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    int total = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        total = sqlite3_column_int(stmt, 0);
    }
    sqlite3_finalize(stmt);

    if (total == 0) return RESULT_SUCCESS;

    qmail_contact_t *list = malloc((size_t)total * sizeof(qmail_contact_t));
    if (!list) {
        log_error(LOG_CAT_GENERAL, "contact_list malloc failed");
        return RESULT_MEMORY_ERROR;
    }

    const char *sql =
        "SELECT serial_number, denomination, custom_sn, first_name, last_name,"
        " auto_address, description, class_name, beacon_raida, is_favorite, created_at, updated_at, secondary_beacon_raida, inbox_fee, trust_level, user_notes,"
        " send_count, last_sent_at"
        " FROM qmail_contacts ORDER BY last_name, first_name";

    rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "contact_list prepare: %s", sqlite3_errmsg(s_db));
        free(list);
        return RESULT_ERROR;
    }

    int idx = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW && idx < total) {
        read_contact_row(stmt, &list[idx]);
        idx++;
    }
    sqlite3_finalize(stmt);

    *contacts_out = list;
    *count_out = idx;
    return RESULT_SUCCESS;
}

void qmail_db_contact_list_free(qmail_contact_t *contacts, int count) {
    (void)count;
    free(contacts);
}

result_t qmail_db_contact_record_send(uint32_t serial_number,
                                       int8_t denomination,
                                       const char *auto_address,
                                       int64_t sent_at) {
    if (!s_db || serial_number == 0) return RESULT_INVALID_PARAM;

    /* Try to bump the counter on an existing row first. */
    const char *update_sql =
        "UPDATE qmail_contacts"
        " SET send_count = send_count + 1, last_sent_at = ?"
        " WHERE serial_number = ?";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, update_sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "contact_record_send update prepare: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    sqlite3_bind_int64(stmt, 1, sent_at);
    sqlite3_bind_int64(stmt, 2, (int64_t)serial_number);
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "contact_record_send update step: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    if (sqlite3_changes(s_db) > 0) {
        return RESULT_SUCCESS;
    }

    /* Row didn't exist — insert a stub so this recipient shows up in the
     * contact list / popular query from now on. Names/description blank;
     * the user can fill them in later. INSERT OR IGNORE protects against
     * a race where another writer (e.g. contact_sync) inserts the same SN
     * between our UPDATE and INSERT. */
    const char *insert_sql =
        "INSERT OR IGNORE INTO qmail_contacts"
        " (serial_number, denomination, auto_address,"
        "  beacon_raida, secondary_beacon_raida,"
        "  send_count, last_sent_at, created_at, updated_at)"
        " VALUES (?, ?, ?, 11, 14, 1, ?, ?, ?)";

    rc = sqlite3_prepare_v2(s_db, insert_sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "contact_record_send insert prepare: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    sqlite3_bind_int64(stmt, 1, (int64_t)serial_number);
    sqlite3_bind_int(stmt, 2, (int)denomination);
    if (auto_address && auto_address[0]) {
        sqlite3_bind_text(stmt, 3, auto_address, -1, SQLITE_STATIC);
    } else {
        sqlite3_bind_null(stmt, 3);
    }
    sqlite3_bind_int64(stmt, 4, sent_at);   /* last_sent_at */
    sqlite3_bind_int64(stmt, 5, sent_at);   /* created_at */
    sqlite3_bind_int64(stmt, 6, sent_at);   /* updated_at */
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "contact_record_send insert step: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    /* If INSERT OR IGNORE found a race-inserted row, retry the UPDATE so
     * the counter still goes up for this send. */
    if (sqlite3_changes(s_db) == 0) {
        rc = sqlite3_prepare_v2(s_db, update_sql, -1, &stmt, NULL);
        if (rc == SQLITE_OK) {
            sqlite3_bind_int64(stmt, 1, sent_at);
            sqlite3_bind_int64(stmt, 2, (int64_t)serial_number);
            sqlite3_step(stmt);
            sqlite3_finalize(stmt);
        }
    }
    return RESULT_SUCCESS;
}

result_t qmail_db_contact_set_favorite(uint32_t serial_number, bool is_favorite) {
    if (!s_db || serial_number == 0) return RESULT_INVALID_PARAM;

    const char *sql =
        "UPDATE qmail_contacts"
        " SET is_favorite = ?, updated_at = ?"
        " WHERE serial_number = ?";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "contact_set_favorite prepare: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    sqlite3_bind_int(stmt, 1, is_favorite ? 1 : 0);
    sqlite3_bind_int64(stmt, 2, (int64_t)time(NULL));
    sqlite3_bind_int64(stmt, 3, (int64_t)serial_number);
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "contact_set_favorite step: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    if (sqlite3_changes(s_db) == 0) {
        return RESULT_NOT_FOUND;
    }
    return RESULT_SUCCESS;
}

result_t qmail_db_contact_list_popular(int limit,
                                        qmail_contact_t **contacts_out,
                                        int *count_out) {
    if (!s_db || !contacts_out || !count_out || limit <= 0) {
        return RESULT_INVALID_PARAM;
    }

    *contacts_out = NULL;
    *count_out = 0;

    /* Order: favorites first, then most-emailed, then most-recently-emailed,
     * then most-recently-updated as a tie-breaker for contacts that were
     * added but never sent to (send_count = 0, last_sent_at = 0). */
    const char *sql =
        "SELECT serial_number, denomination, custom_sn, first_name, last_name,"
        " auto_address, description, class_name, beacon_raida, is_favorite,"
        " created_at, updated_at, secondary_beacon_raida, inbox_fee,"
        " trust_level, user_notes, send_count, last_sent_at"
        " FROM qmail_contacts"
        " ORDER BY is_favorite DESC, send_count DESC, last_sent_at DESC,"
        " updated_at DESC"
        " LIMIT ?";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "contact_list_popular prepare: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    sqlite3_bind_int(stmt, 1, limit);

    qmail_contact_t *list = malloc((size_t)limit * sizeof(qmail_contact_t));
    if (!list) {
        sqlite3_finalize(stmt);
        return RESULT_MEMORY_ERROR;
    }

    int idx = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW && idx < limit) {
        read_contact_row(stmt, &list[idx]);
        idx++;
    }
    sqlite3_finalize(stmt);

    if (idx == 0) {
        free(list);
        return RESULT_SUCCESS;
    }

    *contacts_out = list;
    *count_out = idx;
    return RESULT_SUCCESS;
}

// ============================================================================
// EMAIL CRUD
// ============================================================================

result_t qmail_db_email_insert(const qmail_email_t *email) {
    if (!s_db || !email) return RESULT_INVALID_PARAM;

    const char *sql =
        "INSERT OR REPLACE INTO qmail_emails"
        " (email_id, subject, body, received_timestamp, sent_timestamp,"
        "  is_read, is_starred, is_trashed, folder, sender_sn, sender_denomination, inbox_fee)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "email_insert prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_blob(stmt, 1, email->email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 2, email->subject, -1, SQLITE_STATIC);
    if (email->body) {
        sqlite3_bind_text(stmt, 3, email->body, (int)email->body_len, SQLITE_STATIC);
    } else {
        sqlite3_bind_null(stmt, 3);
    }
    sqlite3_bind_int64(stmt, 4, email->received_timestamp);
    sqlite3_bind_int64(stmt, 5, email->sent_timestamp);
    sqlite3_bind_int(stmt, 6, email->is_read ? 1 : 0);
    sqlite3_bind_int(stmt, 7, email->is_starred ? 1 : 0);
    sqlite3_bind_int(stmt, 8, email->is_trashed ? 1 : 0);
    sqlite3_bind_int(stmt, 9, email->folder);
    sqlite3_bind_int64(stmt, 10, (int64_t)email->sender_sn);
    sqlite3_bind_int(stmt, 11, (int)email->sender_denomination);
    sqlite3_bind_int64(stmt, 12, (int64_t)email->inbox_fee);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "email_insert step: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    /* Insert recipient associations */
    const char *contact_sql =
        "INSERT OR REPLACE INTO qmail_email_contacts"
        " (email_id, serial_number, user_type) VALUES (?, ?, ?)";

    for (int i = 0; i < email->recipient_count; i++) {
        rc = sqlite3_prepare_v2(s_db, contact_sql, -1, &stmt, NULL);
        if (rc != SQLITE_OK) continue;

        sqlite3_bind_blob(stmt, 1, email->email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
        sqlite3_bind_int64(stmt, 2, (int64_t)email->recipients[i].serial_number);
        sqlite3_bind_int(stmt, 3, email->recipients[i].recipient_type);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
    }

    return RESULT_SUCCESS;
}

result_t qmail_db_email_get(const uint8_t email_id[QMAIL_GUID_SIZE], qmail_email_t *email_out) {
    if (!s_db || !email_id || !email_out) return RESULT_INVALID_PARAM;

    const char *sql =
        "SELECT email_id, subject, body, received_timestamp, sent_timestamp,"
        " is_read, is_starred, is_trashed, folder, sender_sn, sender_denomination, inbox_fee"
        " FROM qmail_emails WHERE email_id = ?";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "email_get prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_blob(stmt, 1, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    rc = sqlite3_step(stmt);

    if (rc == SQLITE_ROW) {
        read_email_row(stmt, email_out);
        sqlite3_finalize(stmt);
        load_email_recipients(email_out);
        return RESULT_SUCCESS;
    }

    sqlite3_finalize(stmt);
    return RESULT_NOT_FOUND;
}

static void qmail_db_remove_external_attachment_files(
        const uint8_t email_id[QMAIL_GUID_SIZE]) {
    if (!s_db || !email_id) return;

    const char *sql =
        "SELECT file_path FROM qmail_attachments"
        " WHERE email_id = ? AND storage_mode = ?"
        " AND file_path IS NOT NULL AND file_path <> ''";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_warn(LOG_CAT_GENERAL,
                 "external attachment cleanup prepare: %s",
                 sqlite3_errmsg(s_db));
        return;
    }

    sqlite3_bind_blob(stmt, 1, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    sqlite3_bind_int(stmt, 2, QMAIL_STORAGE_EXTERNAL);

    while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
        const unsigned char *path = sqlite3_column_text(stmt, 0);
        if (path && path[0]) {
            if (remove((const char *)path) != 0) {
                log_warn(LOG_CAT_GENERAL,
                         "external attachment cleanup could not remove %s",
                         (const char *)path);
            }
        }
    }

    sqlite3_finalize(stmt);
}

result_t qmail_db_email_delete(const uint8_t email_id[QMAIL_GUID_SIZE]) {
    if (!s_db || !email_id) return RESULT_INVALID_PARAM;

    qmail_db_remove_external_attachment_files(email_id);

    /* Delete associated contacts and servers first */
    const char *del_contacts = "DELETE FROM qmail_email_contacts WHERE email_id = ?";
    const char *del_servers  = "DELETE FROM qmail_email_servers WHERE email_id = ?";
    const char *del_attach   = "DELETE FROM qmail_attachments WHERE email_id = ?";
    const char *del_email    = "DELETE FROM qmail_emails WHERE email_id = ?";

    const char *stmts[] = { del_contacts, del_servers, del_attach, del_email };

    for (int i = 0; i < 4; i++) {
        sqlite3_stmt *stmt = NULL;
        int rc = sqlite3_prepare_v2(s_db, stmts[i], -1, &stmt, NULL);
        if (rc != SQLITE_OK) {
            log_error(LOG_CAT_GENERAL, "email_delete prepare[%d]: %s", i, sqlite3_errmsg(s_db));
            return RESULT_ERROR;
        }
        sqlite3_bind_blob(stmt, 1, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
    }

    /* The last statement is the email table delete - check if it matched */
    if (sqlite3_changes(s_db) == 0) {
        return RESULT_NOT_FOUND;
    }
    return RESULT_SUCCESS;
}

result_t qmail_db_email_mark_read(const uint8_t email_id[QMAIL_GUID_SIZE], bool is_read) {
    if (!s_db || !email_id) return RESULT_INVALID_PARAM;

    const char *sql = "UPDATE qmail_emails SET is_read = ? WHERE email_id = ?";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "email_mark_read prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_int(stmt, 1, is_read ? 1 : 0);
    sqlite3_bind_blob(stmt, 2, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "email_mark_read step: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    if (sqlite3_changes(s_db) == 0) {
        return RESULT_NOT_FOUND;
    }
    return RESULT_SUCCESS;
}

result_t qmail_db_email_mark_star(const uint8_t email_id[QMAIL_GUID_SIZE], bool is_starred) {
    if (!s_db || !email_id) return RESULT_INVALID_PARAM;

    const char *sql = "UPDATE qmail_emails SET is_starred = ? WHERE email_id = ?";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "email_mark_star prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_int(stmt, 1, is_starred ? 1 : 0);
    sqlite3_bind_blob(stmt, 2, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "email_mark_star step: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    if (sqlite3_changes(s_db) == 0) {
        return RESULT_NOT_FOUND;
    }
    return RESULT_SUCCESS;
}

result_t qmail_db_email_list(int folder, int limit, int offset,
                              qmail_email_t **emails_out, int *count_out) {
    if (!s_db || !emails_out || !count_out) return RESULT_INVALID_PARAM;

    *emails_out = NULL;
    *count_out = 0;

    /* Count rows for this folder (exclude trashed unless viewing trash folder) */
    const char *count_sql = (folder == 3) /* QMAIL_FOLDER_TRASH */
        ? "SELECT COUNT(*) FROM qmail_emails WHERE folder = ? AND is_trashed = 1"
        : "SELECT COUNT(*) FROM qmail_emails WHERE folder = ? AND is_trashed = 0";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, count_sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "email_list count prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_int(stmt, 1, folder);
    int total = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        total = sqlite3_column_int(stmt, 0);
    }
    sqlite3_finalize(stmt);

    if (total == 0) return RESULT_SUCCESS;

    /* Clamp limit */
    if (limit <= 0) limit = total;
    int alloc_count = (limit < total - offset) ? limit : (total - offset);
    if (alloc_count <= 0) return RESULT_SUCCESS;

    qmail_email_t *list = malloc((size_t)alloc_count * sizeof(qmail_email_t));
    if (!list) {
        log_error(LOG_CAT_GENERAL, "email_list malloc failed");
        return RESULT_MEMORY_ERROR;
    }
    memset(list, 0, (size_t)alloc_count * sizeof(qmail_email_t));

    const char *sql = (folder == 3) /* QMAIL_FOLDER_TRASH */
        ? "SELECT email_id, subject, body, received_timestamp, sent_timestamp,"
          " is_read, is_starred, is_trashed, folder, sender_sn, sender_denomination, inbox_fee"
          " FROM qmail_emails WHERE folder = ? AND is_trashed = 1"
          " ORDER BY received_timestamp DESC LIMIT ? OFFSET ?"
        : "SELECT email_id, subject, body, received_timestamp, sent_timestamp,"
          " is_read, is_starred, is_trashed, folder, sender_sn, sender_denomination, inbox_fee"
          " FROM qmail_emails WHERE folder = ? AND is_trashed = 0"
          " ORDER BY received_timestamp DESC LIMIT ? OFFSET ?";

    rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "email_list prepare: %s", sqlite3_errmsg(s_db));
        free(list);
        return RESULT_ERROR;
    }

    sqlite3_bind_int(stmt, 1, folder);
    sqlite3_bind_int(stmt, 2, limit);
    sqlite3_bind_int(stmt, 3, offset);

    int idx = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW && idx < alloc_count) {
        read_email_row(stmt, &list[idx]);
        idx++;
    }
    sqlite3_finalize(stmt);

    /* Load recipients for each email */
    for (int i = 0; i < idx; i++) {
        load_email_recipients(&list[i]);
    }

    *emails_out = list;
    *count_out = idx;
    return RESULT_SUCCESS;
}

result_t qmail_db_email_list_sorted(int folder, int limit, int offset,
                                     int sort_mode,
                                     qmail_email_t **emails_out, int *count_out) {
    if (!s_db || !emails_out || !count_out) return RESULT_INVALID_PARAM;

    *emails_out = NULL;
    *count_out = 0;

    /* Count rows */
    const char *count_sql = (folder == 3)
        ? "SELECT COUNT(*) FROM qmail_emails WHERE folder = ? AND is_trashed = 1"
        : "SELECT COUNT(*) FROM qmail_emails WHERE folder = ? AND is_trashed = 0";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, count_sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) return RESULT_ERROR;

    sqlite3_bind_int(stmt, 1, folder);
    int total = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW) total = sqlite3_column_int(stmt, 0);
    sqlite3_finalize(stmt);
    if (total == 0) return RESULT_SUCCESS;

    if (limit <= 0) limit = total;
    int alloc_count = (limit < total - offset) ? limit : (total - offset);
    if (alloc_count <= 0) return RESULT_SUCCESS;

    qmail_email_t *list = malloc((size_t)alloc_count * sizeof(qmail_email_t));
    if (!list) return RESULT_MEMORY_ERROR;
    memset(list, 0, (size_t)alloc_count * sizeof(qmail_email_t));

    /* Build ORDER BY clause based on sort_mode */
    const char *order_clause;
    switch (sort_mode) {
    case 1: /* QMAIL_SORT_UNREAD: unread first, then newest */
        order_clause = " ORDER BY is_read ASC, received_timestamp DESC";
        break;
    case 2: /* QMAIL_SORT_HIGHEST_FEE: highest fee first, then newest */
        order_clause = " ORDER BY inbox_fee DESC, received_timestamp DESC";
        break;
    case 3: /* QMAIL_SORT_STARRED: starred first, then newest */
        order_clause = " ORDER BY is_starred DESC, received_timestamp DESC";
        break;
    default: /* QMAIL_SORT_NEWEST */
        order_clause = " ORDER BY received_timestamp DESC";
        break;
    }

    /* Build full query */
    char sql[512];
    snprintf(sql, sizeof(sql),
        "SELECT email_id, subject, body, received_timestamp, sent_timestamp,"
        " is_read, is_starred, is_trashed, folder, sender_sn, sender_denomination, inbox_fee"
        " FROM qmail_emails WHERE folder = ? AND is_trashed = %d"
        "%s LIMIT ? OFFSET ?",
        (folder == 3) ? 1 : 0,
        order_clause);

    rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "email_list_sorted prepare: %s", sqlite3_errmsg(s_db));
        free(list);
        return RESULT_ERROR;
    }

    sqlite3_bind_int(stmt, 1, folder);
    sqlite3_bind_int(stmt, 2, limit);
    sqlite3_bind_int(stmt, 3, offset);

    int idx = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW && idx < alloc_count) {
        read_email_row(stmt, &list[idx]);
        idx++;
    }
    sqlite3_finalize(stmt);

    for (int i = 0; i < idx; i++) {
        load_email_recipients(&list[i]);
    }

    *emails_out = list;
    *count_out = idx;
    return RESULT_SUCCESS;
}

void qmail_db_email_list_free(qmail_email_t *emails, int count) {
    if (!emails) return;
    for (int i = 0; i < count; i++) {
        free(emails[i].body);
    }
    free(emails);
}

// ============================================================================
// FULL-TEXT SEARCH
// ============================================================================

result_t qmail_db_email_search(const char *query, int limit,
                                qmail_email_t **emails_out, int *count_out) {
    if (!s_db || !query || !emails_out || !count_out) return RESULT_INVALID_PARAM;

    *emails_out = NULL;
    *count_out = 0;
    if (limit <= 0) limit = 50;

    const char *sql =
        "SELECT e.email_id, e.subject, e.body, e.received_timestamp, e.sent_timestamp,"
        " e.is_read, e.is_starred, e.is_trashed, e.folder, e.sender_sn, e.sender_denomination, e.inbox_fee"
        " FROM qmail_emails e"
        " JOIN qmail_emails_fts fts ON e.rowid = fts.rowid"
        " WHERE qmail_emails_fts MATCH ?"
        " ORDER BY rank LIMIT ?";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "email_search prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_text(stmt, 1, query, -1, SQLITE_STATIC);
    sqlite3_bind_int(stmt, 2, limit);

    /* Collect results into a temporary buffer, grow as needed */
    int capacity = (limit < 64) ? limit : 64;
    qmail_email_t *list = malloc((size_t)capacity * sizeof(qmail_email_t));
    if (!list) {
        sqlite3_finalize(stmt);
        return RESULT_MEMORY_ERROR;
    }

    int idx = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW && idx < limit) {
        if (idx >= capacity) {
            capacity *= 2;
            qmail_email_t *tmp = realloc(list, (size_t)capacity * sizeof(qmail_email_t));
            if (!tmp) {
                /* Return what we have so far */
                break;
            }
            list = tmp;
        }
        read_email_row(stmt, &list[idx]);
        idx++;
    }
    sqlite3_finalize(stmt);

    for (int i = 0; i < idx; i++) {
        load_email_recipients(&list[i]);
    }

    if (idx == 0) {
        free(list);
        return RESULT_SUCCESS;
    }

    *emails_out = list;
    *count_out = idx;
    return RESULT_SUCCESS;
}

// ============================================================================
// RECEIVED TELLS
// ============================================================================

static bool qmail_db_tell_manifest_valid(const qmail_tell_notification_t *tell) {
    if (!tell || tell->file_count == 0 ||
        tell->file_count > QMAIL_TELL_MANIFEST_MAX_FILES ||
        tell->manifest_len !=
            (uint16_t)(tell->file_count * tell->file_entry_size) ||
        tell->manifest_len > QMAIL_TELL_MANIFEST_MAX_LEN) {
        return false;
    }
    return (tell->manifest_version == QMAIL_TELL_MANIFEST_VERSION_1 &&
            tell->file_entry_size == QMAIL_TELL_MANIFEST_V1_ENTRY_SIZE) ||
           (tell->manifest_version == QMAIL_TELL_MANIFEST_VERSION_2 &&
            tell->file_entry_size == QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE);
}

static const void *qmail_db_tell_manifest_data(
    const qmail_tell_notification_t *tell) {
    return tell->manifest_version == QMAIL_TELL_MANIFEST_VERSION_2
        ? (const void *)tell->manifest_bytes
        : (const void *)tell->files;
}

result_t qmail_db_tell_insert(const qmail_tell_notification_t *tell) {
    if (!s_db || !tell) return RESULT_INVALID_PARAM;

    uint16_t manifest_len = 0;
    if (qmail_db_tell_manifest_valid(tell)) {
        manifest_len = tell->manifest_len;
    }

    /* Serialize server locations to a simple JSON array */
    char server_json[1024];
    int pos = 0;
    pos += snprintf(server_json + pos, sizeof(server_json) - (size_t)pos, "[");
    for (int i = 0; i < tell->server_count && i < QMAIL_SERVER_COUNT; i++) {
        if (i > 0) pos += snprintf(server_json + pos, sizeof(server_json) - (size_t)pos, ",");
        pos += snprintf(server_json + pos, sizeof(server_json) - (size_t)pos,
                        "{\"stripe\":%d,\"type\":%d,\"server\":%d}",
                        tell->servers[i].stripe_index,
                        tell->servers[i].stripe_type,
                        tell->servers[i].server_id);
    }
    snprintf(server_json + pos, sizeof(server_json) - (size_t)pos, "]");

    const char *sql =
        "INSERT OR IGNORE INTO qmail_received_tells"
        " (file_guid, locker_code, sender_sn, sender_denomination, tell_type, server_list_json, total_file_size,"
        "  manifest_version, manifest_file_count, manifest_entry_size, manifest_len,"
        "  manifest_flags, manifest_blob, downloaded, timestamp)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "tell_insert prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_blob(stmt, 1, tell->file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);
    sqlite3_bind_blob(stmt, 2, tell->locker_code, 16, SQLITE_STATIC);
    sqlite3_bind_int64(stmt, 3, (int64_t)tell->sender_sn);
    sqlite3_bind_int(stmt, 4, (int)tell->sender_denomination);
    sqlite3_bind_int(stmt, 5, tell->tell_type);
    sqlite3_bind_text(stmt, 6, server_json, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 7, (int64_t)tell->total_file_size);
    sqlite3_bind_int(stmt, 8, manifest_len ? tell->manifest_version : 0);
    sqlite3_bind_int(stmt, 9, manifest_len ? tell->file_count : 0);
    sqlite3_bind_int(stmt, 10, manifest_len ? tell->file_entry_size : 0);
    sqlite3_bind_int(stmt, 11, manifest_len);
    sqlite3_bind_int(stmt, 12, manifest_len ? tell->manifest_flags : 0);
    if (manifest_len > 0) {
        sqlite3_bind_blob(stmt, 13, qmail_db_tell_manifest_data(tell),
                          manifest_len, SQLITE_STATIC);
    } else {
        sqlite3_bind_null(stmt, 13);
    }
    sqlite3_bind_int64(stmt, 14, (int64_t)tell->timestamp);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "tell_insert step: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    if (sqlite3_changes(s_db) == 0) {
        const char *update_sql = manifest_len > 0
            ? "UPDATE qmail_received_tells"
              " SET locker_code = ?, sender_sn = ?, sender_denomination = ?,"
              "     tell_type = ?, server_list_json = ?,"
              "     total_file_size = CASE WHEN ? > 0 THEN ? ELSE total_file_size END,"
              "     manifest_version = ?, manifest_file_count = ?,"
              "     manifest_entry_size = ?, manifest_len = ?,"
              "     manifest_flags = ?, manifest_blob = ?,"
              "     downloaded = CASE"
              "       WHEN ? > 1 AND (manifest_len = 0 OR manifest_file_count <= 1)"
              "       THEN 0 ELSE downloaded END,"
              "     timestamp = CASE WHEN ? > timestamp THEN ? ELSE timestamp END"
              " WHERE file_guid = ?"
            : "UPDATE qmail_received_tells"
              " SET locker_code = ?, sender_sn = ?, sender_denomination = ?,"
              "     tell_type = ?, server_list_json = ?,"
              "     total_file_size = CASE WHEN ? > 0 THEN ? ELSE total_file_size END,"
              "     timestamp = CASE WHEN ? > timestamp THEN ? ELSE timestamp END"
              " WHERE file_guid = ? AND downloaded = 0";

        rc = sqlite3_prepare_v2(s_db, update_sql, -1, &stmt, NULL);
        if (rc != SQLITE_OK) {
            log_error(LOG_CAT_GENERAL, "tell_insert update prepare: %s", sqlite3_errmsg(s_db));
            return RESULT_ERROR;
        }

        int b = 1;
        sqlite3_bind_blob(stmt, b++, tell->locker_code, 16, SQLITE_STATIC);
        sqlite3_bind_int64(stmt, b++, (int64_t)tell->sender_sn);
        sqlite3_bind_int(stmt, b++, (int)tell->sender_denomination);
        sqlite3_bind_int(stmt, b++, tell->tell_type);
        sqlite3_bind_text(stmt, b++, server_json, -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, b++, (int64_t)tell->total_file_size);
        sqlite3_bind_int64(stmt, b++, (int64_t)tell->total_file_size);

        if (manifest_len > 0) {
            sqlite3_bind_int(stmt, b++, tell->manifest_version);
            sqlite3_bind_int(stmt, b++, tell->file_count);
            sqlite3_bind_int(stmt, b++, tell->file_entry_size);
            sqlite3_bind_int(stmt, b++, manifest_len);
            sqlite3_bind_int(stmt, b++, tell->manifest_flags);
            sqlite3_bind_blob(stmt, b++, qmail_db_tell_manifest_data(tell),
                              manifest_len, SQLITE_STATIC);
            sqlite3_bind_int(stmt, b++, tell->file_count);
        }

        sqlite3_bind_int64(stmt, b++, (int64_t)tell->timestamp);
        sqlite3_bind_int64(stmt, b++, (int64_t)tell->timestamp);
        sqlite3_bind_blob(stmt, b++, tell->file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);

        rc = sqlite3_step(stmt);
        sqlite3_finalize(stmt);
        if (rc != SQLITE_DONE) {
            log_error(LOG_CAT_GENERAL, "tell_insert update step: %s", sqlite3_errmsg(s_db));
            return RESULT_ERROR;
        }
    }

    return RESULT_SUCCESS;
}

result_t qmail_db_tell_is_downloaded(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                      bool *downloaded_out) {
    if (!s_db || !file_guid || !downloaded_out) return RESULT_INVALID_PARAM;
    *downloaded_out = false;

    const char *sql = "SELECT downloaded FROM qmail_received_tells WHERE file_guid = ?";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "tell_is_downloaded prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_blob(stmt, 1, file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);
    rc = sqlite3_step(stmt);
    if (rc == SQLITE_ROW) {
        *downloaded_out = sqlite3_column_int(stmt, 0) != 0;
        sqlite3_finalize(stmt);
        return RESULT_SUCCESS;
    }

    sqlite3_finalize(stmt);
    return RESULT_NOT_FOUND;
}

result_t qmail_db_tell_mark_downloaded(const uint8_t file_guid[QMAIL_GUID_SIZE]) {
    if (!s_db || !file_guid) return RESULT_INVALID_PARAM;

    const char *sql = "UPDATE qmail_received_tells SET downloaded = 1 WHERE file_guid = ?";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "tell_mark_downloaded prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_blob(stmt, 1, file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "tell_mark_downloaded step: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    return RESULT_SUCCESS;
}

/* Parse one qmail_received_tells row (the 14-column SELECT below) into a
 * notification struct. Shared by tell_get_pending and tell_get_by_guid so the
 * server-list/manifest parsing has one source of truth. */
static void tell_row_to_notification(sqlite3_stmt *stmt,
                                     qmail_tell_notification_t *t) {
    copy_blob_column(t->file_guid, QMAIL_GUID_SIZE, stmt, 0);
    copy_blob_column(t->locker_code, 16, stmt, 1);
    t->sender_sn = (uint32_t)sqlite3_column_int64(stmt, 2);
    t->sender_denomination = (uint8_t)sqlite3_column_int(stmt, 3);
    t->tell_type = (uint8_t)sqlite3_column_int(stmt, 4);

    /* Parse server_list_json at column 5 */
    t->server_count = 0;
    const char *json = (const char *)sqlite3_column_text(stmt, 5);
    if (json) {
        const char *p = json;
        while (*p && t->server_count < QMAIL_SERVER_COUNT) {
            const char *obj = strchr(p, '{');
            if (!obj) break;
            p = obj + 1;

            int stripe_val = -1, type_val = -1, server_val = -1;
            while (*p && *p != '}') {
                const char *q = strchr(p, '"');
                if (!q) break;
                q++;
                if (strncmp(q, "stripe\"", 7) == 0) {
                    const char *colon = strchr(q, ':');
                    if (colon) stripe_val = (int)strtol(colon + 1, NULL, 10);
                } else if (strncmp(q, "type\"", 5) == 0) {
                    const char *colon = strchr(q, ':');
                    if (colon) type_val = (int)strtol(colon + 1, NULL, 10);
                } else if (strncmp(q, "server\"", 7) == 0) {
                    const char *colon = strchr(q, ':');
                    if (colon) server_val = (int)strtol(colon + 1, NULL, 10);
                }
                const char *comma = strchr(p, ',');
                const char *brace = strchr(p, '}');
                if (comma && (!brace || comma < brace)) {
                    p = comma + 1;
                } else {
                    break;
                }
            }

            if (stripe_val >= 0 && server_val >= 0) {
                int si = t->server_count;
                t->servers[si].stripe_index = (uint8_t)stripe_val;
                t->servers[si].stripe_type = (uint8_t)(type_val >= 0 ? type_val : 0);
                t->servers[si].server_id = (uint8_t)server_val;
                t->server_count++;
            }

            const char *close = strchr(p, '}');
            if (close) p = close + 1; else break;
        }
    }

    t->total_file_size = (uint32_t)sqlite3_column_int64(stmt, 6);
    t->timestamp = (uint32_t)sqlite3_column_int64(stmt, 7);
    t->manifest_version = (uint8_t)sqlite3_column_int(stmt, 8);
    t->file_count = (uint8_t)sqlite3_column_int(stmt, 9);
    t->file_entry_size = (uint8_t)sqlite3_column_int(stmt, 10);
    t->manifest_len = (uint16_t)sqlite3_column_int(stmt, 11);
    t->manifest_flags = (uint8_t)sqlite3_column_int(stmt, 12);
    if (qmail_db_tell_manifest_valid(t)) {
        const void *blob = sqlite3_column_blob(stmt, 13);
        int blob_len = sqlite3_column_bytes(stmt, 13);
        if (blob && blob_len == t->manifest_len) {
            if (t->manifest_version == QMAIL_TELL_MANIFEST_VERSION_2) {
                memcpy(t->manifest_bytes, blob, (size_t)blob_len);
            } else {
                memcpy(t->files, blob, (size_t)blob_len);
            }
        } else {
            t->manifest_version = QMAIL_TELL_MANIFEST_VERSION_LEGACY;
            t->file_count = 0;
            t->file_entry_size = 0;
            t->manifest_len = 0;
            t->manifest_flags = 0;
        }
    }
}

#define QMAIL_TELL_SELECT_COLUMNS \
    "file_guid, locker_code, sender_sn, sender_denomination, tell_type, " \
    "server_list_json, total_file_size, timestamp, manifest_version, " \
    "manifest_file_count, manifest_entry_size, manifest_len, manifest_flags, " \
    "manifest_blob"

/* Fetch a single stored tell by GUID regardless of downloaded state. Used by
 * the on-demand attachment download (the email may already be downloaded=1, so
 * tell_get_pending would not return it). */
result_t qmail_db_tell_get_by_guid(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                   qmail_tell_notification_t *notif_out) {
    if (!s_db || !file_guid || !notif_out) return RESULT_INVALID_PARAM;
    memset(notif_out, 0, sizeof(*notif_out));

    const char *sql = "SELECT " QMAIL_TELL_SELECT_COLUMNS
                      " FROM qmail_received_tells WHERE file_guid = ? LIMIT 1";
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "tell_get_by_guid prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    sqlite3_bind_blob(stmt, 1, file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);

    result_t res = RESULT_NOT_FOUND;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        tell_row_to_notification(stmt, notif_out);
        res = RESULT_SUCCESS;
    }
    sqlite3_finalize(stmt);
    return res;
}

result_t qmail_db_tell_get_pending(qmail_tell_notification_t **tells_out, int *count_out) {
    if (!s_db || !tells_out || !count_out) return RESULT_INVALID_PARAM;

    *tells_out = NULL;
    *count_out = 0;

    const char *count_sql = "SELECT COUNT(*) FROM qmail_received_tells WHERE downloaded = 0";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, count_sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "tell_get_pending count prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    int total = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        total = sqlite3_column_int(stmt, 0);
    }
    sqlite3_finalize(stmt);

    if (total == 0) return RESULT_SUCCESS;

    qmail_tell_notification_t *list = malloc((size_t)total * sizeof(qmail_tell_notification_t));
    if (!list) {
        log_error(LOG_CAT_GENERAL, "tell_get_pending malloc failed");
        return RESULT_MEMORY_ERROR;
    }
    memset(list, 0, (size_t)total * sizeof(qmail_tell_notification_t));

    const char *sql =
        "SELECT file_guid, locker_code, sender_sn, sender_denomination, tell_type, server_list_json,"
        " total_file_size, timestamp, manifest_version, manifest_file_count,"
        " manifest_entry_size, manifest_len, manifest_flags, manifest_blob"
        " FROM qmail_received_tells WHERE downloaded = 0 ORDER BY timestamp ASC";

    rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "tell_get_pending prepare: %s", sqlite3_errmsg(s_db));
        free(list);
        return RESULT_ERROR;
    }

    int idx = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW && idx < total) {
        tell_row_to_notification(stmt, &list[idx]);
        idx++;
    }
    sqlite3_finalize(stmt);

    *tells_out = list;
    *count_out = idx;
    return RESULT_SUCCESS;
}

void qmail_db_tell_list_free(qmail_tell_notification_t *tells, int count) {
    (void)count;
    free(tells);
}

// ============================================================================
// SENT EMAILS
// ============================================================================

result_t qmail_db_sent_insert(const uint8_t file_guid[QMAIL_GUID_SIZE],
                               const char *subject,
                               const char *recipients,
                               const char *body_preview,
                               int64_t timestamp,
                               uint32_t sender_sn,
                               int8_t sender_denomination,
                               const qmail_recipient_entry_t *entries,
                               int entry_count) {
    if (!s_db || !file_guid) return RESULT_INVALID_PARAM;

    const char *sql =
        "INSERT OR IGNORE INTO qmail_sent_emails"
        " (file_guid, subject, recipients, body_preview, timestamp)"
        " VALUES (?, ?, ?, ?, ?)";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "sent_insert prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_blob(stmt, 1, file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 2, subject ? subject : "", -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 3, recipients ? recipients : "", -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, 4, body_preview ? body_preview : "", -1, SQLITE_STATIC);
    sqlite3_bind_int64(stmt, 5, timestamp);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "sent_insert step: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    /* The Sent folder is backed by qmail_emails, not qmail_sent_emails. Keep
     * the legacy tracking row above, and also project the sent message into
     * qmail_emails so folder counts, list, read, move, star, and delete work. */
    const char *email_sql =
        "INSERT OR IGNORE INTO qmail_emails"
        " (email_id, subject, body, received_timestamp, sent_timestamp,"
        "  is_read, is_starred, is_trashed, folder, sender_sn, sender_denomination, inbox_fee)"
        " VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?, ?, ?, 0)";

    sqlite3_stmt *email_stmt = NULL;
    rc = sqlite3_prepare_v2(s_db, email_sql, -1, &email_stmt, NULL);
    if (rc != SQLITE_OK) {
        log_warn(LOG_CAT_GENERAL, "sent_email projection prepare: %s", sqlite3_errmsg(s_db));
    } else {
        int stored_sender_denom =
            (sender_denomination >= 0 && sender_denomination <= 4)
                ? (int)sender_denomination
                : 2;

        sqlite3_bind_blob(email_stmt, 1, file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);
        sqlite3_bind_text(email_stmt, 2, subject ? subject : "", -1, SQLITE_STATIC);
        sqlite3_bind_text(email_stmt, 3, body_preview ? body_preview : "", -1, SQLITE_STATIC);
        sqlite3_bind_int64(email_stmt, 4, timestamp);
        sqlite3_bind_int64(email_stmt, 5, timestamp);
        sqlite3_bind_int(email_stmt, 6, QMAIL_FOLDER_SENT);
        sqlite3_bind_int64(email_stmt, 7, (int64_t)sender_sn);
        sqlite3_bind_int(email_stmt, 8, stored_sender_denom);

        rc = sqlite3_step(email_stmt);
        if (rc != SQLITE_DONE) {
            log_warn(LOG_CAT_GENERAL, "sent_email projection step: %s", sqlite3_errmsg(s_db));
        }
        sqlite3_finalize(email_stmt);
    }

    /* Per-recipient rows. qmail_email_contacts is keyed by a 16-byte BLOB;
     * file_guid (sent) and email_id (inbox) share the same GUID format and
     * generator, so the join table is safely shared. */
    if (entries && entry_count > 0) {
        const char *contact_sql =
            "INSERT OR REPLACE INTO qmail_email_contacts"
            " (email_id, serial_number, user_type) VALUES (?, ?, ?)";
        for (int i = 0; i < entry_count; i++) {
            sqlite3_stmt *cs = NULL;
            if (sqlite3_prepare_v2(s_db, contact_sql, -1, &cs, NULL) != SQLITE_OK) continue;
            sqlite3_bind_blob(cs, 1, file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);
            sqlite3_bind_int64(cs, 2, (int64_t)entries[i].serial_number);
            sqlite3_bind_int(cs, 3, (int)entries[i].recipient_type);
            sqlite3_step(cs);
            sqlite3_finalize(cs);
        }
    }
    return RESULT_SUCCESS;
}

// ============================================================================
// STATISTICS
// ============================================================================

// ============================================================================
// ATTACHMENTS
// ============================================================================

result_t qmail_db_attachment_insert(const qmail_attachment_t *attachment) {
    if (!s_db || !attachment) return RESULT_INVALID_PARAM;

    size_t stored_size = attachment->size_bytes;
    if (stored_size == 0 &&
        attachment->storage_mode == QMAIL_STORAGE_INTERNAL &&
        attachment->data_blob &&
        attachment->data_size > 0) {
        stored_size = attachment->data_size;
    }

    sqlite3_stmt *stmt = NULL;
    int rc = SQLITE_OK;

    const char *delete_sql =
        "DELETE FROM qmail_attachments WHERE email_id = ? AND file_type = ?";
    rc = sqlite3_prepare_v2(s_db, delete_sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "attachment_replace prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    sqlite3_bind_blob(stmt, 1, attachment->email_id, QMAIL_GUID_SIZE, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 2, attachment->file_type);
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    stmt = NULL;

    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "attachment_replace step: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    const char *sql =
        "INSERT INTO qmail_attachments"
        " (email_id, file_type, name, extension, storage_mode, data_blob, file_path, size_bytes)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

    rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "attachment_insert prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_blob(stmt, 1, attachment->email_id, QMAIL_GUID_SIZE, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 2, attachment->file_type);
    sqlite3_bind_text(stmt, 3, attachment->name, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(stmt, 4, attachment->extension, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(stmt, 5, attachment->storage_mode);
    if (attachment->storage_mode == QMAIL_STORAGE_INTERNAL && attachment->data_blob) {
        sqlite3_bind_blob(stmt, 6, attachment->data_blob, (int)attachment->data_size, SQLITE_TRANSIENT);
    } else {
        sqlite3_bind_null(stmt, 6);
    }
    sqlite3_bind_text(stmt, 7, attachment->file_path, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(stmt, 8, (int64_t)stored_size);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "attachment_insert step: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    return RESULT_SUCCESS;
}

result_t qmail_db_attachment_list(const uint8_t email_id[QMAIL_GUID_SIZE],
                                   qmail_attachment_t **attachments_out, int *count_out) {
    if (!s_db || !email_id || !attachments_out || !count_out) return RESULT_INVALID_PARAM;

    *attachments_out = NULL;
    *count_out = 0;

    const char *count_sql =
        "SELECT COUNT(*) FROM qmail_attachments WHERE email_id = ?";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, count_sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) return RESULT_ERROR;

    sqlite3_bind_blob(stmt, 1, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    int total = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        total = sqlite3_column_int(stmt, 0);
    }
    sqlite3_finalize(stmt);
    if (total == 0) return RESULT_SUCCESS;

    qmail_attachment_t *list = malloc((size_t)total * sizeof(qmail_attachment_t));
    if (!list) return RESULT_MEMORY_ERROR;
    memset(list, 0, (size_t)total * sizeof(qmail_attachment_t));

    const char *sql =
        "SELECT attachment_id, email_id, file_type, name, extension, storage_mode,"
        " file_path,"
        " CASE WHEN size_bytes > 0 THEN size_bytes ELSE COALESCE(length(data_blob), 0) END"
        " FROM qmail_attachments WHERE email_id = ? ORDER BY attachment_id";

    rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        free(list);
        return RESULT_ERROR;
    }

    sqlite3_bind_blob(stmt, 1, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    int idx = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW && idx < total) {
        qmail_attachment_t *a = &list[idx];
        a->attachment_id = sqlite3_column_int64(stmt, 0);
        copy_blob_column(a->email_id, QMAIL_GUID_SIZE, stmt, 1);
        a->file_type = (uint8_t)sqlite3_column_int(stmt, 2);
        copy_text_column(a->name, sizeof(a->name), stmt, 3);
        copy_text_column(a->extension, sizeof(a->extension), stmt, 4);
        a->storage_mode = sqlite3_column_int(stmt, 5);
        copy_text_column(a->file_path, sizeof(a->file_path), stmt, 6);
        a->size_bytes = (size_t)sqlite3_column_int64(stmt, 7);
        /* data_blob intentionally NOT loaded for listing */
        idx++;
    }
    sqlite3_finalize(stmt);

    *attachments_out = list;
    *count_out = idx;
    return RESULT_SUCCESS;
}

result_t qmail_db_attachment_get(int64_t attachment_id, qmail_attachment_t *attachment_out) {
    if (!s_db || !attachment_out) return RESULT_INVALID_PARAM;

    memset(attachment_out, 0, sizeof(*attachment_out));

    const char *sql =
        "SELECT attachment_id, email_id, file_type, name, extension, storage_mode,"
        " data_blob, file_path,"
        " CASE WHEN size_bytes > 0 THEN size_bytes ELSE COALESCE(length(data_blob), 0) END"
        " FROM qmail_attachments WHERE attachment_id = ?";

    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) return RESULT_ERROR;

    sqlite3_bind_int64(stmt, 1, attachment_id);
    rc = sqlite3_step(stmt);

    if (rc == SQLITE_ROW) {
        attachment_out->attachment_id = sqlite3_column_int64(stmt, 0);
        copy_blob_column(attachment_out->email_id, QMAIL_GUID_SIZE, stmt, 1);
        attachment_out->file_type = (uint8_t)sqlite3_column_int(stmt, 2);
        copy_text_column(attachment_out->name, sizeof(attachment_out->name), stmt, 3);
        copy_text_column(attachment_out->extension, sizeof(attachment_out->extension), stmt, 4);
        attachment_out->storage_mode = sqlite3_column_int(stmt, 5);

        /* Load data_blob if INTERNAL */
        const void *blob = sqlite3_column_blob(stmt, 6);
        int blob_len = sqlite3_column_bytes(stmt, 6);
        if (blob && blob_len > 0) {
            attachment_out->data_blob = malloc((size_t)blob_len);
            if (attachment_out->data_blob) {
                memcpy(attachment_out->data_blob, blob, (size_t)blob_len);
                attachment_out->data_size = (size_t)blob_len;
            }
        }

        copy_text_column(attachment_out->file_path, sizeof(attachment_out->file_path), stmt, 7);
        attachment_out->size_bytes = (size_t)sqlite3_column_int64(stmt, 8);
        if (attachment_out->size_bytes == 0 && attachment_out->data_size > 0) {
            attachment_out->size_bytes = attachment_out->data_size;
        }
        sqlite3_finalize(stmt);
        return RESULT_SUCCESS;
    }

    sqlite3_finalize(stmt);
    return RESULT_NOT_FOUND;
}

/* Update an attachment row's storage state (used by on-demand download to flip a
 * PENDING row to EXTERNAL once the bytes are fetched and written to disk). */
result_t qmail_db_attachment_update_storage(int64_t attachment_id,
                                            int storage_mode,
                                            const char *file_path,
                                            size_t size_bytes) {
    if (!s_db) return RESULT_INVALID_PARAM;

    const char *sql =
        "UPDATE qmail_attachments SET storage_mode = ?, file_path = ?, "
        "size_bytes = ? WHERE attachment_id = ?";
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "attachment_update_storage prepare: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    sqlite3_bind_int(stmt, 1, storage_mode);
    if (file_path && file_path[0]) {
        sqlite3_bind_text(stmt, 2, file_path, -1, SQLITE_TRANSIENT);
    } else {
        sqlite3_bind_null(stmt, 2);
    }
    sqlite3_bind_int64(stmt, 3, (sqlite3_int64)size_bytes);
    sqlite3_bind_int64(stmt, 4, (sqlite3_int64)attachment_id);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    if (rc != SQLITE_DONE) {
        log_error(LOG_CAT_GENERAL, "attachment_update_storage step: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    return RESULT_SUCCESS;
}

void qmail_db_attachment_list_free(qmail_attachment_t *attachments, int count) {
    if (!attachments) return;
    for (int i = 0; i < count; i++) {
        qmail_attachment_free(&attachments[i]);
    }
    free(attachments);
}

// ============================================================================
// FOLDER MANAGEMENT
// ============================================================================

result_t qmail_db_email_move(const uint8_t email_id[QMAIL_GUID_SIZE], int folder) {
    if (!s_db || !email_id) return RESULT_INVALID_PARAM;

    bool trashed = (folder == QMAIL_FOLDER_TRASH);

    const char *sql =
        "UPDATE qmail_emails SET folder = ?, is_trashed = ? WHERE email_id = ?";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "email_move prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_int(stmt, 1, folder);
    sqlite3_bind_int(stmt, 2, trashed ? 1 : 0);
    sqlite3_bind_blob(stmt, 3, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) return RESULT_ERROR;
    if (sqlite3_changes(s_db) == 0) return RESULT_NOT_FOUND;
    return RESULT_SUCCESS;
}

result_t qmail_db_email_trash(const uint8_t email_id[QMAIL_GUID_SIZE]) {
    return qmail_db_email_move(email_id, QMAIL_FOLDER_TRASH);
}

result_t qmail_db_email_delete_permanent(const uint8_t email_id[QMAIL_GUID_SIZE]) {
    if (!s_db || !email_id) return RESULT_INVALID_PARAM;

    /* Verify email is trashed first */
    const char *check_sql =
        "SELECT is_trashed FROM qmail_emails WHERE email_id = ?";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, check_sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) return RESULT_ERROR;

    sqlite3_bind_blob(stmt, 1, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    rc = sqlite3_step(stmt);
    if (rc != SQLITE_ROW) {
        sqlite3_finalize(stmt);
        return RESULT_NOT_FOUND;
    }
    int is_trashed = sqlite3_column_int(stmt, 0);
    sqlite3_finalize(stmt);

    if (!is_trashed) {
        log_warn(LOG_CAT_GENERAL, "email_delete_permanent: email not in trash");
        return RESULT_INVALID_PARAM;
    }

    /* Now do a full hard delete (reuse existing qmail_db_email_delete) */
    return qmail_db_email_delete(email_id);
}

result_t qmail_db_folder_counts(qmail_folder_count_t counts[6]) {
    if (!s_db || !counts) return RESULT_INVALID_PARAM;

    memset(counts, 0, 6 * sizeof(qmail_folder_count_t));

    /* Counts for non-trash folders */
    const char *sql =
        "SELECT folder, COUNT(*), SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END)"
        " FROM qmail_emails WHERE is_trashed = 0 GROUP BY folder";
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) return RESULT_ERROR;

    while (sqlite3_step(stmt) == SQLITE_ROW) {
        int folder = sqlite3_column_int(stmt, 0);
        if (folder >= 0 && folder < 6) {
            counts[folder].total = sqlite3_column_int(stmt, 1);
            counts[folder].unread = sqlite3_column_int(stmt, 2);
        }
    }
    sqlite3_finalize(stmt);

    /* Trash count (all trashed emails regardless of original folder) */
    const char *trash_sql =
        "SELECT COUNT(*), SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END)"
        " FROM qmail_emails WHERE is_trashed = 1";
    rc = sqlite3_prepare_v2(s_db, trash_sql, -1, &stmt, NULL);
    if (rc != SQLITE_OK) return RESULT_ERROR;

    if (sqlite3_step(stmt) == SQLITE_ROW) {
        counts[QMAIL_FOLDER_TRASH].total = sqlite3_column_int(stmt, 0);
        counts[QMAIL_FOLDER_TRASH].unread = sqlite3_column_int(stmt, 1);
    }
    sqlite3_finalize(stmt);

    /* Add trashed tells to trash count */
    const char *trashed_tells_sql =
        "SELECT COUNT(*) FROM qmail_received_tells WHERE is_trashed = 1";
    rc = sqlite3_prepare_v2(s_db, trashed_tells_sql, -1, &stmt, NULL);
    if (rc == SQLITE_OK && sqlite3_step(stmt) == SQLITE_ROW) {
        counts[QMAIL_FOLDER_TRASH].total += sqlite3_column_int(stmt, 0);
    }
    sqlite3_finalize(stmt);

    /* Add pending (non-trashed) tells to inbox count */
    const char *tells_sql =
        "SELECT COUNT(*) FROM qmail_received_tells WHERE downloaded = 0 AND is_trashed = 0";
    rc = sqlite3_prepare_v2(s_db, tells_sql, -1, &stmt, NULL);
    if (rc == SQLITE_OK && sqlite3_step(stmt) == SQLITE_ROW) {
        int pending = sqlite3_column_int(stmt, 0);
        counts[QMAIL_FOLDER_INBOX].total += pending;
        counts[QMAIL_FOLDER_INBOX].unread += pending;
    }
    sqlite3_finalize(stmt);

    return RESULT_SUCCESS;
}

// ============================================================================
// STATISTICS
// ============================================================================

int qmail_db_count_emails(int folder) {
    if (!s_db) return 0;

    const char *sql = "SELECT COUNT(*) FROM qmail_emails WHERE folder = ?";
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) return 0;

    sqlite3_bind_int(stmt, 1, folder);
    int count = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        count = sqlite3_column_int(stmt, 0);
    }
    sqlite3_finalize(stmt);
    return count;
}

int qmail_db_count_unread(void) {
    if (!s_db) return 0;

    const char *sql = "SELECT COUNT(*) FROM qmail_emails WHERE is_read = 0";
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) return 0;

    int count = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        count = sqlite3_column_int(stmt, 0);
    }
    sqlite3_finalize(stmt);
    return count;
}

int qmail_db_count_contacts(void) {
    if (!s_db) return 0;

    const char *sql = "SELECT COUNT(*) FROM qmail_contacts";
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) return 0;

    int count = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        count = sqlite3_column_int(stmt, 0);
    }
    sqlite3_finalize(stmt);
    return count;
}

// ============================================================================
// PENDING TELLS (outgoing tell retry queue)
// ============================================================================

result_t qmail_db_pending_tell_insert(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                       uint32_t recipient_sn,
                                       int8_t recipient_denomination,
                                       uint8_t beacon_raida,
                                       const uint8_t *context_blob,
                                       size_t context_blob_size,
                                       const char *error_message) {
    if (!s_db) return RESULT_ERROR;

    const char *sql =
        "INSERT INTO qmail_pending_tells"
        " (file_guid, recipient_sn, recipient_denomination, beacon_raida,"
        "  tell_context_blob, status, retry_count, last_error, created_at, last_attempt)"
        " VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "pending_tell_insert prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    int64_t now = (int64_t)time(NULL);
    sqlite3_bind_blob(stmt, 1, file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);
    sqlite3_bind_int(stmt, 2, (int)recipient_sn);
    sqlite3_bind_int(stmt, 3, (int)recipient_denomination);
    sqlite3_bind_int(stmt, 4, (int)beacon_raida);
    if (context_blob && context_blob_size > 0) {
        sqlite3_bind_blob(stmt, 5, context_blob, (int)context_blob_size, SQLITE_STATIC);
    } else {
        sqlite3_bind_null(stmt, 5);
    }
    if (error_message && error_message[0]) {
        sqlite3_bind_text(stmt, 6, error_message, -1, SQLITE_STATIC);
    } else {
        sqlite3_bind_null(stmt, 6);
    }
    sqlite3_bind_int64(stmt, 7, now);
    sqlite3_bind_int64(stmt, 8, now);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);
    return (rc == SQLITE_DONE) ? RESULT_SUCCESS : RESULT_ERROR;
}

result_t qmail_db_pending_tell_list(const char *status_filter,
                                     qmail_pending_tell_row_t **rows_out,
                                     int *count_out) {
    if (!s_db) return RESULT_ERROR;
    *rows_out = NULL;
    *count_out = 0;

    bool has_filter = (status_filter && status_filter[0]);

    /* Count first */
    const char *count_sql = has_filter
        ? "SELECT COUNT(*) FROM qmail_pending_tells WHERE status = ?"
        : "SELECT COUNT(*) FROM qmail_pending_tells";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, count_sql, -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;
    if (has_filter)
        sqlite3_bind_text(stmt, 1, status_filter, -1, SQLITE_STATIC);

    int count = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW)
        count = sqlite3_column_int(stmt, 0);
    sqlite3_finalize(stmt);

    if (count == 0) return RESULT_SUCCESS;

    /* Fetch rows */
    const char *sql = has_filter
        ? "SELECT id, file_guid, recipient_sn, recipient_denomination, beacon_raida,"
          " status, retry_count, last_error, created_at, last_attempt"
          " FROM qmail_pending_tells WHERE status = ?"
          " ORDER BY created_at DESC"
        : "SELECT id, file_guid, recipient_sn, recipient_denomination, beacon_raida,"
          " status, retry_count, last_error, created_at, last_attempt"
          " FROM qmail_pending_tells ORDER BY created_at DESC";

    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;
    if (has_filter)
        sqlite3_bind_text(stmt, 1, status_filter, -1, SQLITE_STATIC);

    qmail_pending_tell_row_t *rows = calloc((size_t)count, sizeof(qmail_pending_tell_row_t));
    if (!rows) { sqlite3_finalize(stmt); return RESULT_ERROR; }

    int idx = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW && idx < count) {
        qmail_pending_tell_row_t *r = &rows[idx];
        r->id = sqlite3_column_int64(stmt, 0);
        const void *guid = sqlite3_column_blob(stmt, 1);
        if (guid) memcpy(r->file_guid, guid, QMAIL_GUID_SIZE);
        r->recipient_sn = (uint32_t)sqlite3_column_int(stmt, 2);
        r->recipient_denomination = (int8_t)sqlite3_column_int(stmt, 3);
        r->beacon_raida = (uint8_t)sqlite3_column_int(stmt, 4);
        copy_text_column(r->status, sizeof(r->status), stmt, 5);
        r->retry_count = sqlite3_column_int(stmt, 6);
        copy_text_column(r->last_error, sizeof(r->last_error), stmt, 7);
        r->created_at = sqlite3_column_int64(stmt, 8);
        r->last_attempt = sqlite3_column_int64(stmt, 9);
        idx++;
    }
    sqlite3_finalize(stmt);

    *rows_out = rows;
    *count_out = idx;
    return RESULT_SUCCESS;
}

result_t qmail_db_pending_tell_update_status(int64_t tell_id,
                                              const char *new_status,
                                              const char *error_message) {
    if (!s_db) return RESULT_ERROR;

    /* Only increment retry_count on failure retries, not on "sent" transition */
    bool is_retry = (strcmp(new_status, "sent") != 0 &&
                     strcmp(new_status, "failed") != 0);

    const char *sql_retry =
        "UPDATE qmail_pending_tells SET status = ?, last_error = ?,"
        " retry_count = retry_count + 1, last_attempt = ? WHERE id = ?";

    const char *sql_final =
        "UPDATE qmail_pending_tells SET status = ?, last_error = ?,"
        " last_attempt = ? WHERE id = ?";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, is_retry ? sql_retry : sql_final,
                           -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;

    sqlite3_bind_text(stmt, 1, new_status, -1, SQLITE_STATIC);
    if (error_message && error_message[0]) {
        sqlite3_bind_text(stmt, 2, error_message, -1, SQLITE_STATIC);
    } else {
        sqlite3_bind_null(stmt, 2);
    }
    sqlite3_bind_int64(stmt, 3, (int64_t)time(NULL));
    sqlite3_bind_int64(stmt, 4, tell_id);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) return RESULT_ERROR;
    return sqlite3_changes(s_db) > 0 ? RESULT_SUCCESS : RESULT_NOT_FOUND;
}

result_t qmail_db_pending_tell_update_by_file_beacon(
    const uint8_t file_guid[QMAIL_GUID_SIZE],
    uint8_t beacon_raida,
    const char *new_status,
    const uint8_t *context_blob,
    size_t context_blob_size,
    const char *error_message,
    int *updated_count) {
    if (!s_db || !file_guid || !new_status) return RESULT_INVALID_PARAM;
    if (updated_count) *updated_count = 0;

    const char *sql =
        "UPDATE qmail_pending_tells"
        " SET status = ?, last_error = ?,"
        "     tell_context_blob = CASE WHEN ? IS NULL THEN tell_context_blob ELSE ? END,"
        "     last_attempt = ?"
        " WHERE file_guid = ? AND beacon_raida = ?"
        "   AND status IN ('pending', 'failed')";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;

    sqlite3_bind_text(stmt, 1, new_status, -1, SQLITE_STATIC);
    if (error_message && error_message[0]) {
        sqlite3_bind_text(stmt, 2, error_message, -1, SQLITE_STATIC);
    } else {
        sqlite3_bind_null(stmt, 2);
    }
    if (context_blob && context_blob_size > 0) {
        sqlite3_bind_blob(stmt, 3, context_blob, (int)context_blob_size, SQLITE_STATIC);
        sqlite3_bind_blob(stmt, 4, context_blob, (int)context_blob_size, SQLITE_STATIC);
    } else {
        sqlite3_bind_null(stmt, 3);
        sqlite3_bind_null(stmt, 4);
    }
    sqlite3_bind_int64(stmt, 5, (int64_t)time(NULL));
    sqlite3_bind_blob(stmt, 6, file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);
    sqlite3_bind_int(stmt, 7, (int)beacon_raida);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) return RESULT_ERROR;
    if (updated_count) *updated_count = sqlite3_changes(s_db);
    return RESULT_SUCCESS;
}

result_t qmail_db_pending_tell_reset_to_pending(int64_t tell_id) {
    if (!s_db) return RESULT_ERROR;

    /* Only reset 'failed' tells; 'pending' tells already queued */
    const char *sql =
        "UPDATE qmail_pending_tells SET status = 'pending', last_attempt = ?"
        " WHERE id = ? AND status = 'failed'";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;

    sqlite3_bind_int64(stmt, 1, (int64_t)time(NULL));
    sqlite3_bind_int64(stmt, 2, tell_id);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) return RESULT_ERROR;
    return sqlite3_changes(s_db) > 0 ? RESULT_SUCCESS : RESULT_NOT_FOUND;
}

result_t qmail_db_pending_tell_clear_sent(int *deleted_count) {
    if (!s_db) return RESULT_ERROR;

    const char *sql = "DELETE FROM qmail_pending_tells WHERE status = 'sent'";
    char *err = NULL;
    int rc = sqlite3_exec(s_db, sql, NULL, NULL, &err);
    if (rc != SQLITE_OK) {
        if (err) sqlite3_free(err);
        return RESULT_ERROR;
    }
    if (deleted_count) *deleted_count = sqlite3_changes(s_db);
    return RESULT_SUCCESS;
}

result_t qmail_db_pending_tell_get_context(int64_t tell_id,
                                            uint8_t **blob_out,
                                            size_t *blob_size_out) {
    if (!s_db) return RESULT_ERROR;
    *blob_out = NULL;
    *blob_size_out = 0;

    const char *sql = "SELECT tell_context_blob FROM qmail_pending_tells WHERE id = ?";
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;

    sqlite3_bind_int64(stmt, 1, tell_id);

    result_t res = RESULT_NOT_FOUND;
    if (sqlite3_step(stmt) == SQLITE_ROW) {
        const void *data = sqlite3_column_blob(stmt, 0);
        int size = sqlite3_column_bytes(stmt, 0);
        if (data && size > 0) {
            *blob_out = malloc((size_t)size);
            if (*blob_out) {
                memcpy(*blob_out, data, (size_t)size);
                *blob_size_out = (size_t)size;
                res = RESULT_SUCCESS;
            } else {
                res = RESULT_ERROR;
            }
        } else {
            res = RESULT_NOT_FOUND; /* No context blob saved */
        }
    }
    sqlite3_finalize(stmt);
    return res;
}

// ============================================================================
// RECEIVED TELL MANAGEMENT
// ============================================================================

result_t qmail_db_tell_trash(int64_t tell_id) {
    if (!s_db) return RESULT_ERROR;

    const char *sql = "UPDATE qmail_received_tells SET is_trashed = 1 WHERE id = ?";
    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;

    sqlite3_bind_int64(stmt, 1, tell_id);
    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) return RESULT_ERROR;
    return sqlite3_changes(s_db) > 0 ? RESULT_SUCCESS : RESULT_NOT_FOUND;
}

// ============================================================================
// NOTIFICATIONS (received tells not yet downloaded, with sender info)
// ============================================================================

result_t qmail_db_notifications_list(qmail_notification_row_t **rows_out,
                                      int *count_out,
                                      int limit) {
    if (!s_db) return RESULT_ERROR;
    *rows_out = NULL;
    *count_out = 0;

    if (limit <= 0) limit = 50;

    const char *sql =
        "SELECT t.id, t.file_guid, t.sender_sn, t.sender_denomination, t.tell_type, t.total_file_size,"
        " t.timestamp, t.downloaded,"
        " c.first_name, c.last_name"
        " FROM qmail_received_tells t"
        " LEFT JOIN qmail_contacts c ON c.serial_number = t.sender_sn"
        " WHERE t.is_trashed = 0 AND t.downloaded = 0"
        " ORDER BY t.timestamp DESC LIMIT ?";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "notifications_list prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    sqlite3_bind_int(stmt, 1, limit);

    /* First pass: count rows */
    int capacity = 64;
    qmail_notification_row_t *rows = calloc((size_t)capacity, sizeof(qmail_notification_row_t));
    if (!rows) { sqlite3_finalize(stmt); return RESULT_ERROR; }

    int idx = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        if (idx >= capacity) {
            capacity *= 2;
            qmail_notification_row_t *tmp = realloc(rows, (size_t)capacity * sizeof(qmail_notification_row_t));
            if (!tmp) break;
            rows = tmp;
        }
        qmail_notification_row_t *r = &rows[idx];
        memset(r, 0, sizeof(*r));
        r->id = sqlite3_column_int64(stmt, 0);
        const void *guid = sqlite3_column_blob(stmt, 1);
        if (guid) memcpy(r->file_guid, guid, QMAIL_GUID_SIZE);
        r->sender_sn = (uint32_t)sqlite3_column_int(stmt, 2);
        r->sender_denomination = (uint8_t)sqlite3_column_int(stmt, 3);
        r->tell_type = (uint8_t)sqlite3_column_int(stmt, 4);
        r->total_file_size = (uint32_t)sqlite3_column_int(stmt, 5);
        r->timestamp = sqlite3_column_int64(stmt, 6);
        r->downloaded = sqlite3_column_int(stmt, 7) != 0;
        copy_text_column(r->sender_first_name, sizeof(r->sender_first_name), stmt, 8);
        copy_text_column(r->sender_last_name, sizeof(r->sender_last_name), stmt, 9);
        idx++;
    }
    sqlite3_finalize(stmt);

    *rows_out = rows;
    *count_out = idx;
    return RESULT_SUCCESS;
}

// ============================================================================
// PAYMENT (locker code lookup from received tells)
// ============================================================================

result_t qmail_db_tell_get_payment_info(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                         uint8_t locker_code_out[16],
                                         int *payment_status_out) {
    if (!s_db || !file_guid) return RESULT_INVALID_PARAM;

    const char *sql =
        "SELECT locker_code, payment_status FROM qmail_received_tells WHERE file_guid = ?";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;

    sqlite3_bind_blob(stmt, 1, file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);
    int rc = sqlite3_step(stmt);

    if (rc == SQLITE_ROW) {
        const void *blob = sqlite3_column_blob(stmt, 0);
        int blob_len = sqlite3_column_bytes(stmt, 0);
        if (locker_code_out) {
            memset(locker_code_out, 0, 16);
            if (blob && blob_len > 0) {
                memcpy(locker_code_out, blob, blob_len < 16 ? (size_t)blob_len : 16);
            }
        }
        if (payment_status_out) {
            *payment_status_out = sqlite3_column_int(stmt, 1);
        }
        sqlite3_finalize(stmt);
        return RESULT_SUCCESS;
    }

    sqlite3_finalize(stmt);
    return RESULT_NOT_FOUND;
}

result_t qmail_db_tell_update_payment_status(const uint8_t file_guid[QMAIL_GUID_SIZE],
                                              int payment_status) {
    if (!s_db || !file_guid) return RESULT_INVALID_PARAM;

    const char *sql =
        "UPDATE qmail_received_tells SET payment_status = ? WHERE file_guid = ?";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;

    sqlite3_bind_int(stmt, 1, payment_status);
    sqlite3_bind_blob(stmt, 2, file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) return RESULT_ERROR;
    return sqlite3_changes(s_db) > 0 ? RESULT_SUCCESS : RESULT_NOT_FOUND;
}

// ============================================================================
// DRAFTS (emails in folder=DRAFTS)
// ============================================================================

result_t qmail_db_drafts_list(int limit, int offset,
                               qmail_email_t **emails_out, int *count_out,
                               int *total_out) {
    if (!s_db) return RESULT_ERROR;
    *emails_out = NULL;
    *count_out = 0;
    if (total_out) *total_out = 0;

    if (limit <= 0) limit = 50;
    if (limit > 200) limit = 200;
    if (offset < 0) offset = 0;

    /* Get total count */
    if (total_out) {
        const char *count_sql =
            "SELECT COUNT(*) FROM qmail_emails WHERE folder = ? AND is_trashed = 0";
        sqlite3_stmt *cs = NULL;
        if (sqlite3_prepare_v2(s_db, count_sql, -1, &cs, NULL) == SQLITE_OK) {
            sqlite3_bind_int(cs, 1, QMAIL_FOLDER_DRAFTS);
            if (sqlite3_step(cs) == SQLITE_ROW) {
                *total_out = sqlite3_column_int(cs, 0);
            }
            sqlite3_finalize(cs);
        }
    }

    const char *sql =
        "SELECT email_id, subject, body, received_timestamp, sent_timestamp,"
        " is_read, is_starred, is_trashed, folder, sender_sn, sender_denomination, inbox_fee"
        " FROM qmail_emails WHERE folder = ? AND is_trashed = 0"
        " ORDER BY sent_timestamp DESC LIMIT ? OFFSET ?";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "drafts_list prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    sqlite3_bind_int(stmt, 1, QMAIL_FOLDER_DRAFTS);
    sqlite3_bind_int(stmt, 2, limit);
    sqlite3_bind_int(stmt, 3, offset);

    int capacity = 32;
    qmail_email_t *list = calloc((size_t)capacity, sizeof(qmail_email_t));
    if (!list) { sqlite3_finalize(stmt); return RESULT_ERROR; }

    int idx = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        if (idx >= capacity) {
            capacity *= 2;
            qmail_email_t *tmp = realloc(list, (size_t)capacity * sizeof(qmail_email_t));
            if (!tmp) break;
            list = tmp;
        }
        read_email_row(stmt, &list[idx]);
        idx++;
    }
    sqlite3_finalize(stmt);

    /* Load recipients for each draft */
    for (int i = 0; i < idx; i++) {
        load_email_recipients(&list[i]);
    }

    *emails_out = list;
    *count_out = idx;
    return RESULT_SUCCESS;
}

result_t qmail_db_draft_save(qmail_email_t *email) {
    if (!s_db || !email) return RESULT_INVALID_PARAM;

    /* Force folder to drafts */
    email->folder = QMAIL_FOLDER_DRAFTS;
    email->is_read = true;  /* Drafts are always "read" */

    return qmail_db_email_insert(email);
}

result_t qmail_db_draft_update(const uint8_t email_id[QMAIL_GUID_SIZE],
                                const char *subject,
                                const char *body,
                                size_t body_len) {
    if (!s_db || !email_id) return RESULT_INVALID_PARAM;

    /* Verify the email exists and is a draft */
    const char *check_sql =
        "SELECT 1 FROM qmail_emails WHERE email_id = ? AND folder = ?";
    sqlite3_stmt *cs = NULL;
    if (sqlite3_prepare_v2(s_db, check_sql, -1, &cs, NULL) != SQLITE_OK)
        return RESULT_ERROR;
    sqlite3_bind_blob(cs, 1, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    sqlite3_bind_int(cs, 2, QMAIL_FOLDER_DRAFTS);
    int rc = sqlite3_step(cs);
    sqlite3_finalize(cs);
    if (rc != SQLITE_ROW) return RESULT_NOT_FOUND;

    /* Update only provided fields. NULL pointer = "don't change",
     * empty string = "clear the field" (allows emptying subject/body).
     * Uses a flag parameter: 1 = update this field, 0 = keep old value. */
    const char *sql =
        "UPDATE qmail_emails SET sent_timestamp = ?,"
        " subject = CASE WHEN ? = 1 THEN ? ELSE subject END,"
        " body = CASE WHEN ? = 1 THEN ? ELSE body END"
        " WHERE email_id = ? AND folder = ?";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;

    sqlite3_bind_int64(stmt, 1, (int64_t)time(NULL));
    /* subject: flag (param 2) + value (param 3) */
    sqlite3_bind_int(stmt, 2, subject != NULL ? 1 : 0);
    if (subject) sqlite3_bind_text(stmt, 3, subject, -1, SQLITE_STATIC);
    else         sqlite3_bind_text(stmt, 3, "", -1, SQLITE_STATIC);
    /* body: flag (param 4) + value (param 5) */
    sqlite3_bind_int(stmt, 4, body != NULL ? 1 : 0);
    if (body)    sqlite3_bind_text(stmt, 5, body, (int)body_len, SQLITE_STATIC);
    else         sqlite3_bind_text(stmt, 5, "", -1, SQLITE_STATIC);
    sqlite3_bind_blob(stmt, 6, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    sqlite3_bind_int(stmt, 7, QMAIL_FOLDER_DRAFTS);

    rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) return RESULT_ERROR;
    return sqlite3_changes(s_db) > 0 ? RESULT_SUCCESS : RESULT_NOT_FOUND;
}

result_t qmail_db_draft_update_recipients(const uint8_t email_id[QMAIL_GUID_SIZE],
                                           const qmail_recipient_entry_t *recipients,
                                           int recipient_count) {
    if (!s_db || !email_id) return RESULT_INVALID_PARAM;

    /* Verify the email is a draft before modifying recipients */
    const char *check_sql =
        "SELECT 1 FROM qmail_emails WHERE email_id = ? AND folder = ?";
    sqlite3_stmt *vs = NULL;
    if (sqlite3_prepare_v2(s_db, check_sql, -1, &vs, NULL) != SQLITE_OK)
        return RESULT_ERROR;
    sqlite3_bind_blob(vs, 1, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
    sqlite3_bind_int(vs, 2, QMAIL_FOLDER_DRAFTS);
    int vrc = sqlite3_step(vs);
    sqlite3_finalize(vs);
    if (vrc != SQLITE_ROW) return RESULT_NOT_FOUND;

    /* Clear existing recipients for this draft */
    const char *del_sql = "DELETE FROM qmail_email_contacts WHERE email_id = ?";
    sqlite3_stmt *ds = NULL;
    if (sqlite3_prepare_v2(s_db, del_sql, -1, &ds, NULL) == SQLITE_OK) {
        sqlite3_bind_blob(ds, 1, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
        sqlite3_step(ds);
        sqlite3_finalize(ds);
    }

    /* Insert new recipients */
    if (recipients && recipient_count > 0) {
        const char *ins_sql =
            "INSERT OR REPLACE INTO qmail_email_contacts"
            " (email_id, serial_number, user_type) VALUES (?, ?, ?)";
        for (int i = 0; i < recipient_count; i++) {
            sqlite3_stmt *is = NULL;
            if (sqlite3_prepare_v2(s_db, ins_sql, -1, &is, NULL) != SQLITE_OK) continue;
            sqlite3_bind_blob(is, 1, email_id, QMAIL_GUID_SIZE, SQLITE_STATIC);
            sqlite3_bind_int64(is, 2, (int64_t)recipients[i].serial_number);
            sqlite3_bind_int(is, 3, recipients[i].recipient_type);
            sqlite3_step(is);
            sqlite3_finalize(is);
        }
    }

    return RESULT_SUCCESS;
}

// ============================================================================
// LOCKER POOL
// ============================================================================

result_t qmail_db_locker_pool_insert(const char *locker_key, int pool_type,
                                      int funded_amount, int initial_status) {
    if (!s_db || !locker_key) return RESULT_INVALID_PARAM;

    const char *sql =
        "INSERT INTO qmail_locker_pool"
        " (locker_key, pool_type, funded_amount, status, created_at)"
        " VALUES (?, ?, ?, ?, ?)";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        log_error(LOG_CAT_COMMAND, "locker_pool_insert prepare: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_text(stmt, 1, locker_key, -1, SQLITE_STATIC);
    sqlite3_bind_int(stmt, 2, pool_type);
    sqlite3_bind_int(stmt, 3, funded_amount);
    sqlite3_bind_int(stmt, 4, initial_status);
    sqlite3_bind_int64(stmt, 5, (int64_t)time(NULL));

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    return (rc == SQLITE_DONE) ? RESULT_SUCCESS : RESULT_ERROR;
}

result_t qmail_db_locker_pool_acquire(int pool_type, int min_amount,
                                       int max_count,
                                       char keys_out[][QMAIL_LOCKER_KEY_MAX_LEN],
                                       int *count_out) {
    if (!s_db || !keys_out || !count_out) return RESULT_INVALID_PARAM;
    *count_out = 0;

    /* Use BEGIN IMMEDIATE for write-lock atomicity */
    if (sqlite3_exec(s_db, "BEGIN IMMEDIATE", NULL, NULL, NULL) != SQLITE_OK)
        return RESULT_ERROR;

    const char *sel_sql =
        "SELECT id, locker_key FROM qmail_locker_pool"
        " WHERE status = 0 AND pool_type = ? AND funded_amount >= ?"
        " ORDER BY id LIMIT ?";

    sqlite3_stmt *sel = NULL;
    if (sqlite3_prepare_v2(s_db, sel_sql, -1, &sel, NULL) != SQLITE_OK) {
        sqlite3_exec(s_db, "ROLLBACK", NULL, NULL, NULL);
        return RESULT_ERROR;
    }

    sqlite3_bind_int(sel, 1, pool_type);
    sqlite3_bind_int(sel, 2, min_amount);
    sqlite3_bind_int(sel, 3, max_count);

    int64_t ids[QMAIL_MAX_SERVERS];
    int n = 0;

    while (sqlite3_step(sel) == SQLITE_ROW && n < max_count) {
        ids[n] = sqlite3_column_int64(sel, 0);
        const char *key = (const char *)sqlite3_column_text(sel, 1);
        if (key) {
            strncpy(keys_out[n], key, QMAIL_LOCKER_KEY_MAX_LEN - 1);
            keys_out[n][QMAIL_LOCKER_KEY_MAX_LEN - 1] = '\0';
        } else {
            keys_out[n][0] = '\0';
        }
        n++;
    }
    sqlite3_finalize(sel);

    /* Mark selected rows as reserved */
    if (n > 0) {
        const char *upd_sql =
            "UPDATE qmail_locker_pool SET status = 1 WHERE id = ?";
        for (int i = 0; i < n; i++) {
            sqlite3_stmt *upd = NULL;
            if (sqlite3_prepare_v2(s_db, upd_sql, -1, &upd, NULL) == SQLITE_OK) {
                sqlite3_bind_int64(upd, 1, ids[i]);
                sqlite3_step(upd);
                sqlite3_finalize(upd);
            }
        }
    }

    sqlite3_exec(s_db, "COMMIT", NULL, NULL, NULL);
    *count_out = n;
    return RESULT_SUCCESS;
}

result_t qmail_db_locker_pool_stamp_file_guid(const char *locker_key,
                                              const uint8_t *file_guid) {
    if (!s_db || !locker_key) return RESULT_INVALID_PARAM;

    const char *sql =
        "UPDATE qmail_locker_pool SET file_guid = ?"
        " WHERE locker_key = ?";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        log_error(LOG_CAT_COMMAND, "locker_pool_stamp_file_guid prepare: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    if (file_guid) {
        sqlite3_bind_blob(stmt, 1, file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);
    } else {
        sqlite3_bind_null(stmt, 1);
    }
    sqlite3_bind_text(stmt, 2, locker_key, -1, SQLITE_STATIC);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) return RESULT_ERROR;
    return (sqlite3_changes(s_db) > 0) ? RESULT_SUCCESS : RESULT_NOT_FOUND;
}

result_t qmail_db_locker_pool_consume(const char *locker_key) {
    if (!s_db || !locker_key) return RESULT_INVALID_PARAM;

    const char *sql =
        "UPDATE qmail_locker_pool SET status = 2, consumed_at = ?"
        " WHERE locker_key = ? AND status = 1";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;

    sqlite3_bind_int64(stmt, 1, (int64_t)time(NULL));
    sqlite3_bind_text(stmt, 2, locker_key, -1, SQLITE_STATIC);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) return RESULT_ERROR;
    return (sqlite3_changes(s_db) > 0) ? RESULT_SUCCESS : RESULT_NOT_FOUND;
}

result_t qmail_db_locker_pool_release(const char *locker_key) {
    if (!s_db || !locker_key) return RESULT_INVALID_PARAM;

    const char *sql =
        "UPDATE qmail_locker_pool SET status = 0"
        " WHERE locker_key = ? AND status = 1";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;

    sqlite3_bind_text(stmt, 1, locker_key, -1, SQLITE_STATIC);
    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) return RESULT_ERROR;
    return (sqlite3_changes(s_db) > 0) ? RESULT_SUCCESS : RESULT_NOT_FOUND;
}

result_t qmail_db_locker_pool_move_reserved_to_limbo(int *count_out) {
    if (!s_db) return RESULT_ERROR;

    const char *sql =
        "UPDATE qmail_locker_pool SET status = ?"
        " WHERE status = ?";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        log_error(LOG_CAT_COMMAND, "locker_pool_move_reserved_to_limbo prepare: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }

    sqlite3_bind_int(stmt, 1, QMAIL_POOL_STATUS_LIMBO);
    sqlite3_bind_int(stmt, 2, QMAIL_POOL_STATUS_RESERVED);

    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    if (rc != SQLITE_DONE) return RESULT_ERROR;

    if (count_out) {
        *count_out = sqlite3_changes(s_db);
    }

    return RESULT_SUCCESS;
}

int qmail_db_locker_pool_count(int pool_type, int status) {
    if (!s_db) return 0;

    const char *sql =
        "SELECT COUNT(*) FROM qmail_locker_pool"
        " WHERE pool_type = ? AND status = ?";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) return 0;

    sqlite3_bind_int(stmt, 1, pool_type);
    sqlite3_bind_int(stmt, 2, status);

    int count = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW)
        count = sqlite3_column_int(stmt, 0);
    sqlite3_finalize(stmt);
    return count;
}

int qmail_db_locker_pool_value(int pool_type, int status) {
    if (!s_db) return 0;

    const char *sql =
        "SELECT COALESCE(SUM(funded_amount), 0) FROM qmail_locker_pool"
        " WHERE pool_type = ? AND status = ?";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) return 0;

    sqlite3_bind_int(stmt, 1, pool_type);
    sqlite3_bind_int(stmt, 2, status);

    int value = 0;
    if (sqlite3_step(stmt) == SQLITE_ROW)
        value = sqlite3_column_int(stmt, 0);
    sqlite3_finalize(stmt);
    return value;
}

result_t qmail_db_locker_pool_cleanup(int max_age_seconds) {
    if (!s_db) return RESULT_ERROR;

    int64_t cutoff = (int64_t)time(NULL) - max_age_seconds;
    const char *sql =
        "DELETE FROM qmail_locker_pool"
        " WHERE status = ? AND consumed_at < ?";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK)
        return RESULT_ERROR;

    sqlite3_bind_int(stmt, 1, QMAIL_POOL_STATUS_CONSUMED);
    sqlite3_bind_int64(stmt, 2, cutoff);
    int rc = sqlite3_step(stmt);
    sqlite3_finalize(stmt);

    return (rc == SQLITE_DONE) ? RESULT_SUCCESS : RESULT_ERROR;
}

// ============================================================================
// SENT-PAYMENTS REPORT (read-only views over qmail_sent_emails / pool)
// ============================================================================

/* Copy a TEXT column into a fixed-size buffer, NUL-terminated and length-safe.
 * Mirrors copy_text_column() above but kept local so this section can be moved
 * without ordering surprises. */
static void copy_text_column_bounded(char *dst, size_t dst_size,
                                     sqlite3_stmt *stmt, int col) {
    if (!dst || dst_size == 0) return;
    const unsigned char *src = sqlite3_column_text(stmt, col);
    if (!src) { dst[0] = '\0'; return; }
    /* strncpy + force-terminate; truncation is fine for list-view fields. */
    size_t i = 0;
    for (; i < dst_size - 1 && src[i]; i++) dst[i] = (char)src[i];
    dst[i] = '\0';
}

result_t qmail_db_sent_list(int limit, int offset,
                             qmail_sent_row_t **rows_out, int *count_out,
                             int *total_out) {
    if (!s_db || !rows_out || !count_out) return RESULT_INVALID_PARAM;
    *rows_out = NULL;
    *count_out = 0;
    if (total_out) *total_out = 0;

    if (limit <= 0)   limit  = 50;
    if (limit > 200)  limit  = 200;
    if (offset < 0)   offset = 0;

    if (total_out) {
        const char *count_sql = "SELECT COUNT(*) FROM qmail_sent_emails";
        sqlite3_stmt *cs = NULL;
        if (sqlite3_prepare_v2(s_db, count_sql, -1, &cs, NULL) == SQLITE_OK) {
            if (sqlite3_step(cs) == SQLITE_ROW) {
                *total_out = sqlite3_column_int(cs, 0);
            }
            sqlite3_finalize(cs);
        }
    }

    const char *sql =
        "SELECT file_guid, subject, recipients, body_preview, timestamp"
        " FROM qmail_sent_emails"
        " ORDER BY timestamp DESC, id DESC"
        " LIMIT ? OFFSET ?";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "sent_list prepare: %s", sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    sqlite3_bind_int(stmt, 1, limit);
    sqlite3_bind_int(stmt, 2, offset);

    int capacity = 32;
    qmail_sent_row_t *list = calloc((size_t)capacity, sizeof(qmail_sent_row_t));
    if (!list) { sqlite3_finalize(stmt); return RESULT_ERROR; }

    int idx = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        if (idx >= capacity) {
            int new_capacity = capacity * 2;
            qmail_sent_row_t *tmp =
                realloc(list, (size_t)new_capacity * sizeof(qmail_sent_row_t));
            if (!tmp) break;
            /* Zero the new tail so partial-row failures don't leak garbage. */
            memset(tmp + capacity, 0,
                   (size_t)(new_capacity - capacity) * sizeof(qmail_sent_row_t));
            list = tmp;
            capacity = new_capacity;
        }

        qmail_sent_row_t *r = &list[idx];

        const void *blob = sqlite3_column_blob(stmt, 0);
        int blob_len = sqlite3_column_bytes(stmt, 0);
        memset(r->file_guid, 0, QMAIL_GUID_SIZE);
        if (blob && blob_len > 0) {
            memcpy(r->file_guid, blob,
                   blob_len < QMAIL_GUID_SIZE ? (size_t)blob_len : QMAIL_GUID_SIZE);
        }

        copy_text_column_bounded(r->subject,      sizeof(r->subject),      stmt, 1);
        copy_text_column_bounded(r->recipients,   sizeof(r->recipients),   stmt, 2);
        copy_text_column_bounded(r->body_preview, sizeof(r->body_preview), stmt, 3);
        r->timestamp = sqlite3_column_int64(stmt, 4);

        idx++;
    }
    sqlite3_finalize(stmt);

    *rows_out = list;
    *count_out = idx;
    return RESULT_SUCCESS;
}

result_t qmail_db_locker_pool_list_consumed_for_guid(
    const uint8_t file_guid[QMAIL_GUID_SIZE],
    qmail_pool_consumed_row_t **rows_out,
    int *count_out)
{
    if (!s_db || !file_guid || !rows_out || !count_out) return RESULT_INVALID_PARAM;
    *rows_out = NULL;
    *count_out = 0;

    /* Order matches the chronological "what we spent" view: storage lockers
     * are confirmed before the inbox-fee in the orchestrator, so consumed_at
     * ASC produces the natural send-time sequence. */
    const char *sql =
        "SELECT locker_key, pool_type, funded_amount, consumed_at"
        " FROM qmail_locker_pool"
        " WHERE file_guid = ? AND status = ?"
        " ORDER BY consumed_at ASC, id ASC";

    sqlite3_stmt *stmt = NULL;
    if (sqlite3_prepare_v2(s_db, sql, -1, &stmt, NULL) != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "pool_list_consumed prepare: %s",
                  sqlite3_errmsg(s_db));
        return RESULT_ERROR;
    }
    sqlite3_bind_blob(stmt, 1, file_guid, QMAIL_GUID_SIZE, SQLITE_STATIC);
    sqlite3_bind_int (stmt, 2, QMAIL_POOL_STATUS_CONSUMED);

    int capacity = 8;
    qmail_pool_consumed_row_t *list =
        calloc((size_t)capacity, sizeof(qmail_pool_consumed_row_t));
    if (!list) { sqlite3_finalize(stmt); return RESULT_ERROR; }

    int idx = 0;
    while (sqlite3_step(stmt) == SQLITE_ROW) {
        if (idx >= capacity) {
            int new_capacity = capacity * 2;
            qmail_pool_consumed_row_t *tmp =
                realloc(list, (size_t)new_capacity * sizeof(qmail_pool_consumed_row_t));
            if (!tmp) break;
            memset(tmp + capacity, 0,
                   (size_t)(new_capacity - capacity) * sizeof(qmail_pool_consumed_row_t));
            list = tmp;
            capacity = new_capacity;
        }

        qmail_pool_consumed_row_t *r = &list[idx];
        copy_text_column_bounded(r->locker_key, sizeof(r->locker_key), stmt, 0);
        r->pool_type     = sqlite3_column_int  (stmt, 1);
        r->funded_amount = sqlite3_column_int  (stmt, 2);
        r->consumed_at   = sqlite3_column_int64(stmt, 3);
        idx++;
    }
    sqlite3_finalize(stmt);

    *rows_out = list;
    *count_out = idx;
    return RESULT_SUCCESS;
}
