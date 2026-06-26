/**
 * qmail_transfer_store.c - SQLite persistence for Object Transfer operations
 */

#include "qmail/qmail_transfer_store.h"
#include "logging.h"
#include "platform.h"
#include "sqlite3.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static sqlite3 *s_transfer_db = NULL;
static mutex_t s_transfer_db_mutex;
static bool s_transfer_db_mutex_ready = false;

static const char *TRANSFER_COLUMNS =
    "operation_id,direction,state,raida_id,transfer_id,object_id,locker_code,"
    "locker_key,file_type,operation,requested_storage_class,storage_class,requested_retention,"
    "accepted_retention,expected_generation,target_generation,generation,"
    "total_size,completed_bytes,preferred_chunk,accepted_chunk,requested_range,"
    "recommended_range,max_parallel,expires_at,object_hash,source_path,"
    "destination_path,temporary_path,wallet_path,task_id,cancel_requested,"
    "locker_consumed,begin_request_frozen,retry_count,last_result,last_status,error_message,"
    "created_at,updated_at";

static void store_lock(void) {
    if (s_transfer_db_mutex_ready) mutex_lock(&s_transfer_db_mutex);
}

static void store_unlock(void) {
    if (s_transfer_db_mutex_ready) mutex_unlock(&s_transfer_db_mutex);
}

static void u64_to_text(uint64_t value, char out[32]) {
#ifdef _WIN32
    snprintf(out, 32, "%I64u", (unsigned long long)value);
#else
    snprintf(out, 32, "%llu", (unsigned long long)value);
#endif
}

static uint64_t text_to_u64(const unsigned char *text) {
    unsigned long long parsed = 0;
    if (!text) return 0;
#ifdef _WIN32
    if (sscanf((const char *)text, "%I64u", &parsed) != 1) return 0;
#else
    if (sscanf((const char *)text, "%llu", &parsed) != 1) return 0;
#endif
    return (uint64_t)parsed;
}

static int bind_u64(sqlite3_stmt *stmt, int index, uint64_t value) {
    char text[32];
    u64_to_text(value, text);
    return sqlite3_bind_text(stmt, index, text, -1, SQLITE_TRANSIENT);
}

static void copy_text(char *out, size_t out_size,
                      sqlite3_stmt *stmt, int column) {
    const unsigned char *text = sqlite3_column_text(stmt, column);
    snprintf(out, out_size, "%s", text ? (const char *)text : "");
}

static void copy_blob(uint8_t *out, size_t out_size,
                      sqlite3_stmt *stmt, int column) {
    const void *blob = sqlite3_column_blob(stmt, column);
    int size = sqlite3_column_bytes(stmt, column);
    memset(out, 0, out_size);
    if (blob && size > 0) {
        size_t copy_size = (size_t)size < out_size ? (size_t)size : out_size;
        memcpy(out, blob, copy_size);
    }
}

static void read_transfer(sqlite3_stmt *stmt, qmail_transfer_record_t *record) {
    int c = 0;
    memset(record, 0, sizeof(*record));
    copy_blob(record->operation_id, sizeof(record->operation_id), stmt, c++);
    record->direction = (qmail_transfer_direction_t)sqlite3_column_int(stmt, c++);
    record->state = (qmail_transfer_state_t)sqlite3_column_int(stmt, c++);
    record->raida_id = (uint8_t)sqlite3_column_int(stmt, c++);
    copy_blob(record->transfer_id, sizeof(record->transfer_id), stmt, c++);
    copy_blob(record->object_id, sizeof(record->object_id), stmt, c++);
    copy_blob(record->locker_code, sizeof(record->locker_code), stmt, c++);
    copy_text(record->locker_key, sizeof(record->locker_key), stmt, c++);
    record->file_type = (uint8_t)sqlite3_column_int(stmt, c++);
    record->operation = (uint8_t)sqlite3_column_int(stmt, c++);
    record->requested_storage_class =
        (uint16_t)sqlite3_column_int(stmt, c++);
    record->storage_class = (uint16_t)sqlite3_column_int(stmt, c++);
    record->requested_retention_seconds =
        text_to_u64(sqlite3_column_text(stmt, c++));
    record->accepted_retention_seconds =
        text_to_u64(sqlite3_column_text(stmt, c++));
    record->expected_generation =
        text_to_u64(sqlite3_column_text(stmt, c++));
    record->target_generation =
        text_to_u64(sqlite3_column_text(stmt, c++));
    record->generation = text_to_u64(sqlite3_column_text(stmt, c++));
    record->total_size = text_to_u64(sqlite3_column_text(stmt, c++));
    record->completed_bytes = text_to_u64(sqlite3_column_text(stmt, c++));
    record->preferred_chunk = (uint32_t)sqlite3_column_int64(stmt, c++);
    record->accepted_chunk = (uint32_t)sqlite3_column_int64(stmt, c++);
    record->requested_range = (uint32_t)sqlite3_column_int64(stmt, c++);
    record->recommended_range = (uint32_t)sqlite3_column_int64(stmt, c++);
    record->max_parallel = (uint16_t)sqlite3_column_int(stmt, c++);
    record->expires_at = text_to_u64(sqlite3_column_text(stmt, c++));
    copy_blob(record->object_hash, sizeof(record->object_hash), stmt, c++);
    copy_text(record->source_path, sizeof(record->source_path), stmt, c++);
    copy_text(record->destination_path, sizeof(record->destination_path), stmt, c++);
    copy_text(record->temporary_path, sizeof(record->temporary_path), stmt, c++);
    copy_text(record->wallet_path, sizeof(record->wallet_path), stmt, c++);
    copy_text(record->task_id, sizeof(record->task_id), stmt, c++);
    record->cancel_requested = sqlite3_column_int(stmt, c++) != 0;
    record->locker_consumed = sqlite3_column_int(stmt, c++) != 0;
    record->begin_request_frozen = sqlite3_column_int(stmt, c++) != 0;
    record->retry_count = sqlite3_column_int(stmt, c++);
    record->last_result = sqlite3_column_int(stmt, c++);
    record->last_status = (uint8_t)sqlite3_column_int(stmt, c++);
    copy_text(record->error_message, sizeof(record->error_message), stmt, c++);
    record->created_at = sqlite3_column_int64(stmt, c++);
    record->updated_at = sqlite3_column_int64(stmt, c++);
}

static result_t bind_transfer(sqlite3_stmt *stmt,
                              const qmail_transfer_record_t *record) {
    int i = 1;
    sqlite3_bind_blob(stmt, i++, record->operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
    sqlite3_bind_int(stmt, i++, record->direction);
    sqlite3_bind_int(stmt, i++, record->state);
    sqlite3_bind_int(stmt, i++, record->raida_id);
    sqlite3_bind_blob(stmt, i++, record->transfer_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
    sqlite3_bind_blob(stmt, i++, record->object_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
    sqlite3_bind_blob(stmt, i++, record->locker_code, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
    sqlite3_bind_text(stmt, i++, record->locker_key, -1, SQLITE_STATIC);
    sqlite3_bind_int(stmt, i++, record->file_type);
    sqlite3_bind_int(stmt, i++, record->operation);
    sqlite3_bind_int(stmt, i++, record->requested_storage_class);
    sqlite3_bind_int(stmt, i++, record->storage_class);
    bind_u64(stmt, i++, record->requested_retention_seconds);
    bind_u64(stmt, i++, record->accepted_retention_seconds);
    bind_u64(stmt, i++, record->expected_generation);
    bind_u64(stmt, i++, record->target_generation);
    bind_u64(stmt, i++, record->generation);
    bind_u64(stmt, i++, record->total_size);
    bind_u64(stmt, i++, record->completed_bytes);
    sqlite3_bind_int64(stmt, i++, record->preferred_chunk);
    sqlite3_bind_int64(stmt, i++, record->accepted_chunk);
    sqlite3_bind_int64(stmt, i++, record->requested_range);
    sqlite3_bind_int64(stmt, i++, record->recommended_range);
    sqlite3_bind_int(stmt, i++, record->max_parallel);
    bind_u64(stmt, i++, record->expires_at);
    sqlite3_bind_blob(stmt, i++, record->object_hash, QMAIL_OT_HASH_SIZE, SQLITE_STATIC);
    sqlite3_bind_text(stmt, i++, record->source_path, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, i++, record->destination_path, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, i++, record->temporary_path, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, i++, record->wallet_path, -1, SQLITE_STATIC);
    sqlite3_bind_text(stmt, i++, record->task_id, -1, SQLITE_STATIC);
    sqlite3_bind_int(stmt, i++, record->cancel_requested ? 1 : 0);
    sqlite3_bind_int(stmt, i++, record->locker_consumed ? 1 : 0);
    sqlite3_bind_int(stmt, i++, record->begin_request_frozen ? 1 : 0);
    sqlite3_bind_int(stmt, i++, record->retry_count);
    sqlite3_bind_int(stmt, i++, record->last_result);
    sqlite3_bind_int(stmt, i++, record->last_status);
    sqlite3_bind_text(stmt, i++, record->error_message, -1, SQLITE_STATIC);
    sqlite3_bind_int64(stmt, i++, record->created_at);
    sqlite3_bind_int64(stmt, i++, record->updated_at);
    return RESULT_SUCCESS;
}

result_t qmail_transfer_store_open(const char *db_path) {
    static const char *schema =
        "PRAGMA journal_mode=WAL;"
        "PRAGMA foreign_keys=ON;"
        "CREATE TABLE IF NOT EXISTS qmail_object_transfers ("
        " operation_id BLOB PRIMARY KEY,"
        " direction INTEGER NOT NULL,"
        " state INTEGER NOT NULL,"
        " raida_id INTEGER NOT NULL,"
        " transfer_id BLOB,"
        " object_id BLOB NOT NULL,"
        " locker_code BLOB,"
        " locker_key TEXT,"
        " file_type INTEGER NOT NULL,"
        " operation INTEGER DEFAULT 0,"
        " requested_storage_class INTEGER DEFAULT 0,"
        " storage_class INTEGER DEFAULT 0,"
        " requested_retention TEXT DEFAULT '0',"
        " accepted_retention TEXT DEFAULT '0',"
        " expected_generation TEXT DEFAULT '0',"
        " target_generation TEXT DEFAULT '0',"
        " generation TEXT DEFAULT '0',"
        " total_size TEXT DEFAULT '0',"
        " completed_bytes TEXT DEFAULT '0',"
        " preferred_chunk INTEGER DEFAULT 0,"
        " accepted_chunk INTEGER DEFAULT 0,"
        " requested_range INTEGER DEFAULT 0,"
        " recommended_range INTEGER DEFAULT 0,"
        " max_parallel INTEGER DEFAULT 1,"
        " expires_at TEXT DEFAULT '0',"
        " object_hash BLOB,"
        " source_path TEXT,"
        " destination_path TEXT,"
        " temporary_path TEXT,"
        " wallet_path TEXT,"
        " task_id TEXT,"
        " cancel_requested INTEGER DEFAULT 0,"
        " locker_consumed INTEGER DEFAULT 0,"
        " begin_request_frozen INTEGER DEFAULT 0,"
        " retry_count INTEGER DEFAULT 0,"
        " last_result INTEGER DEFAULT 0,"
        " last_status INTEGER DEFAULT 0,"
        " error_message TEXT,"
        " created_at INTEGER,"
        " updated_at INTEGER"
        ");"
        "CREATE INDEX IF NOT EXISTS idx_qmail_object_transfers_state"
        " ON qmail_object_transfers(state, updated_at);"
        "CREATE TABLE IF NOT EXISTS qmail_object_transfer_ranges ("
        " operation_id BLOB NOT NULL,"
        " range_offset TEXT NOT NULL,"
        " range_length TEXT NOT NULL,"
        " state INTEGER NOT NULL DEFAULT 0,"
        " retries INTEGER NOT NULL DEFAULT 0,"
        " last_error TEXT,"
        " updated_at INTEGER,"
        " PRIMARY KEY(operation_id, range_offset),"
        " FOREIGN KEY(operation_id) REFERENCES qmail_object_transfers(operation_id)"
        " ON DELETE CASCADE"
        ");";

    if (!db_path) return RESULT_INVALID_PARAM;
    if (s_transfer_db) return RESULT_SUCCESS;
    if (!s_transfer_db_mutex_ready) {
        if (mutex_init(&s_transfer_db_mutex) != RESULT_SUCCESS) {
            return RESULT_ERROR;
        }
        s_transfer_db_mutex_ready = true;
    }
    if (sqlite3_open(db_path, &s_transfer_db) != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "Transfer DB open failed: %s",
                  s_transfer_db ? sqlite3_errmsg(s_transfer_db) : "unknown");
        sqlite3_close(s_transfer_db);
        s_transfer_db = NULL;
        return RESULT_FILE_ERROR;
    }
    sqlite3_busy_timeout(s_transfer_db, 5000);
    char *error = NULL;
    if (sqlite3_exec(s_transfer_db, schema, NULL, NULL, &error) != SQLITE_OK) {
        log_error(LOG_CAT_GENERAL, "Transfer DB schema failed: %s",
                  error ? error : "unknown");
        sqlite3_free(error);
        sqlite3_close(s_transfer_db);
        s_transfer_db = NULL;
        return RESULT_ERROR;
    }
    sqlite3_exec(
        s_transfer_db,
        "ALTER TABLE qmail_object_transfers"
        " ADD COLUMN begin_request_frozen INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(
        s_transfer_db,
        "ALTER TABLE qmail_object_transfers"
        " ADD COLUMN requested_storage_class INTEGER DEFAULT 0",
        NULL, NULL, NULL);
    sqlite3_exec(s_transfer_db,
                 "UPDATE qmail_object_transfer_ranges SET state=0 WHERE state=1",
                 NULL, NULL, NULL);
    return RESULT_SUCCESS;
}

void qmail_transfer_store_close(void) {
    store_lock();
    if (s_transfer_db) {
        sqlite3_close(s_transfer_db);
        s_transfer_db = NULL;
    }
    store_unlock();
    if (s_transfer_db_mutex_ready) {
        mutex_destroy(&s_transfer_db_mutex);
        s_transfer_db_mutex_ready = false;
    }
}

result_t qmail_transfer_store_insert(const qmail_transfer_record_t *record) {
    if (!s_transfer_db || !record) return RESULT_INVALID_PARAM;
    char sql[2048];
    snprintf(sql, sizeof(sql),
             "INSERT INTO qmail_object_transfers (%s) VALUES ("
             "?,?,?,?,?,?,?,?,?,?"
             ",?,?,?,?,?,?,?,?,?,?"
             ",?,?,?,?,?,?,?,?,?,?"
             ",?,?,?,?,?,?,?,?,?,?)",
             TRANSFER_COLUMNS);
    store_lock();
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_transfer_db, sql, -1, &stmt, NULL);
    if (rc == SQLITE_OK) {
        bind_transfer(stmt, record);
        rc = sqlite3_step(stmt);
    }
    sqlite3_finalize(stmt);
    store_unlock();
    return rc == SQLITE_DONE ? RESULT_SUCCESS : RESULT_ERROR;
}

result_t qmail_transfer_store_get(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    qmail_transfer_record_t *record_out) {
    if (!s_transfer_db || !operation_id || !record_out) {
        return RESULT_INVALID_PARAM;
    }
    char sql[1536];
    snprintf(sql, sizeof(sql),
             "SELECT %s FROM qmail_object_transfers WHERE operation_id=?",
             TRANSFER_COLUMNS);
    store_lock();
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_transfer_db, sql, -1, &stmt, NULL);
    if (rc == SQLITE_OK) {
        sqlite3_bind_blob(stmt, 1, operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        rc = sqlite3_step(stmt);
        if (rc == SQLITE_ROW) read_transfer(stmt, record_out);
    }
    sqlite3_finalize(stmt);
    store_unlock();
    if (rc == SQLITE_ROW) return RESULT_SUCCESS;
    return rc == SQLITE_DONE ? RESULT_NOT_FOUND : RESULT_ERROR;
}

result_t qmail_transfer_store_save(const qmail_transfer_record_t *record) {
    if (!s_transfer_db || !record) return RESULT_INVALID_PARAM;
    char sql[4096];
    snprintf(sql, sizeof(sql),
        "UPDATE qmail_object_transfers SET "
        "direction=?,state=?,raida_id=?,transfer_id=?,object_id=?,locker_code=?,"
        "locker_key=?,file_type=?,operation=?,requested_storage_class=?,storage_class=?,requested_retention=?,"
        "accepted_retention=?,expected_generation=?,target_generation=?,generation=?,"
        "total_size=?,completed_bytes=?,preferred_chunk=?,accepted_chunk=?,requested_range=?,"
        "recommended_range=?,max_parallel=?,expires_at=?,object_hash=?,source_path=?,"
        "destination_path=?,temporary_path=?,wallet_path=?,task_id=?,cancel_requested=?,"
        "locker_consumed=?,begin_request_frozen=?,retry_count=?,last_result=?,last_status=?,error_message=?,"
        "created_at=?,updated_at=? WHERE operation_id=?");
    store_lock();
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_transfer_db, sql, -1, &stmt, NULL);
    if (rc == SQLITE_OK) {
        qmail_transfer_record_t reordered = *record;
        int i = 1;
        sqlite3_bind_int(stmt, i++, reordered.direction);
        sqlite3_bind_int(stmt, i++, reordered.state);
        sqlite3_bind_int(stmt, i++, reordered.raida_id);
        sqlite3_bind_blob(stmt, i++, reordered.transfer_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        sqlite3_bind_blob(stmt, i++, reordered.object_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        sqlite3_bind_blob(stmt, i++, reordered.locker_code, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        sqlite3_bind_text(stmt, i++, reordered.locker_key, -1, SQLITE_STATIC);
        sqlite3_bind_int(stmt, i++, reordered.file_type);
        sqlite3_bind_int(stmt, i++, reordered.operation);
        sqlite3_bind_int(stmt, i++, reordered.requested_storage_class);
        sqlite3_bind_int(stmt, i++, reordered.storage_class);
        bind_u64(stmt, i++, reordered.requested_retention_seconds);
        bind_u64(stmt, i++, reordered.accepted_retention_seconds);
        bind_u64(stmt, i++, reordered.expected_generation);
        bind_u64(stmt, i++, reordered.target_generation);
        bind_u64(stmt, i++, reordered.generation);
        bind_u64(stmt, i++, reordered.total_size);
        bind_u64(stmt, i++, reordered.completed_bytes);
        sqlite3_bind_int64(stmt, i++, reordered.preferred_chunk);
        sqlite3_bind_int64(stmt, i++, reordered.accepted_chunk);
        sqlite3_bind_int64(stmt, i++, reordered.requested_range);
        sqlite3_bind_int64(stmt, i++, reordered.recommended_range);
        sqlite3_bind_int(stmt, i++, reordered.max_parallel);
        bind_u64(stmt, i++, reordered.expires_at);
        sqlite3_bind_blob(stmt, i++, reordered.object_hash, QMAIL_OT_HASH_SIZE, SQLITE_STATIC);
        sqlite3_bind_text(stmt, i++, reordered.source_path, -1, SQLITE_STATIC);
        sqlite3_bind_text(stmt, i++, reordered.destination_path, -1, SQLITE_STATIC);
        sqlite3_bind_text(stmt, i++, reordered.temporary_path, -1, SQLITE_STATIC);
        sqlite3_bind_text(stmt, i++, reordered.wallet_path, -1, SQLITE_STATIC);
        sqlite3_bind_text(stmt, i++, reordered.task_id, -1, SQLITE_STATIC);
        sqlite3_bind_int(stmt, i++, reordered.cancel_requested ? 1 : 0);
        sqlite3_bind_int(stmt, i++, reordered.locker_consumed ? 1 : 0);
        sqlite3_bind_int(stmt, i++, reordered.begin_request_frozen ? 1 : 0);
        sqlite3_bind_int(stmt, i++, reordered.retry_count);
        sqlite3_bind_int(stmt, i++, reordered.last_result);
        sqlite3_bind_int(stmt, i++, reordered.last_status);
        sqlite3_bind_text(stmt, i++, reordered.error_message, -1, SQLITE_STATIC);
        sqlite3_bind_int64(stmt, i++, reordered.created_at);
        sqlite3_bind_int64(stmt, i++, reordered.updated_at);
        sqlite3_bind_blob(stmt, i++, reordered.operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        rc = sqlite3_step(stmt);
    }
    sqlite3_finalize(stmt);
    store_unlock();
    return rc == SQLITE_DONE ? RESULT_SUCCESS : RESULT_ERROR;
}

result_t qmail_transfer_store_set_state(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    qmail_transfer_state_t state,
    int last_result,
    uint8_t last_status,
    const char *error_message) {
    qmail_transfer_record_t record;
    result_t result = qmail_transfer_store_get(operation_id, &record);
    if (result != RESULT_SUCCESS) return result;
    record.state = state;
    record.last_result = last_result;
    record.last_status = last_status;
    record.updated_at = (int64_t)time(NULL);
    snprintf(record.error_message, sizeof(record.error_message), "%s",
             error_message ? error_message : "");
    return qmail_transfer_store_save(&record);
}

result_t qmail_transfer_store_request_cancel(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE]) {
    if (!s_transfer_db || !operation_id) return RESULT_INVALID_PARAM;
    store_lock();
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(
        s_transfer_db,
        "UPDATE qmail_object_transfers SET cancel_requested=1,"
        " state=?,updated_at=? WHERE operation_id=? AND state NOT IN (8,11,12)",
        -1, &stmt, NULL);
    if (rc == SQLITE_OK) {
        sqlite3_bind_int(stmt, 1, QMAIL_TRANSFER_STATE_CANCELLING);
        sqlite3_bind_int64(stmt, 2, (int64_t)time(NULL));
        sqlite3_bind_blob(stmt, 3, operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        rc = sqlite3_step(stmt);
    }
    int changed = sqlite3_changes(s_transfer_db);
    sqlite3_finalize(stmt);
    store_unlock();
    if (rc != SQLITE_DONE) return RESULT_ERROR;
    return changed > 0 ? RESULT_SUCCESS : RESULT_NOT_FOUND;
}

result_t qmail_transfer_store_list_resumable(
    qmail_transfer_record_t **records_out,
    int *count_out) {
    if (!s_transfer_db || !records_out || !count_out) return RESULT_INVALID_PARAM;
    *records_out = NULL;
    *count_out = 0;
    char sql[1600];
    snprintf(sql, sizeof(sql),
             "SELECT %s FROM qmail_object_transfers"
             " WHERE state NOT IN (8,11,12) ORDER BY created_at",
             TRANSFER_COLUMNS);
    store_lock();
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(s_transfer_db, sql, -1, &stmt, NULL);
    int capacity = 0;
    qmail_transfer_record_t *records = NULL;
    if (rc == SQLITE_OK) while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
        if (*count_out == capacity) {
            int next = capacity == 0 ? 8 : capacity * 2;
            qmail_transfer_record_t *grown = (qmail_transfer_record_t *)realloc(
                records, (size_t)next * sizeof(*records));
            if (!grown) {
                free(records);
                sqlite3_finalize(stmt);
                store_unlock();
                return RESULT_MEMORY_ERROR;
            }
            records = grown;
            capacity = next;
        }
        read_transfer(stmt, &records[*count_out]);
        (*count_out)++;
    }
    sqlite3_finalize(stmt);
    store_unlock();
    if (rc != SQLITE_DONE) {
        free(records);
        *count_out = 0;
        return RESULT_ERROR;
    }
    *records_out = records;
    return RESULT_SUCCESS;
}

result_t qmail_transfer_store_replace_ranges(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    const qmail_transfer_range_t *ranges,
    size_t range_count,
    uint64_t completed_bytes) {
    if (!s_transfer_db || !operation_id || (range_count > 0 && !ranges)) {
        return RESULT_INVALID_PARAM;
    }
    store_lock();
    char *error = NULL;
    int rc = sqlite3_exec(s_transfer_db, "BEGIN IMMEDIATE", NULL, NULL, &error);
    sqlite3_free(error);
    sqlite3_stmt *stmt = NULL;
    if (rc == SQLITE_OK) {
        rc = sqlite3_prepare_v2(
            s_transfer_db,
            "DELETE FROM qmail_object_transfer_ranges WHERE operation_id=?",
            -1, &stmt, NULL);
    }
    if (rc == SQLITE_OK) {
        sqlite3_bind_blob(stmt, 1, operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        rc = sqlite3_step(stmt) == SQLITE_DONE ? SQLITE_OK : SQLITE_ERROR;
    }
    sqlite3_finalize(stmt);
    stmt = NULL;
    if (rc == SQLITE_OK && range_count > 0) {
        rc = sqlite3_prepare_v2(
            s_transfer_db,
            "INSERT INTO qmail_object_transfer_ranges"
            "(operation_id,range_offset,range_length,state,retries,last_error,updated_at)"
            " VALUES(?,?,?,?,0,'',?)",
            -1, &stmt, NULL);
        for (size_t i = 0; rc == SQLITE_OK && i < range_count; ++i) {
            sqlite3_bind_blob(stmt, 1, operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
            bind_u64(stmt, 2, ranges[i].offset);
            bind_u64(stmt, 3, ranges[i].length);
            sqlite3_bind_int(stmt, 4, ranges[i].state);
            sqlite3_bind_int64(stmt, 5, (int64_t)time(NULL));
            if (sqlite3_step(stmt) != SQLITE_DONE) rc = SQLITE_ERROR;
            sqlite3_reset(stmt);
            sqlite3_clear_bindings(stmt);
        }
    }
    sqlite3_finalize(stmt);
    stmt = NULL;
    if (rc == SQLITE_OK) {
        rc = sqlite3_prepare_v2(
            s_transfer_db,
            "UPDATE qmail_object_transfers SET completed_bytes=?,updated_at=?"
            " WHERE operation_id=?",
            -1, &stmt, NULL);
    }
    if (rc == SQLITE_OK) {
        bind_u64(stmt, 1, completed_bytes);
        sqlite3_bind_int64(stmt, 2, (int64_t)time(NULL));
        sqlite3_bind_blob(stmt, 3, operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        rc = sqlite3_step(stmt) == SQLITE_DONE ? SQLITE_OK : SQLITE_ERROR;
    }
    sqlite3_finalize(stmt);
    sqlite3_exec(s_transfer_db, rc == SQLITE_OK ? "COMMIT" : "ROLLBACK",
                 NULL, NULL, NULL);
    store_unlock();
    return rc == SQLITE_OK ? RESULT_SUCCESS : RESULT_ERROR;
}

result_t qmail_transfer_store_list_pending_ranges(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    qmail_transfer_range_t **ranges_out,
    size_t *count_out) {
    if (!s_transfer_db || !operation_id || !ranges_out || !count_out) {
        return RESULT_INVALID_PARAM;
    }
    *ranges_out = NULL;
    *count_out = 0;
    store_lock();
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(
        s_transfer_db,
        "SELECT range_offset,range_length,state,retries"
        " FROM qmail_object_transfer_ranges"
        " WHERE operation_id=? AND state!=2 ORDER BY rowid",
        -1, &stmt, NULL);
    if (rc == SQLITE_OK) {
        sqlite3_bind_blob(stmt, 1, operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
    }
    size_t capacity = 0;
    qmail_transfer_range_t *ranges = NULL;
    if (rc == SQLITE_OK) while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
        if (*count_out == capacity) {
            size_t next = capacity == 0 ? 64 : capacity * 2;
            qmail_transfer_range_t *grown = (qmail_transfer_range_t *)realloc(
                ranges, next * sizeof(*ranges));
            if (!grown) {
                free(ranges);
                sqlite3_finalize(stmt);
                store_unlock();
                return RESULT_MEMORY_ERROR;
            }
            ranges = grown;
            capacity = next;
        }
        qmail_transfer_range_t *range = &ranges[(*count_out)++];
        range->offset = text_to_u64(sqlite3_column_text(stmt, 0));
        range->length = text_to_u64(sqlite3_column_text(stmt, 1));
        range->state = sqlite3_column_int(stmt, 2);
        range->retries = sqlite3_column_int(stmt, 3);
    }
    sqlite3_finalize(stmt);
    store_unlock();
    if (rc != SQLITE_DONE) {
        free(ranges);
        *count_out = 0;
        return RESULT_ERROR;
    }
    *ranges_out = ranges;
    return RESULT_SUCCESS;
}

static result_t update_range_state(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    uint64_t offset,
    int state,
    int retries,
    const char *error_message) {
    if (!s_transfer_db || !operation_id) return RESULT_INVALID_PARAM;
    store_lock();
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(
        s_transfer_db,
        "UPDATE qmail_object_transfer_ranges SET state=?,retries=?,"
        "last_error=?,updated_at=? WHERE operation_id=? AND range_offset=?",
        -1, &stmt, NULL);
    if (rc == SQLITE_OK) {
        sqlite3_bind_int(stmt, 1, state);
        sqlite3_bind_int(stmt, 2, retries);
        sqlite3_bind_text(stmt, 3, error_message ? error_message : "",
                          -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(stmt, 4, (int64_t)time(NULL));
        sqlite3_bind_blob(stmt, 5, operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        bind_u64(stmt, 6, offset);
        rc = sqlite3_step(stmt);
    }
    sqlite3_finalize(stmt);
    store_unlock();
    return rc == SQLITE_DONE ? RESULT_SUCCESS : RESULT_ERROR;
}

result_t qmail_transfer_store_mark_range_inflight(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    uint64_t offset) {
    return update_range_state(operation_id, offset, 1, 0, "");
}

result_t qmail_transfer_store_mark_range_failed(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    uint64_t offset,
    int retries,
    const char *error_message) {
    return update_range_state(operation_id, offset, 0, retries, error_message);
}

result_t qmail_transfer_store_mark_range_complete(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE],
    uint64_t offset,
    uint64_t length) {
    if (!s_transfer_db || !operation_id) return RESULT_INVALID_PARAM;
    store_lock();
    int rc = sqlite3_exec(
        s_transfer_db, "BEGIN IMMEDIATE", NULL, NULL, NULL);
    sqlite3_stmt *stmt = NULL;
    if (rc == SQLITE_OK) {
        rc = sqlite3_prepare_v2(
            s_transfer_db,
            "SELECT state FROM qmail_object_transfer_ranges"
            " WHERE operation_id=? AND range_offset=?",
            -1, &stmt, NULL);
    }
    if (rc == SQLITE_OK) {
        sqlite3_bind_blob(
            stmt, 1, operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        bind_u64(stmt, 2, offset);
        rc = sqlite3_step(stmt);
    }
    if (rc == SQLITE_ROW && sqlite3_column_int(stmt, 0) == 2) {
        sqlite3_finalize(stmt);
        sqlite3_exec(s_transfer_db, "COMMIT", NULL, NULL, NULL);
        store_unlock();
        return RESULT_SUCCESS;
    }
    rc = rc == SQLITE_ROW ? SQLITE_OK : SQLITE_ERROR;
    sqlite3_finalize(stmt);
    stmt = NULL;

    if (rc == SQLITE_OK) {
        rc = sqlite3_prepare_v2(
            s_transfer_db,
            "UPDATE qmail_object_transfer_ranges"
            " SET state=2,last_error='',updated_at=?"
            " WHERE operation_id=? AND range_offset=? AND state!=2",
            -1, &stmt, NULL);
    }
    if (rc == SQLITE_OK) {
        sqlite3_bind_int64(stmt, 1, (int64_t)time(NULL));
        sqlite3_bind_blob(
            stmt, 2, operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        bind_u64(stmt, 3, offset);
        rc = sqlite3_step(stmt) == SQLITE_DONE &&
             sqlite3_changes(s_transfer_db) == 1
            ? SQLITE_OK : SQLITE_ERROR;
    }
    sqlite3_finalize(stmt);
    stmt = NULL;

    uint64_t completed_bytes = 0;
    uint64_t total_size = 0;
    if (rc == SQLITE_OK) {
        rc = sqlite3_prepare_v2(
            s_transfer_db,
            "SELECT completed_bytes,total_size FROM qmail_object_transfers"
            " WHERE operation_id=?",
            -1, &stmt, NULL);
    }
    if (rc == SQLITE_OK) {
        sqlite3_bind_blob(
            stmt, 1, operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        rc = sqlite3_step(stmt);
    }
    if (rc == SQLITE_ROW) {
        completed_bytes = text_to_u64(sqlite3_column_text(stmt, 0));
        total_size = text_to_u64(sqlite3_column_text(stmt, 1));
        if (completed_bytes > total_size) completed_bytes = total_size;
        completed_bytes = length > total_size - completed_bytes
            ? total_size : completed_bytes + length;
        rc = SQLITE_OK;
    } else {
        rc = SQLITE_ERROR;
    }
    sqlite3_finalize(stmt);
    stmt = NULL;

    if (rc == SQLITE_OK) {
        rc = sqlite3_prepare_v2(
            s_transfer_db,
            "UPDATE qmail_object_transfers SET completed_bytes=?,updated_at=?"
            " WHERE operation_id=?",
            -1, &stmt, NULL);
    }
    if (rc == SQLITE_OK) {
        bind_u64(stmt, 1, completed_bytes);
        sqlite3_bind_int64(stmt, 2, (int64_t)time(NULL));
        sqlite3_bind_blob(
            stmt, 3, operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        rc = sqlite3_step(stmt) == SQLITE_DONE
            ? SQLITE_OK : SQLITE_ERROR;
    }
    sqlite3_finalize(stmt);
    sqlite3_exec(s_transfer_db, rc == SQLITE_OK ? "COMMIT" : "ROLLBACK",
                 NULL, NULL, NULL);
    store_unlock();
    return rc == SQLITE_OK ? RESULT_SUCCESS : RESULT_ERROR;
}

result_t qmail_transfer_store_reset_inflight(
    const uint8_t operation_id[QMAIL_OT_ID_SIZE]) {
    if (!s_transfer_db || !operation_id) return RESULT_INVALID_PARAM;
    store_lock();
    sqlite3_stmt *stmt = NULL;
    int rc = sqlite3_prepare_v2(
        s_transfer_db,
        "UPDATE qmail_object_transfer_ranges SET state=0"
        " WHERE operation_id=? AND state=1",
        -1, &stmt, NULL);
    if (rc == SQLITE_OK) {
        sqlite3_bind_blob(stmt, 1, operation_id, QMAIL_OT_ID_SIZE, SQLITE_STATIC);
        rc = sqlite3_step(stmt);
    }
    sqlite3_finalize(stmt);
    store_unlock();
    return rc == SQLITE_DONE ? RESULT_SUCCESS : RESULT_ERROR;
}
