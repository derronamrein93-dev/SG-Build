/**
 * api_client.h - Wi-Fi transport and Stride Guide event API client.
 *
 * Responsibilities: connect, serialise a scan into the versioned event
 * envelope, and get it to POST /api/v1/events. Nothing is interpreted here -
 * the device ships measurements and identity; recommendations are the SaaS
 * side's job.
 *
 * Two rules shape the retry design:
 *
 *   1. Retries are bounded. An upload cycle makes at most
 *      STRIDE_HTTP_MAX_ATTEMPTS attempts with exponential backoff, then stops.
 *      There is no path that retries forever.
 *   2. A failed cycle does not destroy data. The serialised event stays in an
 *      EventQueue and a fresh cycle is started later. RamEventQueue is the
 *      bring-up implementation; a persistent one can be substituted without
 *      touching this class.
 *
 * All network work is driven from loop() and never blocks the state machine
 * for longer than one HTTP attempt.
 */

#ifndef STRIDE_API_CLIENT_H
#define STRIDE_API_CLIENT_H

#include <Arduino.h>

#include "config.h"
#include "pressure_matrix.h"

/** Where an upload cycle currently stands. */
enum class UploadStatus {
  kIdle,        ///< Nothing queued.
  kPending,     ///< Queued, waiting for connectivity or backoff.
  kSending,     ///< An attempt is in flight this cycle.
  kSucceeded,   ///< Last cycle delivered the event.
  kBuffered,    ///< Attempts exhausted; event retained for a later cycle.
};

/**
 * Store for events awaiting transmission.
 *
 * Deliberately an interface: the offline buffer will eventually be backed by
 * flash so a scan survives a power cut mid-upload. Everything above this
 * boundary already treats "not sent yet" as a normal state.
 *
 * TODO(offline): add an NVS/SPIFFS-backed implementation and persist across
 * reboots. See STRIDE_EVENT_QUEUE_DEPTH in config.h.
 */
class EventQueue {
 public:
  virtual ~EventQueue() {}

  /** Append a serialised event. Returns false if it could not be stored. */
  virtual bool enqueue(const String &payload) = 0;

  /** Copy the oldest event without removing it. False when empty. */
  virtual bool peek(String &payload) const = 0;

  /** Drop the oldest event. Call only after it is confirmed delivered. */
  virtual bool pop() = 0;

  virtual size_t size() const = 0;
  virtual size_t capacity() const = 0;

  /** Events discarded because the queue was full. A data-loss counter. */
  virtual uint32_t droppedCount() const = 0;

  bool empty() const { return size() == 0; }
};

/** RAM ring buffer. Contents are lost on reset - see the TODO above. */
class RamEventQueue : public EventQueue {
 public:
  RamEventQueue();

  bool enqueue(const String &payload) override;
  bool peek(String &payload) const override;
  bool pop() override;
  size_t size() const override { return count_; }
  size_t capacity() const override { return STRIDE_EVENT_QUEUE_DEPTH; }
  uint32_t droppedCount() const override { return dropped_; }

 private:
  String slots_[STRIDE_EVENT_QUEUE_DEPTH];
  size_t head_;
  size_t count_;
  uint32_t dropped_;
};

class ApiClient {
 public:
  ApiClient();

  /** Attach the buffer used for events that cannot be sent immediately. */
  void begin(EventQueue *queue);

  // --- Connectivity --------------------------------------------------------

  /**
   * Associate with the configured network, waiting at most timeoutMs.
   *
   * Association is started only once per attempt sequence, so this may be
   * called repeatedly with a short timeout to poll progress without blocking
   * the state machine - which is exactly what the CONNECTING state does.
   * Returns true as soon as the link is up.
   */
  bool connectWifi(uint32_t timeoutMs = STRIDE_WIFI_CONNECT_TIMEOUT_MS);

  /** Forget that association was started, so the next connectWifi() retries. */
  void resetConnection();

  bool isWifiConnected() const;

  /** RSSI in dBm, or 0 when disconnected. */
  int32_t signalStrength() const;

  /** Local IP as a string, or "0.0.0.0". */
  String localAddress() const;

  /** Kick off NTP and note whether the clock ever synced. */
  bool syncClock(uint32_t timeoutMs = STRIDE_NTP_SYNC_TIMEOUT_MS);

  bool clockSynced() const { return clockSynced_; }

  // --- Events --------------------------------------------------------------

  /**
   * Serialise a scan into the event envelope and hand it to the queue, then
   * start an upload cycle. Returns false only if the event could not be
   * stored at all - a network failure is not a failure of this call.
   *
   * customerId may be null: the customer is often not yet identified at scan
   * time, and the envelope carries null in that case.
   */
  bool sendEvent(const PressureFrame &frame, float weightKg,
                 const char *calibrationVersion, const char *customerId = nullptr);

  /** POST a device health event. Fire and forget; not queued on failure. */
  bool sendHealthCheck(const char *status, const char *calibrationVersion);

  /**
   * Drive connectivity, backoff and transmission. Call every loop iteration.
   * Performs at most one HTTP attempt per call.
   */
  void loop();

  UploadStatus uploadStatus() const { return status_; }

  /** Attempts made in the current or most recent cycle. */
  uint8_t attempts() const { return attempts_; }

  /** HTTP status of the last attempt, or a negative HTTPClient error code. */
  int lastHttpStatus() const { return lastHttpStatus_; }

  /** Human-readable outcome. Never contains credentials. */
  const char *lastError() const { return lastError_.c_str(); }

  size_t queueDepth() const { return queue_ != nullptr ? queue_->size() : 0; }

  /** Events lost because the buffer overflowed. Should stay at zero. */
  uint32_t droppedEvents() const {
    return queue_ != nullptr ? queue_->droppedCount() : 0;
  }

  /** Base URL only - the API key is never exposed. */
  const char *endpoint() const { return STRIDE_API_BASE_URL STRIDE_API_EVENTS_PATH; }

  /** True once the configuration still holds a placeholder credential. */
  static bool usingPlaceholderCredentials();

  /** ISO 8601 UTC timestamp for an epoch second. */
  static void formatTimestamp(time_t epochSeconds, char *out, size_t len);

  /** Random RFC 4122-shaped identifier for an event. */
  static void generateEventId(char *out, size_t len);

 private:
  /** Build the full event envelope for a scan. */
  String buildScanEvent(const PressureFrame &frame, float weightKg,
                        const char *calibrationVersion, const char *customerId);

  /** One POST attempt. Returns the HTTP status, or a negative error code. */
  int post(const char *path, const String &body);

  /** Milliseconds to wait before attempt number `attempt` (1-based). */
  static uint32_t backoffFor(uint8_t attempt);

  void startCycle();

  EventQueue *queue_;
  UploadStatus status_;
  uint8_t attempts_;
  uint32_t nextAttemptAtMs_;
  uint32_t cycleAbandonedAtMs_;
  uint32_t lastWifiAttemptMs_;
  int lastHttpStatus_;
  String lastError_;
  bool clockSynced_;
  bool associationStarted_;
};

#endif  // STRIDE_API_CLIENT_H
