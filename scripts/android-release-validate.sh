#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK_PATH="${APK_PATH:-$ROOT_DIR/frontend/android/app/build/outputs/apk/release/app-release.apk}"
PACKAGE_NAME="${PACKAGE_NAME:-com.aventaro.app}"
MAIN_ACTIVITY="${MAIN_ACTIVITY:-com.aventaro.app/.MainActivity}"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:8000}"
LOG_FILE="${LOG_FILE:-$ROOT_DIR/android-release-validation.log}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: '$1' is required but not installed."
    exit 1
  }
}

curl_json() {
  local output_file="$1"
  shift
  local status
  status="$(curl -sS -m 20 -o "$output_file" -w "%{http_code}" "$@")"
  printf '%s' "$status"
}

extract_json_field() {
  local file_path="$1"
  local field_name="$2"
  python - "$file_path" "$field_name" <<'PY'
import json, sys
path = sys.argv[1]
field = sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
value = data
for key in field.split("."):
    if isinstance(value, dict) and key in value:
        value = value[key]
    else:
        value = ""
        break
if value is None:
    value = ""
print(value)
PY
}

require_cmd adb
require_cmd curl
require_cmd python

if [[ ! -f "$APK_PATH" ]]; then
  echo "ERROR: APK not found at $APK_PATH"
  exit 1
fi

USE_DEVICE_CHECK=true
if [[ "${SKIP_DEVICE_CHECK:-false}" == "true" ]]; then
  USE_DEVICE_CHECK=false
fi

if [[ "$USE_DEVICE_CHECK" == "true" ]]; then
  echo "===> Waiting for Android device/emulator"
  adb start-server >/dev/null
  DEVICE_COUNT="$(adb devices | awk 'NR>1 && $2=="device" {count++} END {print count+0}')"
  if [[ "$DEVICE_COUNT" -lt 1 ]]; then
    echo "ERROR: No connected emulator/device found."
    exit 1
  fi

  echo "===> Installing release APK"
  adb uninstall "$PACKAGE_NAME" >/dev/null 2>&1 || true
  adb install -r "$APK_PATH"

  echo "===> Launching app in release mode"
  adb shell am force-stop "$PACKAGE_NAME" || true
  adb logcat -c
  adb shell am start -n "$MAIN_ACTIVITY"

  echo "===> Capturing logcat"
  adb logcat -v time >"$LOG_FILE" &
  LOGCAT_PID=$!
  trap 'kill "$LOGCAT_PID" >/dev/null 2>&1 || true; rm -rf "$TMP_DIR"' EXIT
  sleep 6
else
  echo "===> SKIP_DEVICE_CHECK=true (device install/launch/logcat skipped)"
  : >"$LOG_FILE"
  LOGCAT_PID=""
fi

echo "===> Simulating backend flow (signup/login/discover/booking/payment/chat)"
RAND_ID="$(date +%s)"
EMAIL="release.validate.${RAND_ID}@aventaro.test"
PASSWORD="Validate1234"

SIGNUP_OUT="$TMP_DIR/signup.json"
SIGNUP_STATUS="$(curl_json "$SIGNUP_OUT" -X POST "$API_BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"full_name\":\"Release Validate\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  || true)"

TOKEN="$(extract_json_field "$SIGNUP_OUT" "access_token" || true)"
if [[ -z "${TOKEN:-}" ]]; then
  LOGIN_OUT="$TMP_DIR/login.json"
  LOGIN_STATUS="$(curl_json "$LOGIN_OUT" -X POST "$API_BASE_URL/api/auth/signin" \
    -H "Content-Type: application/json" \
    -d "{\"login\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
    || true)"
  TOKEN="$(extract_json_field "$LOGIN_OUT" "access_token")"
  if [[ -z "${TOKEN:-}" && "${LOGIN_STATUS:-000}" != "200" && "${LOGIN_STATUS:-000}" != "201" ]]; then
    echo "ERROR: Login failed with HTTP ${LOGIN_STATUS:-000}."
    if [[ -n "${LOGCAT_PID:-}" ]]; then
      kill "$LOGCAT_PID" >/dev/null 2>&1 || true
    fi
    exit 1
  fi
fi

if [[ -z "${TOKEN:-}" ]]; then
  echo "ERROR: Unable to obtain auth token during validation flow. Signup HTTP=${SIGNUP_STATUS:-000}"
  if [[ -n "${LOGCAT_PID:-}" ]]; then
    kill "$LOGCAT_PID" >/dev/null 2>&1 || true
  fi
  exit 1
fi

DISCOVER_OUT="$TMP_DIR/discover.json"
DISCOVER_STATUS="$(curl_json "$DISCOVER_OUT" "$API_BASE_URL/api/users/discover?limit=1" \
  -H "Authorization: Bearer $TOKEN" \
  || true)"
if [[ "${DISCOVER_STATUS:-000}" != "200" ]]; then
  echo "ERROR: Discover API validation failed with HTTP ${DISCOVER_STATUS:-000}."
  if [[ -n "${LOGCAT_PID:-}" ]]; then
    kill "$LOGCAT_PID" >/dev/null 2>&1 || true
  fi
  exit 1
fi

BOOKING_OUT="$TMP_DIR/booking.json"
BOOKING_STATUS="$(curl_json "$BOOKING_OUT" -X POST "$API_BASE_URL/api/booking/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "booking_item_id": "hotel_release_validate_001",
    "service_type": "hotel",
    "guest_name": "Release Validate",
    "guest_email": "release.validate@aventaro.test",
    "guest_phone": "9999999999",
    "guest_count": 1,
    "payment_method": "card",
    "idempotency_key": "release_validate_001"
  }' || true)"
if [[ "${BOOKING_STATUS:-000}" != "200" && "${BOOKING_STATUS:-000}" != "201" ]]; then
  echo "ERROR: Booking creation validation failed with HTTP ${BOOKING_STATUS:-000}."
  if [[ -n "${LOGCAT_PID:-}" ]]; then
    kill "$LOGCAT_PID" >/dev/null 2>&1 || true
  fi
  exit 1
fi

BOOKING_ID="$(extract_json_field "$BOOKING_OUT" "booking.id" || true)"
if [[ -z "${BOOKING_ID:-}" ]]; then
  BOOKING_ID="$(extract_json_field "$BOOKING_OUT" "booking._id" || true)"
fi
if [[ -z "${BOOKING_ID:-}" ]]; then
  echo "ERROR: Booking creation did not return booking id."
  if [[ -n "${LOGCAT_PID:-}" ]]; then
    kill "$LOGCAT_PID" >/dev/null 2>&1 || true
  fi
  exit 1
fi

PAYMENT_OUT="$TMP_DIR/payment.json"
PAYMENT_STATUS="$(curl_json "$PAYMENT_OUT" -X POST "$API_BASE_URL/api/payment/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"booking_id\": \"$BOOKING_ID\",
    \"amount\": 1500,
    \"currency\": \"INR\",
    \"provider\": \"stripe\",
    \"method\": \"card\",
    \"idempotency_key\": \"release_payment_${RAND_ID}\"
  }" || true)"
if [[ "${PAYMENT_STATUS:-000}" != "200" && "${PAYMENT_STATUS:-000}" != "201" ]]; then
  echo "ERROR: Payment intent validation failed with HTTP ${PAYMENT_STATUS:-000}."
  if [[ -n "${LOGCAT_PID:-}" ]]; then
    kill "$LOGCAT_PID" >/dev/null 2>&1 || true
  fi
  exit 1
fi
PAYMENT_TXN_ID="$(extract_json_field "$PAYMENT_OUT" "transaction_id" || true)"
if [[ -z "${PAYMENT_TXN_ID:-}" ]]; then
  echo "ERROR: Payment validation did not return transaction_id."
  if [[ -n "${LOGCAT_PID:-}" ]]; then
    kill "$LOGCAT_PID" >/dev/null 2>&1 || true
  fi
  exit 1
fi

CHAT_OUT="$TMP_DIR/chat.json"
CHAT_STATUS="$(curl_json "$CHAT_OUT" "$API_BASE_URL/api/chat/conversations" \
  -H "Authorization: Bearer $TOKEN" \
  || true)"
if [[ "${CHAT_STATUS:-000}" != "200" ]]; then
  echo "ERROR: Chat API validation failed with HTTP ${CHAT_STATUS:-000}."
  if [[ -n "${LOGCAT_PID:-}" ]]; then
    kill "$LOGCAT_PID" >/dev/null 2>&1 || true
  fi
  exit 1
fi

echo "===> Checking websocket chat connection"
WS_URL="${WS_URL:-${API_BASE_URL/http/ws}/ws/chat?token=$TOKEN}"
node - "$WS_URL" <<'NODE'
const crypto = require('crypto');
const net = require('net');
const tls = require('tls');
const { URL } = require('url');

const wsUrl = new URL(process.argv[2]);
if (!['ws:', 'wss:'].includes(wsUrl.protocol)) {
  process.exit(1);
}

function parseFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }
  let offset = 2;
  let payloadLength = buffer[1] & 0x7f;
  if (payloadLength === 126) {
    if (buffer.length < 4) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) {
      return null;
    }
    const big = buffer.readBigUInt64BE(2);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    payloadLength = Number(big);
    offset = 10;
  }
  if (buffer.length < offset + payloadLength) {
    return null;
  }
  return buffer.subarray(offset, offset + payloadLength).toString('utf8');
}

const key = crypto.randomBytes(16).toString('base64');
const path = `${wsUrl.pathname}${wsUrl.search}`;
const hostHeader = wsUrl.port ? `${wsUrl.hostname}:${wsUrl.port}` : wsUrl.hostname;
const request =
  `GET ${path} HTTP/1.1\r\n` +
  `Host: ${hostHeader}\r\n` +
  'Upgrade: websocket\r\n' +
  'Connection: Upgrade\r\n' +
  `Sec-WebSocket-Key: ${key}\r\n` +
  'Sec-WebSocket-Version: 13\r\n\r\n';

const socket =
  wsUrl.protocol === 'wss:'
    ? tls.connect({ host: wsUrl.hostname, port: Number(wsUrl.port || 443) })
    : net.connect({ host: wsUrl.hostname, port: Number(wsUrl.port || 80) });

let buffer = Buffer.alloc(0);
let handshakeComplete = false;

const timeout = setTimeout(() => {
  socket.destroy();
  process.exit(1);
}, 10000);

socket.on('connect', () => {
  socket.write(request);
});

socket.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  if (!handshakeComplete) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      return;
    }
    const headers = buffer.subarray(0, headerEnd).toString('utf8');
    if (!headers.startsWith('HTTP/1.1 101')) {
      clearTimeout(timeout);
      socket.destroy();
      process.exit(1);
    }
    handshakeComplete = true;
    buffer = buffer.subarray(headerEnd + 4);
  }

  const payload = parseFrame(buffer);
  if (!payload) {
    return;
  }

  try {
    const parsed = JSON.parse(payload);
    if (parsed?.type === 'connected') {
      clearTimeout(timeout);
      socket.end();
      process.exit(0);
    }
  } catch {
    // Ignore non-JSON frames.
  }
});

socket.on('error', () => {
  clearTimeout(timeout);
  process.exit(1);
});
NODE

sleep 6
if [[ -n "${LOGCAT_PID:-}" ]]; then
  kill "$LOGCAT_PID" >/dev/null 2>&1 || true
fi

echo "===> Analyzing crash signatures"
CRASH_PATTERNS='FATAL EXCEPTION|Fatal signal|E/AndroidRuntime|ReactNativeJS.*(TypeError|ReferenceError|Unhandled promise rejection|Unhandled Promise Rejection|Invariant Violation)|RedBox|SIGSEGV|Abort message'
if grep -Eiq "$CRASH_PATTERNS" "$LOG_FILE"; then
  echo "CRASH DETECTION RESULT: FAIL"
  echo "Matched crash/error signatures:"
  grep -Ein "$CRASH_PATTERNS" "$LOG_FILE" | head -n 40
  exit 1
fi

echo "CRASH DETECTION RESULT: PASS"
echo "Validation output files:"
echo "  - Signup/Login: $SIGNUP_OUT"
echo "  - Discover: $DISCOVER_OUT"
echo "  - Booking: $BOOKING_OUT"
echo "  - Payment: $PAYMENT_OUT"
echo "  - Chat: $CHAT_OUT"
echo "  - Logcat: $LOG_FILE"
