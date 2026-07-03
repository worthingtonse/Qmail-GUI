<?php
/**
 * GET /user_hints - search the QMail public user directory.
 * Contract: docs/fab.cons_plan.txt (frozen v1).
 *
 * Optional parameters (at least ONE criterion required):
 *   first_name_starts_with=P
 *   last_name_starts_with=na
 *   qmail_address_starts_with=3          (matches canonical "37.34@bit")
 *   denomination=0&serial_number=9506    (together: exact lookup)
 *   limit=25                             (1..50)
 *
 * Success: { "status":"success", "count": n, "results": [profile...] }
 * A parameterless request is rejected (400) so the directory cannot be
 * dumped with one call.
 */

require __DIR__ . '/common.php';

handle_preflight();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    respond_error(405, 'Use GET');
}

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;
const MAX_PREFIX_LENGTH = 64;

$limit = DEFAULT_LIMIT;
if (isset($_GET['limit'])) {
    if (!preg_match('/^\d+$/', $_GET['limit'])) {
        respond_error(400, 'limit must be an integer 1-' . MAX_LIMIT);
    }
    $limit = (int) $_GET['limit'];
    if ($limit < 1 || $limit > MAX_LIMIT) {
        respond_error(400, 'limit must be an integer 1-' . MAX_LIMIT);
    }
}

$conditions = [];
$bindings = [];

// Exact lookup: denomination + serial_number must come together.
$has_denomination = isset($_GET['denomination']);
$has_serial = isset($_GET['serial_number']);
if ($has_denomination !== $has_serial) {
    respond_error(400, 'denomination and serial_number must be provided together');
}
if ($has_denomination) {
    $denomination = parse_denomination($_GET['denomination']);
    if ($denomination === null) {
        respond_error(400, 'denomination must be an integer 0-4');
    }
    $serial_number = parse_serial_number($_GET['serial_number']);
    if ($serial_number === null) {
        respond_error(400, 'serial_number must be an integer 1-' . MAX_SERIAL_NUMBER);
    }
    $conditions[] = 'denomination = :denomination AND serial_number = :serial_number';
    $bindings[':denomination'] = $denomination;
    $bindings[':serial_number'] = $serial_number;
}

$prefix_params = [
    'first_name_starts_with' => 'first_name',
    'last_name_starts_with' => 'last_name',
    'qmail_address_starts_with' => 'qmail_address',
];
foreach ($prefix_params as $param => $column) {
    if (!isset($_GET[$param]) || $_GET[$param] === '') {
        continue;
    }
    $value = $_GET[$param];
    if (!is_string($value) || mb_strlen($value) > MAX_PREFIX_LENGTH) {
        respond_error(400, $param . ' is too long');
    }
    $conditions[] = "$column LIKE :$column ESCAPE '\\\\'";
    $bindings[":$column"] = escape_like($value) . '%';
}

if (count($conditions) === 0) {
    respond_error(400, 'Provide at least one search parameter '
        . '(first_name_starts_with, last_name_starts_with, '
        . 'qmail_address_starts_with, or denomination + serial_number)');
}

$pdo = get_pdo();
$sql = 'SELECT * FROM public_users WHERE ' . implode(' AND ', $conditions)
    . ' ORDER BY last_name, first_name, denomination, serial_number'
    . ' LIMIT ' . $limit;

try {
    $statement = $pdo->prepare($sql);
    $statement->execute($bindings);
    $rows = $statement->fetchAll();
} catch (PDOException $e) {
    respond_error(500, 'Database query failed');
}

respond_json(200, [
    'status' => 'success',
    'count' => count($rows),
    'results' => array_map('row_to_profile', $rows),
]);
