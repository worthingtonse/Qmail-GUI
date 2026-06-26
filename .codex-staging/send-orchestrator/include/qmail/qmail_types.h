/**
 * qmail_types.h - QMail Type Definitions and Constants
 *
 * All QMail-specific structs, enums, and constants for the email client
 * integrated into rest_core. QMail uses RAIDA protocol group 6 command
 * codes 70-74 in the current wire format, with RAID-5 striping across
 * healthy QMail servers.
 */

#ifndef QMAIL_TYPES_H
#define QMAIL_TYPES_H

#include "platform.h"
#include "constants.h"
#include <stdint.h>
#include <stdbool.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <pthread.h>
#endif

// ============================================================================
// QMAIL CONSTANTS
// ============================================================================

/** Maximum number of QMail servers (upper bound for fixed-size arrays) */
#define QMAIL_MAX_SERVERS       25

/** Array sizing alias (use QMAIL_MAX_SERVERS for stack arrays, runtime count for loops) */
#define QMAIL_SERVER_COUNT      QMAIL_MAX_SERVERS

/** Maximum data stripes (array sizing; actual count = runtime server_count - 1) */
#define QMAIL_DATA_STRIPES      (QMAIL_MAX_SERVERS - 1)

/** Beacon server RAIDA index (for TELL/PING/PEEK) */
#define QMAIL_BEACON_RAIDA_ID   11

/** Secondary beacon server RAIDA index (fallback for TELL/PING/PEEK) */
#define QMAIL_SECONDARY_BEACON_RAIDA_ID 14

/** Number of beacon RAIDAs monitored by default */
#define QMAIL_BEACON_RAIDA_COUNT 2

/** Maximum file_type 1 body/CBDF object size. */
#define QMAIL_MAX_EMAIL_SIZE    (512 * 1024)

/** Maximum attachment size accepted by local attachment download APIs (512 MB) */
#define QMAIL_MAX_ATTACHMENT_SIZE (512ULL * 1024ULL * 1024ULL)

/** Maximum subject length */
#define QMAIL_MAX_SUBJECT_LEN   256

/** Maximum address length (Name@adjective.noun.denomination) */
#define QMAIL_MAX_ADDRESS_LEN   256

/** Maximum recipients per email */
#define QMAIL_MAX_RECIPIENTS    50

/** Maximum joined recipient list length including separators and null terminator */
#define QMAIL_MAX_RECIPIENT_LIST_LEN ((QMAIL_MAX_ADDRESS_LEN * QMAIL_MAX_RECIPIENTS) + QMAIL_MAX_RECIPIENTS)

/** File GUID size */
#define QMAIL_GUID_SIZE         16

/** Locker code size for QMail (standardized to 16 bytes in the current wire format) */
#define QMAIL_LOCKER_CODE_SIZE  16

/** Session ID size */
#define QMAIL_SESSION_SIZE      8

/** Beacon long-poll timeout (seconds) */
#define QMAIL_PING_TIMEOUT_SEC  600

/** Beacon exponential backoff max (seconds) */
#define QMAIL_BACKOFF_MAX_SEC   60

/** Tell notification header size */
#define QMAIL_TELL_HEADER_SIZE  40

/** Server location entry size */
#define QMAIL_SERVER_ENTRY_SIZE 32

/** Attachment path buffer size.
 * Must not use MAX_PATH_LEN here because api_rest.h redefines it in REST
 * translation units, while core-side translation units see platform.h's value.
 */
#define QMAIL_ATTACHMENT_PATH_LEN 512

/** QMail V2 pass-through file header size */
#define QMAIL_FILE_HEADER_SIZE  64

/** Tell manifest constants (header bytes 51-63 in qmail_file_header_t) */
#define QMAIL_TELL_MANIFEST_VERSION_LEGACY 0
#define QMAIL_TELL_MANIFEST_VERSION_1      1
#define QMAIL_TELL_MANIFEST_VERSION_2      2
#define QMAIL_TELL_MANIFEST_V1_ENTRY_SIZE  16
#define QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE  72
#define QMAIL_TELL_MANIFEST_ENTRY_SIZE     QMAIL_TELL_MANIFEST_V1_ENTRY_SIZE
#define QMAIL_TELL_MANIFEST_MAX_FILES      246
#define QMAIL_TELL_MANIFEST_V1_MAX_LEN \
    (QMAIL_TELL_MANIFEST_MAX_FILES * QMAIL_TELL_MANIFEST_V1_ENTRY_SIZE)
#define QMAIL_TELL_MANIFEST_MAX_LEN \
    (QMAIL_TELL_MANIFEST_MAX_FILES * QMAIL_TELL_MANIFEST_V2_ENTRY_SIZE)

/** qmail_file_header_t absolute offsets for manifest metadata */
#define QMAIL_FILE_HEADER_MANIFEST_VERSION_OFFSET 51
#define QMAIL_FILE_HEADER_FILE_COUNT_OFFSET       52
#define QMAIL_FILE_HEADER_FILE_ENTRY_SIZE_OFFSET  53
#define QMAIL_FILE_HEADER_MANIFEST_LEN_OFFSET     54
#define QMAIL_FILE_HEADER_MANIFEST_FLAGS_OFFSET   56
#define QMAIL_FILE_HEADER_MANIFEST_RESERVED_OFFSET 57
#define QMAIL_FILE_HEADER_MANIFEST_RESERVED_LEN    7

/** manifest_flags bits */
#define QMAIL_TELL_MANIFEST_FLAG_FOOTER_REMOVED 0x01
#define QMAIL_TELL_MANIFEST_FLAG_CRC32_PRESENT  0x02

/** qmail_file_manifest_entry_t file_flags bits */
#define QMAIL_FILE_MANIFEST_FLAG_BODY       0x01
#define QMAIL_FILE_MANIFEST_FLAG_ATTACHMENT 0x02
#define QMAIL_FILE_MANIFEST_FLAG_META       0x04

/**
 * Legacy manifest-v1/cmd-75 page geometry.
 *
 * Manifest v1 does not record page size, so this value is part of the stored
 * wire contract and cannot change without making older attachments
 * ambiguous. Object Transfer v1 uses negotiated byte ranges independently.
 */
#define QMAIL_LEGACY_PAGE_SIZE     (256 * 1024)
#define QMAIL_PAGE_SIZE            QMAIL_LEGACY_PAGE_SIZE
#define QMAIL_DOWNLOAD_PAGE_SIZE   QMAIL_LEGACY_PAGE_SIZE
#define QMAIL_UPLOAD_PAGE_SIZE     QMAIL_LEGACY_PAGE_SIZE

/** Large-upload billing unit: charge rounds up to one megabyte */
#define QMAIL_UPLOAD_BILLING_UNIT_SIZE (1024 * 1024)

/** Maximum stripe size (10 MB) */
#define QMAIL_MAX_STRIPE_SIZE      (10 * 1024 * 1024)

/** Maximum pages per download request (16-bit page number, pages 0..65535) */
#define QMAIL_MAX_PAGES         65536u

/** Maximum size of the CBDF body (file_type 1). The body is NEVER paged in
 *  Phase 1: it is size-limited and always uploaded/downloaded as a legacy
 *  cmd-70 single object. Only attachments (file_type 0x0A+) use cmd-75 paging. */
#define QMAIL_CBDF_BODY_MAX_BYTES  QMAIL_MAX_EMAIL_SIZE

// ============================================================================
// QMAIL COMMAND CODES (Group 6)
// ============================================================================
// Already defined in constants.h:
//   CMD_GROUP_QMAIL      = 6
//   CMD_QMAIL_UPLOAD     = 70
//   CMD_QMAIL_TELL       = 71
//   CMD_QMAIL_PING       = 72
//   CMD_QMAIL_PEEK       = 73
//   CMD_QMAIL_DOWNLOAD   = 74
//   CMD_QMAIL_UPLOAD_LARGE_PAGE = 75

// ============================================================================
// FILE TYPE CODES
// ============================================================================

typedef enum {
    QMAIL_FILE_META         = 0,    /* Email metadata */
    QMAIL_FILE_BODY         = 1,    /* Email body/styling */
    QMAIL_FILE_RESERVED     = 2,    /* Reserved for future use */
    QMAIL_FILE_ATTACHMENT_1 = 10,   /* First attachment */
    QMAIL_FILE_ATTACHMENT_2 = 11,
    QMAIL_FILE_ATTACHMENT_3 = 12,
    QMAIL_FILE_ATTACHMENT_4 = 13,
    QMAIL_FILE_ATTACHMENT_5 = 14
} qmail_file_type_t;

// ============================================================================
// STORAGE DURATION CODES
// ============================================================================

typedef enum {
    QMAIL_DURATION_ONE_DAY      = 0,
    QMAIL_DURATION_ONE_WEEK     = 1,
    QMAIL_DURATION_ONE_MONTH    = 2,
    QMAIL_DURATION_THREE_MONTHS = 3,
    QMAIL_DURATION_SIX_MONTHS   = 4,
    QMAIL_DURATION_ONE_YEAR     = 5,
    QMAIL_DURATION_PERMANENT    = 255
} qmail_storage_duration_t;

// ============================================================================
// RECIPIENT TYPE
// ============================================================================

typedef enum {
    QMAIL_RECIPIENT_TO   = 0,
    QMAIL_RECIPIENT_CC   = 1,
    QMAIL_RECIPIENT_BC   = 2,  /* Blind copy */
    QMAIL_RECIPIENT_MASS = 3,
    QMAIL_RECIPIENT_FROM = 4   /* Sender */
} qmail_recipient_type_t;

// ============================================================================
// TELL TYPE
// ============================================================================

typedef enum {
    QMAIL_TELL_NEW_EMAIL    = 0,
    QMAIL_TELL_READ_RECEIPT = 1,
    QMAIL_TELL_DELETED      = 2
} qmail_tell_type_t;

// ============================================================================
// STORAGE MODE (for attachments)
// ============================================================================

typedef enum {
    QMAIL_STORAGE_INTERNAL = 0,  /* Stored in DB blob */
    QMAIL_STORAGE_EXTERNAL = 1,  /* Stored as file on disk */
    QMAIL_STORAGE_PENDING  = 2   /* Metadata only; bytes not yet downloaded
                                  * (download on demand via /attachment/download) */
} qmail_storage_mode_t;

// ============================================================================
// EMAIL FOLDER
// ============================================================================

typedef enum {
    QMAIL_FOLDER_INBOX   = 0,
    QMAIL_FOLDER_SENT    = 1,
    QMAIL_FOLDER_DRAFTS  = 2,
    QMAIL_FOLDER_TRASH   = 3,
    QMAIL_FOLDER_STARRED = 4,
    QMAIL_FOLDER_ARCHIVE = 5
} qmail_folder_t;

// ============================================================================
// SERVER LOCATION (from tell notification)
// ============================================================================

typedef struct {
    uint8_t  stripe_index;      /* Which stripe this server holds */
    uint8_t  stripe_type;       /* File type of the stripe */
    uint8_t  server_id;         /* RAIDA index of the server */
    uint8_t  raw_entry[QMAIL_SERVER_ENTRY_SIZE];
} qmail_server_location_t;

// ============================================================================
// QMAIL PASS-THROUGH STRUCTURES
// ============================================================================

/** 
 * QMail file header (64 bytes)
 * This is the exact layout stored on disk and returned by Ping/Peek.
 * The on-wire version byte remains 0x02.
 */
#pragma pack(push, 1)
typedef struct {
    uint8_t  email_id[16];              /* 00-15: Unique message GUID */
    uint8_t  sender_coin_id[2];         /* 16-17: Sender's Network ID (0x0006) */
    uint8_t  sender_denomination;       /* 18: Sender's coin denomination */
    uint8_t  sender_serial_number[4];   /* 19-22: Sender's serial number (BE) */
    uint8_t  sender_device_id;          /* 23: Sender's device ID */
    uint8_t  timestamp[4];              /* 24-27: Unix epoch timestamp (BE) */
    uint8_t  tell_type;                 /* 28: 0=Primary, 10+=Attachment */
    uint8_t  stripe_count;              /* 29: Number of stripes (M) */
    uint8_t  locker_code[16];           /* 30-45: 16-byte download auth key */
    uint8_t  total_file_size[4];        /* 46-49: Original data size (BE) */
    uint8_t  version;                   /* 50: Protocol version (0x02) */
    uint8_t  reserved[13];              /* 51-63: Future use */
} qmail_file_header_t;
#pragma pack(pop)

/**
 * QMail file manifest entry (16 bytes).
 *
 * The Tell manifest follows the server-location array in manifest v1 records.
 * Sizes are stored big-endian on the wire so this struct remains byte-oriented.
 */
#pragma pack(push, 1)
typedef struct {
    uint8_t file_type;             /* 00: qmail_file_type_t / file index */
    uint8_t file_flags;            /* 01: QMAIL_FILE_MANIFEST_FLAG_* */
    uint8_t reserved[2];           /* 02-03: must be zero */
    uint8_t original_size[8];      /* 04-11: uint64 BE, pre-striping size */
    uint8_t crc32[4];              /* 12-15: uint32 BE, optional */
} qmail_file_manifest_entry_t;
#pragma pack(pop)

/**
 * QMail notification block (variable size)
 * Header + Array of 32-byte server entries + optional file manifest.
 */
typedef struct {
    qmail_file_header_t header;
    qmail_server_location_t servers[QMAIL_MAX_SERVERS];
    uint8_t manifest_version;
    uint8_t file_count;
    uint8_t file_entry_size;
    uint16_t manifest_len;
    uint8_t manifest_flags;
    qmail_file_manifest_entry_t files[QMAIL_TELL_MANIFEST_MAX_FILES];
    uint8_t manifest_bytes[QMAIL_TELL_MANIFEST_MAX_LEN];
} qmail_notification_block_t;

// ============================================================================
// TELL NOTIFICATION (received from PING/PEEK response)
// ============================================================================

typedef struct {
    uint8_t  file_guid[QMAIL_GUID_SIZE];  /* Email/file group GUID */
    uint8_t  locker_code[16];             /* Locker code for download auth */
    uint32_t sender_sn;                   /* Sender's serial number */
    uint8_t  sender_denomination;         /* Sender's coin denomination */
    uint32_t timestamp;                   /* Unix timestamp of the tell */
    uint32_t total_file_size;             /* Total file size across all stripes */
    uint8_t  tell_type;                   /* qmail_tell_type_t */
    int      server_count;                /* Number of server location entries */
    qmail_server_location_t servers[QMAIL_SERVER_COUNT]; /* Server locations */
    uint8_t  manifest_version;            /* 0 legacy, 1 legacy pages, 2 objects */
    uint8_t  file_count;                  /* Body + attachments */
    uint8_t  file_entry_size;             /* 16 for manifest v1 */
    uint16_t manifest_len;                /* file_count * entry_size */
    uint8_t  manifest_flags;              /* QMAIL_TELL_MANIFEST_FLAG_* */
    qmail_file_manifest_entry_t files[QMAIL_TELL_MANIFEST_MAX_FILES];
    uint8_t  manifest_bytes[QMAIL_TELL_MANIFEST_MAX_LEN];
} qmail_tell_notification_t;

// ============================================================================
// RECIPIENT ENTRY (for tell command)
// ============================================================================

typedef struct {
    uint32_t serial_number;
    int8_t   denomination;
    uint8_t  recipient_type;    /* qmail_recipient_type_t */
} qmail_recipient_entry_t;

// ============================================================================
// RECIPIENT WITH BEACON (for parse_recipients → Tell dispatch)
// ============================================================================

typedef struct {
    qmail_recipient_entry_t entry;
    uint8_t beacon_raida;   /* Primary beacon server RAIDA index for this recipient */
    uint8_t secondary_beacon_raida; /* Secondary beacon RAIDA index for failover */
    char    auto_address[QMAIL_MAX_ADDRESS_LEN]; /* Original typed/resolved address — used to stub qmail_contacts on first send */
} recipient_with_beacon_t;

// ============================================================================
// CONTACT
// ============================================================================

typedef struct {
    uint32_t serial_number;
    int8_t   denomination;
    uint32_t custom_sn;         /* User-defined SN (for display) */
    char     first_name[64];
    char     last_name[64];
    char     auto_address[QMAIL_MAX_ADDRESS_LEN]; /* Auto-generated address */
    char     description[128];
    char     class_name[32];    /* e.g., "Giga", "Mega" */
    uint8_t  beacon_raida;      /* Beacon server RAIDA index (e.g., 11, 14) */
    uint8_t  secondary_beacon_raida; /* Secondary beacon RAIDA index (failover) */
    uint32_t inbox_fee;              /* Fee to send to this contact (from directory) */
    bool     is_favorite;
    int8_t   trust_level;       /* -1=spam/blocked, 0=unknown, 1=trusted */
    char     user_notes[512];   /* User's private notes — never overwritten by sync */
    uint32_t send_count;        /* Total emails sent to this contact (popular-recipient ranking) */
    int64_t  last_sent_at;      /* Unix ts of most recent send (0 if never) */
    int64_t  created_at;        /* Unix timestamp */
    int64_t  updated_at;
} qmail_contact_t;

// ============================================================================
// EMAIL
// ============================================================================

typedef struct {
    uint8_t  email_id[QMAIL_GUID_SIZE];
    char     subject[QMAIL_MAX_SUBJECT_LEN];
    char    *body;              /* Dynamically allocated (can be large) */
    size_t   body_len;
    int64_t  received_timestamp;
    int64_t  sent_timestamp;
    bool     is_read;
    bool     is_starred;
    bool     is_trashed;
    int      folder;            /* qmail_folder_t */
    int      recipient_count;
    qmail_recipient_entry_t recipients[QMAIL_MAX_RECIPIENTS];
    uint32_t sender_sn;
    uint8_t  sender_denomination;
    uint32_t inbox_fee;          /* Fee paid by sender (in CloudCoin units) */
} qmail_email_t;

// ============================================================================
// ATTACHMENT
// ============================================================================

typedef struct {
    int64_t  attachment_id;     /* DB auto-increment ID */
    uint8_t  email_id[QMAIL_GUID_SIZE];
    uint8_t  file_type;         /* 0x0A+ attachment file/index from Tell manifest */
    char     name[256];
    char     extension[32];
    int      storage_mode;      /* qmail_storage_mode_t */
    uint8_t *data_blob;         /* For internal storage */
    size_t   data_size;
    char     file_path[QMAIL_ATTACHMENT_PATH_LEN]; /* For external storage */
    size_t   size_bytes;
} qmail_attachment_t;

// ============================================================================
// STRIPE DATA
// ============================================================================

typedef struct {
    uint8_t *data;
    size_t   size;
    int      index;             /* Stripe index (0-3 data, 4 parity) */
    uint32_t checksum;          /* CRC32 checksum */
} qmail_stripe_t;

// ============================================================================
// UPLOAD CONTEXT (per-stripe upload to one server)
// ============================================================================

typedef struct {
    uint8_t  file_guid[QMAIL_GUID_SIZE];
    uint8_t  locker_code[QMAIL_LOCKER_CODE_SIZE];
    uint8_t  file_type;
    uint8_t  duration;
    uint8_t *stripe_data;
    size_t   stripe_size;
    int8_t   denomination;
    uint32_t serial_number;
    uint8_t  an[AN_LENGTH];
    uint8_t  device_id;
    const void *enc_key;    /* raida_encryption_key_t* for protocol encryption (NULL = none) */
} qmail_upload_context_t;

/* Large-upload page context (CMD 75).
 *
 * Command data after the protocol challenge:
 *   qmail_identity(32) + file_guid(16) + locker_code(16) +
 *   file_type(1) + duration(1) + page_number_echo(2) +
 *   page_data_len(4) + page_data(N)
 */
typedef struct {
    uint8_t  file_guid[QMAIL_GUID_SIZE];
    uint8_t  locker_code[QMAIL_LOCKER_CODE_SIZE];
    uint8_t  file_type;
    uint8_t  duration;
    uint16_t page_number;
    uint8_t *page_data;
    size_t   page_size;
    int8_t   denomination;
    uint32_t serial_number;
    uint8_t  an[AN_LENGTH];
    uint8_t  device_id;
    const void *enc_key;    /* raida_encryption_key_t* for protocol encryption (NULL = none) */
} qmail_upload_large_page_context_t;

// ============================================================================
// TELL CONTEXT
// ============================================================================

typedef struct {
    uint8_t  file_guid[QMAIL_GUID_SIZE];
    uint8_t  locker_code[QMAIL_LOCKER_CODE_SIZE];
    uint8_t  beacon_payment_locker[QMAIL_LOCKER_CODE_SIZE]; /* 16-byte beacon fee locker */
    uint32_t total_file_size;       /* Total email data size across all stripes */
    uint32_t timestamp;
    uint8_t  tell_type;
    /* Mailbox identity (preamble authentication) */
    int8_t   denomination;
    uint32_t serial_number;
    uint8_t  an[AN_LENGTH];
    uint8_t  device_id;
    int      recipient_count;
    qmail_recipient_entry_t recipients[QMAIL_MAX_RECIPIENTS];
    int      server_count;
    qmail_server_location_t servers[QMAIL_SERVER_COUNT];
    /* Pass-through notification block for the current wire format */
    qmail_notification_block_t notification_block;
    const void *enc_key;    /* raida_encryption_key_t* for protocol encryption (NULL = none) */
} qmail_tell_context_t;

// ============================================================================
// PING/PEEK CONTEXT
// ============================================================================

typedef struct {
    int8_t   denomination;
    uint32_t serial_number;
    uint8_t  an[AN_LENGTH];
    uint8_t  device_id;
    uint32_t since_timestamp;
    const void *enc_key;    /* raida_encryption_key_t* for protocol encryption (NULL = none) */
} qmail_ping_context_t;

// ============================================================================
// DOWNLOAD CONTEXT
// ============================================================================

typedef struct {
    uint8_t  file_guid[QMAIL_GUID_SIZE];
    uint8_t  locker_code[16];
    uint8_t  file_type;
    uint8_t  version;
    uint8_t  bytes_per_page;    /* Page size code */
    uint32_t page_number;       /* 3 bytes in protocol, stored as uint32 */
    int8_t   denomination;
    uint32_t serial_number;
    uint8_t  an[AN_LENGTH];
    uint8_t  device_id;
    const void *enc_key;    /* raida_encryption_key_t* for protocol encryption (NULL = none) */
} qmail_download_context_t;

// ============================================================================
// PING/PEEK RESPONSE
// ============================================================================

typedef struct {
    uint8_t  tell_count;
    uint16_t total_remaining;
    qmail_tell_notification_t *notifications;   /* Dynamically allocated */
    int      notification_count;
    /* Diagnostics surfaced to /api/qmail/net/beacon/{ping,peek} so the GUI
     * and test harnesses can distinguish:
     *   - "no response at all" (legacy server closed the socket): timed_out
     *     stays false, raida_status stays 0.
     *   - "server returned RAIDA_STATUS_TIMEOUT explicitly": timed_out=true,
     *     raida_status=245.
     *   - "server returned data": timed_out=false, raida_status=the actual
     *     response status (0/241/250). */
    bool     timed_out;
    uint8_t  raida_status;
} qmail_ping_response_t;

// ============================================================================
// DOWNLOAD RESPONSE
// ============================================================================

typedef struct {
    uint8_t *data;
    size_t   data_size;
    bool     has_more_pages;
} qmail_download_response_t;

// ============================================================================
// SEND EMAIL OPTIONS
// ============================================================================

typedef struct {
    const char *wallet_path;
    const char *to_addresses;   /* Normalized recipient list (semicolon/comma-separated) */
    const char *cc_addresses;   /* Normalized CC list (optional) */
    const char *bcc_addresses;  /* Normalized BCC list (optional) */
    const char *subject;
    const char *body;
    int         storage_weeks;  /* Converted to duration code */
} qmail_send_options_t;

// ============================================================================
// SEND EMAIL RESULT
// ============================================================================

typedef struct {
    bool     success;
    uint8_t  file_guid[QMAIL_GUID_SIZE];
    int      upload_successes;
    int      upload_failures;
    bool     tell_success;
    bool     used_sync_fallback;   /**< True if locker pool was empty, funded on-the-fly */
    bool     low_balance_warning;  /**< True if wallet balance too low for next send */
    char     error_message[256];
} qmail_send_result_t;

// ============================================================================
// RECEIVE EMAIL RESULT
// ============================================================================

typedef struct {
    bool     success;
    uint8_t  email_id[QMAIL_GUID_SIZE];
    char    *body;              /* Dynamically allocated */
    size_t   body_len;
    char     subject[QMAIL_MAX_SUBJECT_LEN];
    uint32_t sender_sn;
    uint8_t  sender_denomination;
    int      stripes_downloaded;
    int      stripes_recovered;
    char     error_message[256];
} qmail_receive_result_t;

// ============================================================================
// BEACON STATE
// ============================================================================

typedef struct {
    uint8_t  beacon_raida;
    uint32_t last_tell_timestamp;
    int      backoff_seconds;
    int      consecutive_errors;
    bool     healthy;
    volatile bool is_running;
} qmail_beacon_peer_state_t;

typedef struct {
    volatile bool shutdown_requested;
    volatile bool is_running;
    uint32_t last_tell_timestamp;
    int      backoff_seconds;
    int      consecutive_errors;
    void    *transport_iface;   /* core_transport_t* */
    int8_t   denomination;
    uint32_t serial_number;
    uint8_t  an[AN_LENGTH];
    uint8_t  device_id;
    uint8_t  beacon_raida;      /* User's beacon RAIDA index */
    uint8_t  secondary_beacon_raida; /* Secondary beacon RAIDA index */
    qmail_beacon_peer_state_t beacons[QMAIL_BEACON_RAIDA_COUNT];
    char     wallet_path[512]; /* Mail wallet path (for AN reload) — fixed size to avoid MAX_PATH_LEN ODR issues */
    void    *enc_key_ptr;      /* raida_encryption_key_t* for protocol encryption (refreshed with identity) */
    /* Callback for new mail */
    void   (*on_new_mail)(const qmail_tell_notification_t *notification, void *user_data);
    void    *callback_data;
    /* Mutex protecting last_tell_timestamp, backoff_seconds, consecutive_errors */
#ifdef _WIN32
    CRITICAL_SECTION mutex;
#else
    pthread_mutex_t  mutex;
#endif
    bool mutex_initialized;
} qmail_beacon_state_t;

/** Initialize the beacon state mutex. Call before qmail_beacon_start. */
static inline void qmail_beacon_state_init_mutex(qmail_beacon_state_t *state) {
    if (!state || state->mutex_initialized) return;
#ifdef _WIN32
    InitializeCriticalSection(&state->mutex);
#else
    pthread_mutex_init(&state->mutex, NULL);
#endif
    state->mutex_initialized = true;
}

/** Lock the beacon state mutex. */
static inline void qmail_beacon_state_lock(qmail_beacon_state_t *state) {
    if (!state || !state->mutex_initialized) return;
#ifdef _WIN32
    EnterCriticalSection(&state->mutex);
#else
    pthread_mutex_lock(&state->mutex);
#endif
}

/** Unlock the beacon state mutex. */
static inline void qmail_beacon_state_unlock(qmail_beacon_state_t *state) {
    if (!state || !state->mutex_initialized) return;
#ifdef _WIN32
    LeaveCriticalSection(&state->mutex);
#else
    pthread_mutex_unlock(&state->mutex);
#endif
}

/**
 * Snapshot beacon identity fields under lock.
 *
 * Includes enc_key_ptr so the snapshot caller (REST /ping and /peek)
 * inherits the same protocol-level encryption the background beacon
 * thread uses. Without this, REST endpoints fall back to NULL enc_key
 * and (post-Phase 1 strict-encryption) fail the precondition check
 * inside qmail_cmd_ping / qmail_cmd_peek.
 *
 * The pointer is copied as-is — its lifetime is tied to the
 * beacon_state's lifetime, which lives for the duration of the
 * rest_core process. Callers must not free it.
 */
static inline void qmail_beacon_state_snapshot(qmail_beacon_state_t *state,
                                                qmail_ping_context_t *ctx) {
    qmail_beacon_state_lock(state);
    ctx->denomination    = state->denomination;
    ctx->serial_number   = state->serial_number;
    memcpy(ctx->an, state->an, AN_LENGTH);
    ctx->device_id       = state->device_id;
    ctx->since_timestamp = state->last_tell_timestamp;
    ctx->enc_key         = state->enc_key_ptr;
    qmail_beacon_state_unlock(state);
}

/* Same as qmail_beacon_state_snapshot but also reads beacon_raida under
 * the same lock and writes it through `*beacon_raida_out`. Use this in
 * any handler that needs to dispatch a Peek/Ping to the beacon RAIDA —
 * reading state->beacon_raida outside the snapshot lock can pair an
 * AN/SN snapshot with a beacon_raida from a later moment if the
 * background thread is rotating to a new RAIDA. */
static inline void qmail_beacon_state_snapshot_full(qmail_beacon_state_t *state,
                                                     qmail_ping_context_t *ctx,
                                                     uint8_t *beacon_raida_out) {
    qmail_beacon_state_lock(state);
    ctx->denomination    = state->denomination;
    ctx->serial_number   = state->serial_number;
    memcpy(ctx->an, state->an, AN_LENGTH);
    ctx->device_id       = state->device_id;
    ctx->since_timestamp = state->last_tell_timestamp;
    ctx->enc_key         = state->enc_key_ptr;
    if (beacon_raida_out) *beacon_raida_out = state->beacon_raida;
    qmail_beacon_state_unlock(state);
}

// ============================================================================
// QMAIL STATUS (for /api/qmail/status)
// ============================================================================

typedef struct {
    bool     beacon_running;
    uint32_t last_tell_timestamp;
    int      total_emails;
    int      unread_emails;
    int      total_contacts;
    int      server_count;
    bool     servers_available[QMAIL_SERVER_COUNT];
} qmail_status_t;

// ============================================================================
// HELPER: Convert weeks to duration code
// ============================================================================

static inline qmail_storage_duration_t qmail_weeks_to_duration(int weeks) {
    if (weeks <= 0)  return QMAIL_DURATION_ONE_DAY;
    if (weeks == 1)  return QMAIL_DURATION_ONE_WEEK;
    if (weeks <= 4)  return QMAIL_DURATION_ONE_MONTH;
    if (weeks <= 12) return QMAIL_DURATION_THREE_MONTHS;
    if (weeks <= 26) return QMAIL_DURATION_SIX_MONTHS;
    if (weeks <= 52) return QMAIL_DURATION_ONE_YEAR;
    return QMAIL_DURATION_PERMANENT;
}

// ============================================================================
// CLEANUP HELPERS
// ============================================================================

static inline void qmail_email_free(qmail_email_t *email) {
    if (email && email->body) {
        free(email->body);
        email->body = NULL;
        email->body_len = 0;
    }
}

static inline void qmail_attachment_free(qmail_attachment_t *att) {
    if (att && att->data_blob) {
        free(att->data_blob);
        att->data_blob = NULL;
        att->data_size = 0;
    }
}

static inline void qmail_ping_response_free(qmail_ping_response_t *resp) {
    if (resp && resp->notifications) {
        free(resp->notifications);
        resp->notifications = NULL;
        resp->notification_count = 0;
    }
}

static inline void qmail_download_response_free(qmail_download_response_t *resp) {
    if (resp && resp->data) {
        free(resp->data);
        resp->data = NULL;
        resp->data_size = 0;
    }
}

static inline void qmail_receive_result_free(qmail_receive_result_t *res) {
    if (res && res->body) {
        free(res->body);
        res->body = NULL;
        res->body_len = 0;
    }
}

// ============================================================================
// PENDING TELL ROW (outgoing tell retry queue)
// ============================================================================

typedef struct {
    int64_t  id;
    uint8_t  file_guid[QMAIL_GUID_SIZE];
    uint32_t recipient_sn;
    int8_t   recipient_denomination;
    uint8_t  beacon_raida;
    char     status[16];          /* "pending", "sent", "failed" */
    int      retry_count;
    char     last_error[256];
    int64_t  created_at;
    int64_t  last_attempt;
} qmail_pending_tell_row_t;

// ============================================================================
// NOTIFICATION ROW (received tell with sender contact info)
// ============================================================================

typedef struct {
    int64_t  id;
    uint8_t  file_guid[QMAIL_GUID_SIZE];
    uint32_t sender_sn;
    uint8_t  sender_denomination;
    uint8_t  tell_type;
    uint32_t total_file_size;
    int64_t  timestamp;
    bool     downloaded;
    char     sender_first_name[64];
    char     sender_last_name[64];
} qmail_notification_row_t;

#endif /* QMAIL_TYPES_H */
