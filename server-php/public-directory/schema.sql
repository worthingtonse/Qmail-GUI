-- QMail public user directory (see docs/fab.cons_plan.txt, frozen v1 contract).
-- Identity key is (denomination, serial_number). serial_number is INT UNSIGNED
-- (4-byte capable) even though current QMail serials fit in 3 bytes, so a
-- future serial widening needs no server migration.

CREATE TABLE IF NOT EXISTS public_users (
    denomination   TINYINT UNSIGNED  NOT NULL,
    serial_number  INT UNSIGNED      NOT NULL,
    first_name     VARCHAR(64)       NOT NULL DEFAULT '',
    last_name      VARCHAR(64)       NOT NULL DEFAULT '',
    description    VARCHAR(512)      NOT NULL DEFAULT '',
    inbox_fee      BIGINT UNSIGNED   NOT NULL DEFAULT 0,
    -- qcon slots: index into the 256 NewAvatars SVGs (0..255). NULL = slot
    -- unused. Order matters: qcon_1 renders first. Uniqueness across slots
    -- is enforced in update_users.php, not by the database.
    qcon_1         TINYINT UNSIGNED  NULL DEFAULT NULL,
    qcon_2         TINYINT UNSIGNED  NULL DEFAULT NULL,
    qcon_3         TINYINT UNSIGNED  NULL DEFAULT NULL,
    -- Canonical dotted-decimal display address ("37.34@bit"), derived
    -- server-side from the identity key (common.php mirrors the GUI's
    -- formatQmailAddress). Stored so qmail_address_starts_with can use an
    -- indexed LIKE 'x%' scan.
    qmail_address  VARCHAR(32)       NOT NULL,
    revision       BIGINT UNSIGNED   NOT NULL DEFAULT 1,
    created_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (denomination, serial_number),
    INDEX idx_first_name    (first_name),
    INDEX idx_last_name     (last_name),
    INDEX idx_qmail_address (qmail_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
