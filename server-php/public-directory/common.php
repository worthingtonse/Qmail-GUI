<?php
/**
 * Shared helpers for the QMail public user directory endpoints
 * (update_users.php / user_hints.php). Contract: docs/fab.cons_plan.txt.
 *
 * Every response is application/json. CORS is wide open on purpose: this
 * is a public directory read/written by the QMail-GUI renderer, whose
 * origin varies (packaged Electron, Vite dev server). The JSON POST is a
 * non-simple request, so the OPTIONS preflight below is required.
 */

const QMAIL_DENOMINATION_NAMES = ['bit', 'byte', 'kilo', 'mega', 'giga'];
const MAX_FIRST_NAME = 64;
const MAX_LAST_NAME = 64;
const MAX_DESCRIPTION = 512;
const MAX_QCONS = 3;
const MAX_QCON_INDEX = 255;
// INT UNSIGNED ceiling; current QMail serials are 3-byte but the server
// is forward-compatible with 4-byte serials (frozen contract).
const MAX_SERIAL_NUMBER = 4294967295;

function send_cors_headers(): void
{
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 86400');
}

function handle_preflight(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        send_cors_headers();
        http_response_code(204);
        exit;
    }
}

function respond_json(int $http_code, array $payload): void
{
    send_cors_headers();
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($http_code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function respond_error(int $http_code, string $message): void
{
    respond_json($http_code, ['status' => 'error', 'message' => $message]);
}

function get_pdo(): PDO
{
    $config_path = __DIR__ . '/config.php';
    if (!is_readable($config_path)) {
        respond_error(500, 'Server is not configured');
    }
    $config = require $config_path;
    try {
        $pdo = new PDO(
            "mysql:host={$config['db_host']};dbname={$config['db_name']};charset=utf8mb4",
            $config['db_user'],
            $config['db_pass'],
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    } catch (PDOException $e) {
        // Generic message: never leak DSN/credentials details to clients.
        respond_error(500, 'Database connection failed');
    }
    return $pdo;
}

/**
 * Canonical dotted-decimal QMail address. Mirrors the GUI's
 * formatQmailAddress (src/qmail/address/qmailAddress.js): serial bytes
 * high-to-low with leading zero bytes dropped, '@', denomination word.
 * Serials above 3 bytes get a leading 4th byte group (forward-compat).
 */
function build_qmail_address(int $denomination, int $serial_number): string
{
    $word = QMAIL_DENOMINATION_NAMES[$denomination];
    $bytes = [
        ($serial_number >> 24) & 0xff,
        ($serial_number >> 16) & 0xff,
        ($serial_number >> 8) & 0xff,
        $serial_number & 0xff,
    ];
    while (count($bytes) > 1 && $bytes[0] === 0) {
        array_shift($bytes);
    }
    return implode('.', $bytes) . '@' . $word;
}

/** Validated int in [0,4] or null. Accepts int or numeric string. */
function parse_denomination($value): ?int
{
    if (!is_int($value) && !(is_string($value) && preg_match('/^\d+$/', $value))) {
        return null;
    }
    $code = (int) $value;
    return ($code >= 0 && $code <= 4) ? $code : null;
}

/** Validated serial in [1, MAX_SERIAL_NUMBER] or null. */
function parse_serial_number($value): ?int
{
    if (!is_int($value) && !(is_string($value) && preg_match('/^\d+$/', $value))) {
        return null;
    }
    $sn = (int) $value;
    return ($sn >= 1 && $sn <= MAX_SERIAL_NUMBER) ? $sn : null;
}

/** Escape LIKE metacharacters so user input matches literally. */
function escape_like(string $value): string
{
    return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
}

/**
 * One DB row -> the contract's profile object. qcon_1..3 collapse into a
 * single ordered `qcons` array (NULL slots dropped).
 */
function row_to_profile(array $row): array
{
    $qcons = [];
    foreach (['qcon_1', 'qcon_2', 'qcon_3'] as $column) {
        if ($row[$column] !== null) {
            $qcons[] = (int) $row[$column];
        }
    }
    return [
        'denomination' => (int) $row['denomination'],
        'serial_number' => (int) $row['serial_number'],
        'qmail_address' => $row['qmail_address'],
        'first_name' => $row['first_name'],
        'last_name' => $row['last_name'],
        'description' => $row['description'],
        'inbox_fee' => (int) $row['inbox_fee'],
        'qcons' => $qcons,
        'revision' => (int) $row['revision'],
        'updated_at' => $row['updated_at'],
    ];
}
