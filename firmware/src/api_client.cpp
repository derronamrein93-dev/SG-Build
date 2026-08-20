#include "api_client.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <esp_system.h>
#include <time.h>

namespace {

/** Rough serialised size of an event, so String growth does not thrash heap. */
constexpr size_t kEventReserveBytes = STRIDE_MATRIX_CELLS * 5 + 1280;

bool isPlaceholder(const char *value) {
  return value != nullptr && strncmp(value, "CHANGE_ME", 9) == 0;
}

}  // namespace

// ===========================================================================
// RamEventQueue
// ===========================================================================

RamEventQueue::RamEventQueue() : head_(0), count_(0), dropped_(0) {}

bool RamEventQueue::enqueue(const String &payload) {
  if (payload.length() == 0) {
    return false;
  }

  if (count_ == STRIDE_EVENT_QUEUE_DEPTH) {
    // Full. Drop the oldest so the freshest scan survives, and count it -
    // silent loss is worse than loss you can see in the health events.
    head_ = (head_ + 1) % STRIDE_EVENT_QUEUE_DEPTH;
    --count_;
    ++dropped_;
  }

  const size_t tail = (head_ + count_) % STRIDE_EVENT_QUEUE_DEPTH;
  slots_[tail] = payload;
  ++count_;
  return true;
}

bool RamEventQueue::peek(String &payload) const {
  if (count_ == 0) {
    return false;
  }
  payload = slots_[head_];
  return true;
}

bool RamEventQueue::pop() {
  if (count_ == 0) {
    return false;
  }
  slots_[head_] = String();  // release the buffer straight away
  head_ = (head_ + 1) % STRIDE_EVENT_QUEUE_DEPTH;
  --count_;
  return true;
}

// ===========================================================================
// ApiClient
// ===========================================================================

ApiClient::ApiClient()
    : queue_(nullptr),
      status_(UploadStatus::kIdle),
      attempts_(0),
      nextAttemptAtMs_(0),
      cycleAbandonedAtMs_(0),
      lastWifiAttemptMs_(0),
      lastHttpStatus_(0),
      lastError_("idle"),
      clockSynced_(false),
      associationStarted_(false) {}

void ApiClient::begin(EventQueue *queue) {
  queue_ = queue;
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(STRIDE_WIFI_HOSTNAME);
  WiFi.setAutoReconnect(true);
}

bool ApiClient::usingPlaceholderCredentials() {
  return isPlaceholder(STRIDE_WIFI_SSID) || isPlaceholder(STRIDE_WIFI_PASSWORD) ||
         isPlaceholder(STRIDE_API_KEY);
}

// --- Connectivity ----------------------------------------------------------

void ApiClient::resetConnection() { associationStarted_ = false; }

bool ApiClient::connectWifi(uint32_t timeoutMs) {
  lastWifiAttemptMs_ = millis();

  if (WiFi.status() == WL_CONNECTED) {
    lastError_ = "ok";
    return true;
  }

  if (isPlaceholder(STRIDE_WIFI_SSID)) {
    lastError_ = "Wi-Fi SSID is still the placeholder - see src/secrets.h";
    return false;
  }

  const wl_status_t status = WiFi.status();
  if (!associationStarted_ || status == WL_CONNECT_FAILED ||
      status == WL_NO_SSID_AVAIL || status == WL_CONNECTION_LOST) {
    // Re-calling WiFi.begin() on every poll would restart association and
    // guarantee it never completes, so it is started once per attempt.
    WiFi.begin(STRIDE_WIFI_SSID, STRIDE_WIFI_PASSWORD);
    associationStarted_ = true;
  }

  const uint32_t startedMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedMs < timeoutMs) {
    delay(100);
  }

  if (WiFi.status() != WL_CONNECTED) {
    lastError_ = "Wi-Fi association not complete";
    return false;
  }

  lastError_ = "ok";
  return true;
}

bool ApiClient::isWifiConnected() const { return WiFi.status() == WL_CONNECTED; }

int32_t ApiClient::signalStrength() const {
  return isWifiConnected() ? WiFi.RSSI() : 0;
}

String ApiClient::localAddress() const {
  return isWifiConnected() ? WiFi.localIP().toString() : String("0.0.0.0");
}

bool ApiClient::syncClock(uint32_t timeoutMs) {
  if (!isWifiConnected()) {
    return false;
  }

  configTime(STRIDE_NTP_GMT_OFFSET_SEC, STRIDE_NTP_DAYLIGHT_OFFSET_SEC,
             STRIDE_NTP_SERVER_PRIMARY, STRIDE_NTP_SERVER_SECONDARY);

  const uint32_t startedMs = millis();
  while (millis() - startedMs < timeoutMs) {
    // Anything past 2021 means SNTP has replaced the boot-time epoch.
    if (time(nullptr) > 1600000000) {
      clockSynced_ = true;
      return true;
    }
    delay(100);
  }

  clockSynced_ = false;
  return false;
}

void ApiClient::formatTimestamp(time_t epochSeconds, char *out, size_t len) {
  if (out == nullptr || len == 0) {
    return;
  }
  struct tm timeinfo;
  gmtime_r(&epochSeconds, &timeinfo);
  strftime(out, len, "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
}

void ApiClient::generateEventId(char *out, size_t len) {
  if (out == nullptr || len < 37) {
    return;
  }
  uint8_t bytes[16];
  for (uint8_t i = 0; i < 16; i += 4) {
    const uint32_t word = esp_random();
    bytes[i + 0] = static_cast<uint8_t>(word >> 24);
    bytes[i + 1] = static_cast<uint8_t>(word >> 16);
    bytes[i + 2] = static_cast<uint8_t>(word >> 8);
    bytes[i + 3] = static_cast<uint8_t>(word);
  }
  bytes[6] = static_cast<uint8_t>((bytes[6] & 0x0F) | 0x40);  // version 4
  bytes[8] = static_cast<uint8_t>((bytes[8] & 0x3F) | 0x80);  // variant

  snprintf(out, len,
           "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6],
           bytes[7], bytes[8], bytes[9], bytes[10], bytes[11], bytes[12],
           bytes[13], bytes[14], bytes[15]);
}

// --- Envelope --------------------------------------------------------------

String ApiClient::buildScanEvent(const PressureFrame &frame, float weightKg,
                                 const char *calibrationVersion,
                                 const char *customerId) {
  JsonDocument doc;

  char eventId[37];
  generateEventId(eventId, sizeof(eventId));

  char timestamp[32];
  formatTimestamp(frame.epochSeconds != 0 ? frame.epochSeconds : time(nullptr),
                  timestamp, sizeof(timestamp));

  doc["event_id"] = eventId;
  doc["event_type"] = STRIDE_EVENT_TYPE_SCAN;
  doc["schema_version"] = SCHEMA_VERSION;
  doc["organization_id"] = STRIDE_ORGANIZATION_ID;
  doc["location_id"] = STRIDE_LOCATION_ID;
  doc["device_id"] = DEVICE_ID;

  // The customer is usually not identified at scan time. Explicit null rather
  // than an omitted key, so the receiver never has to guess which it is.
  if (customerId != nullptr && customerId[0] != '\0') {
    doc["customer_id"] = customerId;
  } else {
    doc["customer_id"] = nullptr;
  }

  doc["timestamp"] = timestamp;

  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["weight_kg"] = serialized(String(weightKg, 2));
  payload["rows"] = STRIDE_MATRIX_ROWS;
  payload["columns"] = STRIDE_MATRIX_COLUMNS;

  // Row-major: index = row * columns + column. Raw calibrated ADC counts, not
  // pressure units - conversion belongs with the calibration record server side.
  JsonArray matrix = payload["pressure_matrix"].to<JsonArray>();
  for (uint16_t i = 0; i < STRIDE_MATRIX_CELLS; ++i) {
    matrix.add(frame.values[i]);
  }

  payload["scan_duration_ms"] = frame.scanDurationMs;
  payload["calibration_version"] = calibrationVersion;
  payload["firmware_version"] = FIRMWARE_VERSION;

  JsonObject metadata = doc["metadata"].to<JsonObject>();
  metadata["device_serial"] = DEVICE_SERIAL;
  metadata["hardware_revision"] = HARDWARE_REVISION;
  metadata["simulation_mode"] = static_cast<bool>(SIMULATION_MODE);
  metadata["clock_synced"] = clockSynced_;
  metadata["uptime_ms"] = millis();
  metadata["wifi_rssi"] = signalStrength();
  metadata["adc_max_value"] = STRIDE_ADC_MAX_VALUE;

  // Physical geometry, so the receiver can reconstruct sensor coordinates:
  // sensel (row, column) sits at (column * pitch_mm, row * pitch_mm) from the
  // centre of sensel (0, 0). Shipped per event rather than assumed server-side,
  // because a future hardware revision may change the pitch.
  JsonObject geometry = metadata["geometry"].to<JsonObject>();
  geometry["rows"] = MATRIX_ROWS;
  geometry["columns"] = MATRIX_COLS;
  geometry["pitch_mm"] = serialized(String(SENSOR_PITCH_MM, 2));
  geometry["trace_width_mm"] = serialized(String(COPPER_TRACE_WIDTH_MM, 2));
  geometry["center_span_x_mm"] = serialized(String(GRID_CENTER_SPAN_X_MM, 2));
  geometry["center_span_y_mm"] = serialized(String(GRID_CENTER_SPAN_Y_MM, 2));
  geometry["active_copper_width_mm"] =
      serialized(String(ACTIVE_COPPER_WIDTH_MM, 2));
  geometry["active_copper_height_mm"] =
      serialized(String(ACTIVE_COPPER_HEIGHT_MM, 2));
  geometry["platform_width_mm"] = serialized(String(PLATFORM_WIDTH_MM, 1));
  geometry["platform_height_mm"] = serialized(String(PLATFORM_HEIGHT_MM, 1));
  geometry["origin"] = "sensel_0_0_center";
  geometry["order"] = "row_major";
  metadata["min_value"] = frame.minValue;
  metadata["max_value"] = frame.maxValue;
  metadata["average_value"] = serialized(String(frame.averageValue, 1));
  metadata["active_sensor_count"] = frame.activeSensorCount;
  metadata["saturated_count"] = frame.saturatedCount;
  metadata["frame_valid"] = frame.valid;

  String body;
  body.reserve(kEventReserveBytes);
  serializeJson(doc, body);
  return body;
}

// --- Transmission ----------------------------------------------------------

uint32_t ApiClient::backoffFor(uint8_t attempt) {
  if (attempt <= 1) {
    return 0;
  }
  uint32_t delayMs = STRIDE_HTTP_BACKOFF_BASE_MS;
  for (uint8_t i = 2; i < attempt; ++i) {
    delayMs *= 2;
    if (delayMs >= STRIDE_HTTP_BACKOFF_MAX_MS) {
      return STRIDE_HTTP_BACKOFF_MAX_MS;
    }
  }
  return delayMs;
}

int ApiClient::post(const char *path, const String &body) {
  if (!isWifiConnected()) {
    return -1;
  }

  String url(STRIDE_API_BASE_URL);
  url += path;

  HTTPClient http;
  http.setTimeout(STRIDE_HTTP_TIMEOUT_MS);
  http.setConnectTimeout(STRIDE_HTTP_TIMEOUT_MS);

  // TODO(auth): pin the API's certificate (or provision a device client
  // certificate) instead of relying on the default trust store. Also replace
  // this static bearer token with a per-device credential.
  if (!http.begin(url)) {
    return -2;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + STRIDE_API_KEY);
  http.addHeader("X-Stride-Device-Id", DEVICE_ID);
  http.addHeader("X-Stride-Firmware", FIRMWARE_VERSION);

  const int status = http.POST(body);
  http.end();
  return status;
}

void ApiClient::startCycle() {
  attempts_ = 0;
  nextAttemptAtMs_ = millis();
  status_ = UploadStatus::kPending;
}

bool ApiClient::sendEvent(const PressureFrame &frame, float weightKg,
                          const char *calibrationVersion, const char *customerId) {
  if (queue_ == nullptr) {
    lastError_ = "no event queue attached";
    return false;
  }

  const String body =
      buildScanEvent(frame, weightKg, calibrationVersion, customerId);
  if (body.length() == 0) {
    lastError_ = "failed to serialise event";
    return false;
  }

  if (!queue_->enqueue(body)) {
    lastError_ = "could not buffer event";
    return false;
  }

  startCycle();
  lastError_ = "queued";
  return true;
}

bool ApiClient::sendHealthCheck(const char *status, const char *calibrationVersion) {
  if (!isWifiConnected()) {
    lastError_ = "health check skipped: Wi-Fi down";
    return false;
  }

  JsonDocument doc;

  char eventId[37];
  generateEventId(eventId, sizeof(eventId));

  char timestamp[32];
  formatTimestamp(time(nullptr), timestamp, sizeof(timestamp));

  doc["event_id"] = eventId;
  doc["event_type"] = STRIDE_EVENT_TYPE_HEALTH;
  doc["schema_version"] = SCHEMA_VERSION;
  doc["organization_id"] = STRIDE_ORGANIZATION_ID;
  doc["location_id"] = STRIDE_LOCATION_ID;
  doc["device_id"] = DEVICE_ID;
  doc["customer_id"] = nullptr;
  doc["timestamp"] = timestamp;

  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["status"] = status;
  payload["firmware_version"] = FIRMWARE_VERSION;
  payload["calibration_version"] = calibrationVersion;
  payload["uptime_ms"] = millis();
  payload["free_heap"] = ESP.getFreeHeap();
  payload["wifi_rssi"] = signalStrength();
  payload["queued_events"] = queueDepth();
  payload["dropped_events"] = droppedEvents();
  payload["simulation_mode"] = static_cast<bool>(SIMULATION_MODE);

  JsonObject metadata = doc["metadata"].to<JsonObject>();
  metadata["device_serial"] = DEVICE_SERIAL;
  metadata["hardware_revision"] = HARDWARE_REVISION;

  String body;
  serializeJson(doc, body);

  const int httpStatus = post(STRIDE_API_HEALTH_PATH, body);
  lastHttpStatus_ = httpStatus;

  // Health checks are disposable: the next one carries the same picture, so a
  // failure is reported and dropped rather than filling the scan queue.
  const bool ok = httpStatus >= 200 && httpStatus < 300;
  lastError_ = ok ? "ok" : String("health check failed, HTTP ") + httpStatus;
  return ok;
}

void ApiClient::loop() {
  // Reconnect in the background so a dropped AP does not need a state change.
  if (!isWifiConnected() && !isPlaceholder(STRIDE_WIFI_SSID) &&
      millis() - lastWifiAttemptMs_ >= STRIDE_WIFI_RETRY_INTERVAL_MS) {
    lastWifiAttemptMs_ = millis();
    WiFi.reconnect();
  }

  if (queue_ == nullptr || queue_->empty()) {
    if (status_ != UploadStatus::kSucceeded) {
      status_ = UploadStatus::kIdle;
    }
    return;
  }

  // A cycle that used up its attempts parks the event. Nothing is discarded -
  // a new cycle starts once the retry interval has elapsed.
  if (status_ == UploadStatus::kBuffered) {
    if (millis() - cycleAbandonedAtMs_ < STRIDE_QUEUE_RETRY_INTERVAL_MS) {
      return;
    }
    startCycle();
  }

  if (status_ == UploadStatus::kIdle || status_ == UploadStatus::kSucceeded) {
    startCycle();
  }

  if (!isWifiConnected()) {
    status_ = UploadStatus::kPending;
    lastError_ = "waiting for Wi-Fi";
    return;
  }

  if (static_cast<int32_t>(millis() - nextAttemptAtMs_) < 0) {
    return;  // still backing off
  }

  String body;
  if (!queue_->peek(body)) {
    status_ = UploadStatus::kIdle;
    return;
  }

  status_ = UploadStatus::kSending;
  ++attempts_;

  const int httpStatus = post(STRIDE_API_EVENTS_PATH, body);
  lastHttpStatus_ = httpStatus;

  if (httpStatus >= 200 && httpStatus < 300) {
    queue_->pop();
    status_ = UploadStatus::kSucceeded;
    lastError_ = "ok";
    attempts_ = 0;
    return;
  }

  // 4xx other than 408/429 will not improve by being sent again. Keeping the
  // event queued would block every later scan behind one bad request, so it is
  // dropped here and the reason is reported loudly over Serial.
  const bool permanent = httpStatus >= 400 && httpStatus < 500 &&
                         httpStatus != 408 && httpStatus != 429;
  if (permanent) {
    queue_->pop();
    status_ = UploadStatus::kIdle;
    attempts_ = 0;
    lastError_ = String("event rejected, HTTP ") + httpStatus + " (not retried)";
    return;
  }

  if (attempts_ >= STRIDE_HTTP_MAX_ATTEMPTS) {
    status_ = UploadStatus::kBuffered;
    cycleAbandonedAtMs_ = millis();
    lastError_ = String("upload failed after ") + attempts_ +
                 " attempts, HTTP " + httpStatus + " - event buffered";
    return;
  }

  nextAttemptAtMs_ = millis() + backoffFor(static_cast<uint8_t>(attempts_ + 1));
  status_ = UploadStatus::kPending;
  lastError_ = String("attempt ") + attempts_ + " failed, HTTP " + httpStatus +
               " - retrying";
}
