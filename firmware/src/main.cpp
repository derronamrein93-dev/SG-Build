/**
 * main.cpp - Stride Guide device firmware entry point.
 *
 * A small, explicit state machine drives the device:
 *
 *   BOOT -> SELF_TEST -> CONNECTING -> READY -> SCANNING -> UPLOADING -> READY
 *                            |                      |           |
 *                            +--------- ERROR <-----+-----------+
 *
 * Every state handler returns promptly. Nothing here waits in a long blocking
 * loop: a pressure scan is acquired one row per iteration, uploads are driven
 * by ApiClient::loop(), and Wi-Fi association is polled in short slices. That
 * keeps the serial console responsive and the Wi-Fi stack fed while a scan is
 * in flight.
 *
 * What the device does NOT do: interpret a scan. No fit logic, no shoe
 * recommendation, no customer matching. It measures, validates, identifies
 * itself, and ships a versioned event. Everything else is server side.
 */

#include <Arduino.h>

#include "api_client.h"
#include "calibration.h"
#include "config.h"
#include "pressure_matrix.h"
#include "weight_sensor.h"

// ===========================================================================
// State machine
// ===========================================================================

enum class DeviceState {
  kBoot,
  kSelfTest,
  kConnecting,
  kReady,
  kScanning,
  kUploading,
  kError,
};

namespace {

const char *stateName(DeviceState state) {
  switch (state) {
    case DeviceState::kBoot:       return "BOOT";
    case DeviceState::kSelfTest:   return "SELF_TEST";
    case DeviceState::kConnecting: return "CONNECTING";
    case DeviceState::kReady:      return "READY";
    case DeviceState::kScanning:   return "SCANNING";
    case DeviceState::kUploading:  return "UPLOADING";
    case DeviceState::kError:      return "ERROR";
  }
  return "UNKNOWN";
}

// --- Device singletons -----------------------------------------------------

Calibration gCalibration;
PressureMatrix gMatrix(&gCalibration);
WeightSensor gWeightSensor(&gCalibration);
RamEventQueue gEventQueue;
ApiClient gApi;

// --- State -----------------------------------------------------------------

DeviceState gState = DeviceState::kBoot;
uint32_t gStateEnteredMs = 0;
const char *gErrorReason = "";

uint32_t gLastScanFinishedMs = 0;
uint32_t gLastHealthCheckMs = 0;
uint32_t gLastLedToggleMs = 0;
bool gLedOn = false;

/** Measurement captured by the current scan, carried into UPLOADING. */
float gScanWeightKg = 0.0f;
bool gScanWeightValid = false;
bool gUploadAccepted = false;

/** Serial console line buffer. */
char gSerialLine[64];
uint8_t gSerialLineLength = 0;

/** Scan-button debounce. */
bool gButtonWasPressed = false;
uint32_t gButtonChangedMs = 0;

// ===========================================================================
// Helpers
// ===========================================================================

void setLed(bool on) {
  if (STRIDE_PIN_STATUS_LED == STRIDE_PIN_UNUSED) {
    return;
  }
  gLedOn = on;
  digitalWrite(STRIDE_PIN_STATUS_LED,
               (on == STRIDE_STATUS_LED_ACTIVE_HIGH) ? HIGH : LOW);
}

/** Blink cadence per state: slow = idle, fast = busy, very fast = error. */
void updateLed() {
  if (STRIDE_PIN_STATUS_LED == STRIDE_PIN_UNUSED) {
    return;
  }

  uint32_t periodMs = 0;
  switch (gState) {
    case DeviceState::kReady:      periodMs = 1500; break;
    case DeviceState::kConnecting: periodMs = 400;  break;
    case DeviceState::kScanning:
    case DeviceState::kUploading:  periodMs = 150;  break;
    case DeviceState::kError:      periodMs = 100;  break;
    default:                       periodMs = 800;  break;
  }

  if (millis() - gLastLedToggleMs >= periodMs) {
    gLastLedToggleMs = millis();
    setLed(!gLedOn);
  }
}

void transitionTo(DeviceState next) {
  if (next == gState) {
    return;
  }
  Serial.printf("[state] %s -> %s\n", stateName(gState), stateName(next));
  gState = next;
  gStateEnteredMs = millis();
}

void enterError(const char *reason) {
  gErrorReason = reason;
  Serial.printf("[error] %s\n", reason);
  transitionTo(DeviceState::kError);
}

// ===========================================================================
// Boot diagnostic report
// ===========================================================================

void printBootReport() {
  char buffer[160];

  Serial.println();
  Serial.println(F("========================================"));
  Serial.println(F("Stride Guide Device"));
  Serial.println(F("========================================"));

  Serial.printf("Firmware:        %s (schema %s, hardware %s)\n", FIRMWARE_VERSION,
                SCHEMA_VERSION, HARDWARE_REVISION);
  Serial.printf("Device ID:       %s (serial %s)\n", DEVICE_ID, DEVICE_SERIAL);
  Serial.printf("Simulation Mode: %s\n",
                SIMULATION_MODE ? "ON - synthetic sensor data, no hardware required"
                                : "OFF - real sensor acquisition");

  gMatrix.describe(buffer, sizeof(buffer));
  Serial.printf("Pressure Matrix: %s\n", buffer);

  gWeightSensor.describe(buffer, sizeof(buffer));
  Serial.printf("HX711:           %s\n", buffer);

  // SSID is printed as an operational aid. The password and API key are not,
  // and must never be.
  Serial.printf("Wi-Fi:           %s (%s)\n", STRIDE_WIFI_SSID,
                gApi.isWifiConnected() ? gApi.localAddress().c_str()
                                       : "not connected");
  Serial.printf("API:             POST %s\n", gApi.endpoint());

  gCalibration.describe(buffer, sizeof(buffer));
  Serial.printf("Calibration:     %s\n", buffer);
  Serial.printf("Tenancy:         org=%s location=%s\n", STRIDE_ORGANIZATION_ID,
                STRIDE_LOCATION_ID);

  if (ApiClient::usingPlaceholderCredentials()) {
    Serial.println(F("WARNING:         placeholder credentials in use - copy "
                     "src/secrets.example.h to src/secrets.h before deploying"));
  }

  Serial.println(F("========================================"));
  Serial.println(F("Commands: s=scan  z=zero matrix  t=tare  c<kg>=calibrate "
                   "weight  w=save cal  h=health  i=info  r=reset cal"));
  Serial.println();
}

// ===========================================================================
// Scan lifecycle
// ===========================================================================

bool scanAllowed() {
  return gState == DeviceState::kReady &&
         millis() - gLastScanFinishedMs >= STRIDE_SCAN_COOLDOWN_MS;
}

void startScan() {
  Serial.println();
  Serial.println(F("Scan started"));

  // Weight first: the customer is already standing still, and the load cell
  // reading is what tells us the mat is genuinely loaded.
  const WeightReading weight = gWeightSensor.readWeight();
  gScanWeightKg = weight.kilograms;
  gScanWeightValid = weight.valid;

  Serial.printf("Weight: %.2f kg%s\n", static_cast<double>(weight.kilograms),
                weight.valid ? "" : "  <-- rejected");
  if (!weight.valid) {
    Serial.printf("        %s\n", weight.reason);
  }

  gMatrix.beginScan();
  transitionTo(DeviceState::kScanning);
}

void finishScan() {
  const PressureFrame &frame = gMatrix.frame();
  const FrameValidation validation = gMatrix.validatePressureFrame(frame);

  Serial.printf("Active sensors: %u / %u\n",
                static_cast<unsigned>(frame.activeSensorCount),
                static_cast<unsigned>(STRIDE_MATRIX_CELLS));
  Serial.printf("Pressure min/max: %u / %u (avg %.1f, %u saturated)\n",
                static_cast<unsigned>(frame.minValue),
                static_cast<unsigned>(frame.maxValue),
                static_cast<double>(frame.averageValue),
                static_cast<unsigned>(frame.saturatedCount));
  Serial.printf("Scan duration: %u ms\n",
                static_cast<unsigned>(frame.scanDurationMs));

  if (!validation.ok) {
    Serial.printf("Frame rejected: %s\n", validation.reason);
  }

  // A frame that fails validation is still transmitted, flagged invalid in its
  // metadata. Throwing away a scan the customer already stood for loses the
  // only evidence of what the hardware actually did.
  gUploadAccepted = gApi.sendEvent(frame, gScanWeightKg, gCalibration.version());

  if (!gUploadAccepted) {
    Serial.printf("Upload status: NOT QUEUED - %s\n", gApi.lastError());
    Serial.println(F("Scan complete"));
    gLastScanFinishedMs = millis();
    transitionTo(DeviceState::kReady);
    return;
  }

  transitionTo(DeviceState::kUploading);
}

void reportUploadOutcome() {
  switch (gApi.uploadStatus()) {
    case UploadStatus::kSucceeded:
      Serial.printf("Upload status: OK (HTTP %d)\n", gApi.lastHttpStatus());
      break;
    case UploadStatus::kBuffered:
      Serial.printf("Upload status: FAILED - %s\n", gApi.lastError());
      Serial.printf("               scan retained in the offline buffer "
                    "(%u queued, %u dropped); it will be retried\n",
                    static_cast<unsigned>(gApi.queueDepth()),
                    static_cast<unsigned>(gApi.droppedEvents()));
      break;
    default:
      Serial.printf("Upload status: %s\n", gApi.lastError());
      break;
  }

  Serial.println(F("Scan complete"));
  Serial.println();
  gLastScanFinishedMs = millis();
}

// ===========================================================================
// Serial console
// ===========================================================================

void printInfo() {
  char buffer[160];
  Serial.printf("[info] state=%s uptime=%lus heap=%u\n", stateName(gState),
                static_cast<unsigned long>(millis() / 1000),
                static_cast<unsigned>(ESP.getFreeHeap()));
  Serial.printf("[info] wifi=%s rssi=%ld clock=%s\n",
                gApi.isWifiConnected() ? gApi.localAddress().c_str() : "down",
                static_cast<long>(gApi.signalStrength()),
                gApi.clockSynced() ? "synced" : "unsynced");
  Serial.printf("[info] queue=%u/%u dropped=%u last=%s\n",
                static_cast<unsigned>(gApi.queueDepth()),
                static_cast<unsigned>(STRIDE_EVENT_QUEUE_DEPTH),
                static_cast<unsigned>(gApi.droppedEvents()), gApi.lastError());
  gCalibration.describe(buffer, sizeof(buffer));
  Serial.printf("[info] calibration %s\n", buffer);
}

void handleCommand(const char *line) {
  if (line[0] == '\0') {
    return;
  }

  switch (line[0]) {
    case 's':
      if (scanAllowed()) {
        startScan();
      } else {
        Serial.printf("[cmd] scan unavailable in %s\n", stateName(gState));
      }
      break;

    case 'z':
      Serial.println(F("[cmd] zeroing pressure matrix - the mat must be empty"));
      if (gMatrix.zeroPressureMatrix()) {
        Serial.printf("[cmd] zero map captured, calibration now %s "
                      "(press 'w' to persist)\n",
                      gCalibration.version());
      } else {
        Serial.println(F("[cmd] zeroing failed"));
      }
      break;

    case 't':
      Serial.println(F("[cmd] taring load cell - the platform must be empty"));
      if (gWeightSensor.tareWeightSensor()) {
        Serial.printf("[cmd] tare offset now %ld (press 'w' to persist)\n",
                      gCalibration.weightOffset());
      } else {
        Serial.printf("[cmd] tare failed: %s\n", gWeightSensor.lastError());
      }
      break;

    case 'c': {
      const float knownKg = atof(line + 1);
      if (!(knownKg > 0.0f)) {
        Serial.println(F("[cmd] usage: c<kg>, e.g. c20 with a 20 kg mass on the "
                         "platform (tare with 't' first)"));
        break;
      }
      Serial.printf("[cmd] calibrating against %.2f kg\n",
                    static_cast<double>(knownKg));
      if (gWeightSensor.calibrateWeightSensor(knownKg)) {
        Serial.printf("[cmd] factor now %.1f counts/kg, calibration %s "
                      "(press 'w' to persist)\n",
                      static_cast<double>(gCalibration.weightFactor()),
                      gCalibration.version());
      } else {
        Serial.printf("[cmd] calibration failed: %s\n", gWeightSensor.lastError());
      }
      break;
    }

    case 'w':
      Serial.println(gCalibration.save() ? F("[cmd] calibration saved to NVS")
                                         : F("[cmd] calibration save FAILED"));
      break;

    case 'r':
      Serial.println(gCalibration.erase() ? F("[cmd] calibration erased")
                                          : F("[cmd] calibration erase FAILED"));
      break;

    case 'h':
      Serial.println(gApi.sendHealthCheck("manual", gCalibration.version())
                         ? F("[cmd] health check sent")
                         : F("[cmd] health check failed"));
      break;

    case 'i':
      printInfo();
      break;

    default:
      Serial.printf("[cmd] unknown command '%c'\n", line[0]);
      break;
  }
}

void pollSerial() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\r') {
      continue;
    }
    if (c == '\n') {
      gSerialLine[gSerialLineLength] = '\0';
      handleCommand(gSerialLine);
      gSerialLineLength = 0;
      continue;
    }
    if (gSerialLineLength < sizeof(gSerialLine) - 1) {
      gSerialLine[gSerialLineLength++] = c;
    }
  }
}

void pollButton() {
  if (STRIDE_PIN_SCAN_BUTTON == STRIDE_PIN_UNUSED) {
    return;
  }

  const bool pressed = digitalRead(STRIDE_PIN_SCAN_BUTTON) == LOW;
  if (pressed == gButtonWasPressed) {
    return;
  }
  if (millis() - gButtonChangedMs < STRIDE_BUTTON_DEBOUNCE_MS) {
    return;
  }

  gButtonChangedMs = millis();
  gButtonWasPressed = pressed;

  if (pressed && scanAllowed()) {
    startScan();
  }
}

// ===========================================================================
// State handlers
// ===========================================================================

void handleBoot() {
  gCalibration.begin();
  gApi.begin(&gEventQueue);
  transitionTo(DeviceState::kSelfTest);
}

void handleSelfTest() {
  const bool matrixOk = gMatrix.initializePressureMatrix();
  const bool weightOk = gWeightSensor.initializeWeightSensor();

  printBootReport();

  if (!matrixOk) {
    enterError("pressure matrix self test failed - check the mux tables in config.h");
    return;
  }

  if (!weightOk) {
    // A dead load cell is not a reason to refuse to boot: pressure scans are
    // still useful, and a technician needs the console to diagnose it.
    Serial.printf("[warn] weight sensor unavailable: %s\n",
                  gWeightSensor.lastError());
  }

  if (!gCalibration.pressureZeroed()) {
    Serial.println(F("[warn] pressure matrix has no zero map - run 'z' on an "
                     "empty mat, then 'w' to persist"));
  }
  if (!gCalibration.weightCalibrated()) {
    Serial.println(F("[warn] load cell is using the default scale factor - run "
                     "'t' then 'c<kg>', then 'w' to persist"));
  }

  transitionTo(DeviceState::kConnecting);
}

void handleConnecting() {
  // Polled in short slices so the console stays responsive while associating.
  if (gApi.connectWifi(250)) {
    Serial.printf("[wifi] connected, %s (RSSI %ld dBm)\n",
                  gApi.localAddress().c_str(),
                  static_cast<long>(gApi.signalStrength()));

    if (gApi.syncClock()) {
      Serial.println(F("[time] clock synced via NTP"));
    } else {
      Serial.println(F("[time] NTP sync failed - events will carry an unsynced "
                       "timestamp and metadata.clock_synced=false"));
    }

    gApi.sendHealthCheck("boot", gCalibration.version());
    gLastHealthCheckMs = millis();
    transitionTo(DeviceState::kReady);
    return;
  }

  if (millis() - gStateEnteredMs < STRIDE_WIFI_CONNECT_TIMEOUT_MS) {
    return;
  }

  // Offline is a working state, not an error: scans are buffered and uploaded
  // when the link returns. ApiClient::loop() keeps retrying association.
  Serial.printf("[wifi] not connected (%s) - continuing offline, scans will be "
                "buffered\n",
                gApi.lastError());
  gApi.resetConnection();
  transitionTo(DeviceState::kReady);
}

void handleReady() {
  if (STRIDE_HEALTH_INTERVAL_MS > 0 && gApi.isWifiConnected() &&
      millis() - gLastHealthCheckMs >= STRIDE_HEALTH_INTERVAL_MS) {
    gLastHealthCheckMs = millis();
    gApi.sendHealthCheck("heartbeat", gCalibration.version());
  }

#if SIMULATION_MODE && STRIDE_SIM_AUTO_SCAN_INTERVAL_MS > 0
  if (millis() - gLastScanFinishedMs >= STRIDE_SIM_AUTO_SCAN_INTERVAL_MS) {
    Serial.println(F("[sim] auto-scan triggered"));
    startScan();
  }
#endif
}

void handleScanning() {
  // One row per iteration: the frame is acquired across several loop passes so
  // nothing else is starved while a scan is running.
  if (gMatrix.scanStep()) {
    finishScan();
  }
}

void handleUploading() {
  // Offline is not something to wait out: the event is already safe in the
  // buffer and ApiClient::loop() will drain it when the link returns.
  if (!gApi.isWifiConnected()) {
    Serial.printf("Upload status: DEFERRED - no Wi-Fi, scan buffered "
                  "(%u queued, %u dropped)\n",
                  static_cast<unsigned>(gApi.queueDepth()),
                  static_cast<unsigned>(gApi.droppedEvents()));
    Serial.println(F("Scan complete"));
    Serial.println();
    gLastScanFinishedMs = millis();
    transitionTo(DeviceState::kReady);
    return;
  }

  switch (gApi.uploadStatus()) {
    case UploadStatus::kSucceeded:
    case UploadStatus::kBuffered:
    case UploadStatus::kIdle:
      reportUploadOutcome();
      transitionTo(DeviceState::kReady);
      break;
    default:
      // kPending / kSending: ApiClient::loop() is working on it. Bail out to
      // READY if a cycle somehow stalls, so the device never wedges here.
      if (millis() - gStateEnteredMs >
          STRIDE_HTTP_MAX_ATTEMPTS * (STRIDE_HTTP_TIMEOUT_MS + STRIDE_HTTP_BACKOFF_MAX_MS)) {
        Serial.println(F("Upload status: still in progress - continuing in the "
                         "background"));
        Serial.println(F("Scan complete"));
        gLastScanFinishedMs = millis();
        transitionTo(DeviceState::kReady);
      }
      break;
  }
}

void handleError() {
  if (millis() - gStateEnteredMs < STRIDE_ERROR_RETRY_MS) {
    return;
  }
  Serial.printf("[error] retrying self test after: %s\n", gErrorReason);
  transitionTo(DeviceState::kSelfTest);
}

}  // namespace

// ===========================================================================
// Arduino entry points
// ===========================================================================

void setup() {
  Serial.begin(STRIDE_SERIAL_BAUD);
  delay(STRIDE_SERIAL_BOOT_DELAY_MS);

  if (STRIDE_PIN_STATUS_LED != STRIDE_PIN_UNUSED) {
    pinMode(STRIDE_PIN_STATUS_LED, OUTPUT);
    setLed(false);
  }
  if (STRIDE_PIN_SCAN_BUTTON != STRIDE_PIN_UNUSED) {
    pinMode(STRIDE_PIN_SCAN_BUTTON, INPUT_PULLUP);
  }

  randomSeed(esp_random());

  gState = DeviceState::kBoot;
  gStateEnteredMs = millis();
}

void loop() {
  pollSerial();
  pollButton();
  updateLed();

  // Network work is driven every iteration, including during a scan, so a
  // buffered event drains as soon as the link allows.
  gApi.loop();

  switch (gState) {
    case DeviceState::kBoot:       handleBoot();       break;
    case DeviceState::kSelfTest:   handleSelfTest();   break;
    case DeviceState::kConnecting: handleConnecting(); break;
    case DeviceState::kReady:      handleReady();      break;
    case DeviceState::kScanning:   handleScanning();   break;
    case DeviceState::kUploading:  handleUploading();  break;
    case DeviceState::kError:      handleError();      break;
  }
}

// ===========================================================================
// Outstanding work - see also the TODO markers in config.h and the drivers
// ===========================================================================
//
// TODO(pcb):     replace the bring-up GPIO map in config.h section 5 and 8
//                with the production Stride Guide PCB assignment.
// TODO(calibration): characterise Velostat response (non-linearity, creep,
//                temperature) and replace the single active threshold with a
//                per-unit curve; measure and correct matrix crosstalk.
// TODO(calibration): capture the HX711 counts-per-kg factor per unit during
//                manufacture and write it to NVS at provisioning time.
// TODO(auth):    per-device credentials and signed events; certificate
//                pinning for the API host. No static bearer token in
//                production.
// TODO(offline): persist the event queue to flash so a buffered scan survives
//                a power cycle, and size it for a full retail day.
// TODO(ota):     signed over-the-air firmware updates with rollback, reporting
//                the running version through the health event.
