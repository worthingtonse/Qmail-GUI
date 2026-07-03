#!/bin/sh
# Curl smoke tests for the QMail public directory endpoints.
# Usage: ./test_endpoints.sh [base-url]
# Default base is the production host; point it at staging while testing.
set -u

BASE="${1:-https://raida11.cloudcoin.global}"
PASS=0
FAIL=0

check() {
  desc="$1"; expected="$2"; actual="$3"; body="$4"
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS + 1)); echo "PASS  [$actual] $desc"
  else
    FAIL=$((FAIL + 1)); echo "FAIL  [$actual, wanted $expected] $desc"; echo "      $body"
  fi
}

post() { # post <json> -> sets STATUS and BODY
  BODY=$(curl -s -w '\n%{http_code}' -X POST "$BASE/update_users" \
    -H 'Content-Type: application/json' -d "$1")
  STATUS=$(printf '%s' "$BODY" | tail -n 1)
  BODY=$(printf '%s' "$BODY" | sed '$d')
}

get() { # get <query-string> -> sets STATUS and BODY
  BODY=$(curl -s -w '\n%{http_code}' "$BASE/user_hints?$1")
  STATUS=$(printf '%s' "$BODY" | tail -n 1)
  BODY=$(printf '%s' "$BODY" | sed '$d')
}

echo "== update_users =="

post '{"denomination":0,"serial_number":9506,"first_name":"Pat","last_name":"Nash","description":"smoke test","inbox_fee":5,"qcons":[12,200,3]}'
check "create/update valid profile" 200 "$STATUS" "$BODY"

post '{"denomination":0,"serial_number":9506,"first_name":"Pat","last_name":"Nash","description":"updated","inbox_fee":7,"qcons":[]}'
check "update same key with empty qcons" 200 "$STATUS" "$BODY"

post '{"denomination":9,"serial_number":9506,"qcons":[]}'
check "reject denomination out of range" 400 "$STATUS" "$BODY"

post '{"denomination":0,"serial_number":0,"qcons":[]}'
check "reject serial 0" 400 "$STATUS" "$BODY"

post '{"denomination":0,"serial_number":9506,"qcons":[1,1]}'
check "reject duplicate qcons" 400 "$STATUS" "$BODY"

post '{"denomination":0,"serial_number":9506,"qcons":[1,2,3,4]}'
check "reject more than 3 qcons" 400 "$STATUS" "$BODY"

post '{"denomination":0,"serial_number":9506,"qcons":[300]}'
check "reject qcon index over 255" 400 "$STATUS" "$BODY"

post 'not json'
check "reject non-JSON body" 400 "$STATUS" "$BODY"

echo "== user_hints =="

get "denomination=0&serial_number=9506"
check "exact lookup finds the smoke-test row" 200 "$STATUS" "$BODY"

get "first_name_starts_with=P"
check "first-name prefix search" 200 "$STATUS" "$BODY"

get "last_name_starts_with=na"
check "last-name prefix search" 200 "$STATUS" "$BODY"

get "qmail_address_starts_with=3"
check "address prefix search" 200 "$STATUS" "$BODY"

get "first_name_starts_with=%25"
check "LIKE wildcard is matched literally, not as wildcard" 200 "$STATUS" "$BODY"

get ""
check "reject parameterless request (no directory dump)" 400 "$STATUS" "$BODY"

get "denomination=0"
check "reject denomination without serial_number" 400 "$STATUS" "$BODY"

get "first_name_starts_with=P&limit=51"
check "reject limit over 50" 400 "$STATUS" "$BODY"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
