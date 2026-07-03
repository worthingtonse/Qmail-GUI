<?php
/**
 * POST /update_users - publish/update a QMail public profile.
 * Contract: docs/fab.cons_plan.txt (frozen v1).
 *
 * Body (application/json):
 *   { "denomination": 0, "serial_number": 9506,
 *     "first_name": "Pat", "last_name": "Nash", "description": "...",
 *     "inbox_fee": 5, "qcons": [12, 200, 3], "auth": null }
 *
 * Success: { "status":"success", "profile": {canonical stored record} }
 *
 * v1 WARNING: `auth` is reserved but NOT validated - any caller can write
 * any (denomination, serial_number) record. An ownership-proof protocol is
 * a prerequisite for public production use (plan divergence D1).
 */

require __DIR__ . '/common.php';

handle_preflight();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond_error(405, 'Use POST with a JSON body');
}

$raw_body = file_get_contents('php://input');
if ($raw_body === false || strlen($raw_body) > 8192) {
    respond_error(413, 'Request body missing or too large');
}

$input = json_decode($raw_body, true);
if (!is_array($input)) {
    respond_error(400, 'Body must be a JSON object');
}

$denomination = parse_denomination($input['denomination'] ?? null);
if ($denomination === null) {
    respond_error(400, 'denomination must be an integer 0-4');
}

$serial_number = parse_serial_number($input['serial_number'] ?? null);
if ($serial_number === null) {
    respond_error(400, 'serial_number must be an integer 1-' . MAX_SERIAL_NUMBER);
}

$first_name = $input['first_name'] ?? '';
$last_name = $input['last_name'] ?? '';
$description = $input['description'] ?? '';
if (!is_string($first_name) || mb_strlen($first_name) > MAX_FIRST_NAME) {
    respond_error(400, 'first_name must be a string of at most ' . MAX_FIRST_NAME . ' characters');
}
if (!is_string($last_name) || mb_strlen($last_name) > MAX_LAST_NAME) {
    respond_error(400, 'last_name must be a string of at most ' . MAX_LAST_NAME . ' characters');
}
if (!is_string($description) || mb_strlen($description) > MAX_DESCRIPTION) {
    respond_error(400, 'description must be a string of at most ' . MAX_DESCRIPTION . ' characters');
}

$inbox_fee = $input['inbox_fee'] ?? 0;
if (!is_int($inbox_fee) || $inbox_fee < 0) {
    respond_error(400, 'inbox_fee must be a non-negative integer');
}

// qcons: ordered array of 0..3 unique integers 0..255. Empty array is a
// valid "published, use deterministic avatar fallback" state.
$qcons = $input['qcons'] ?? [];
if (!is_array($qcons) || array_keys($qcons) !== range(0, count($qcons) - 1)) {
    respond_error(400, 'qcons must be a JSON array');
}
if (count($qcons) > MAX_QCONS) {
    respond_error(400, 'qcons may contain at most ' . MAX_QCONS . ' entries');
}
foreach ($qcons as $index) {
    if (!is_int($index) || $index < 0 || $index > MAX_QCON_INDEX) {
        respond_error(400, 'each qcon must be an integer 0-' . MAX_QCON_INDEX);
    }
}
if (count($qcons) !== count(array_unique($qcons))) {
    respond_error(400, 'qcons must not contain duplicates');
}

$qmail_address = build_qmail_address($denomination, $serial_number);
$pdo = get_pdo();

$statement = $pdo->prepare(
    'INSERT INTO public_users
        (denomination, serial_number, first_name, last_name, description,
         inbox_fee, qcon_1, qcon_2, qcon_3, qmail_address)
     VALUES
        (:denomination, :serial_number, :first_name, :last_name, :description,
         :inbox_fee, :qcon_1, :qcon_2, :qcon_3, :qmail_address)
     ON DUPLICATE KEY UPDATE
        first_name = VALUES(first_name),
        last_name = VALUES(last_name),
        description = VALUES(description),
        inbox_fee = VALUES(inbox_fee),
        qcon_1 = VALUES(qcon_1),
        qcon_2 = VALUES(qcon_2),
        qcon_3 = VALUES(qcon_3),
        qmail_address = VALUES(qmail_address),
        revision = revision + 1'
);

try {
    $statement->execute([
        ':denomination' => $denomination,
        ':serial_number' => $serial_number,
        ':first_name' => $first_name,
        ':last_name' => $last_name,
        ':description' => $description,
        ':inbox_fee' => $inbox_fee,
        ':qcon_1' => $qcons[0] ?? null,
        ':qcon_2' => $qcons[1] ?? null,
        ':qcon_3' => $qcons[2] ?? null,
        ':qmail_address' => $qmail_address,
    ]);
} catch (PDOException $e) {
    respond_error(500, 'Database write failed');
}

// Return the canonical stored record (the client persists THIS, not its
// own request object).
$select = $pdo->prepare(
    'SELECT * FROM public_users
     WHERE denomination = :denomination AND serial_number = :serial_number'
);
$select->execute([
    ':denomination' => $denomination,
    ':serial_number' => $serial_number,
]);
$row = $select->fetch();
if (!$row) {
    respond_error(500, 'Stored profile could not be read back');
}

respond_json(200, ['status' => 'success', 'profile' => row_to_profile($row)]);
