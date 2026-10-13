/*
 * Stride Guide ESP32-S3 bring-up firmware v0.1.0
 *
 * IMPORTANT: This is a NON-MEASURING hardware bring-up sketch.
 * The PCB pin map, matrix scan topology and HX711 wiring have not been
 * verified. Do NOT fabricate sensor frames or mark this device "ready".
 *
 * Arduino IDE: select the actual ESP32-S3 board, enable "USB CDC On Boot",
 * select the correct USB port, upload, then open Serial Monitor at 115200.
 *
 * Emits one newline-delimited sg.v1 JSON status frame every 5 seconds.
 * Serial commands: PING or STATUS (one line each). No network commands.
 */
#include <Arduino.h>

static constexpr uint32_t BAUD_RATE = 115200;
static constexpr uint32_t HEARTBEAT_INTERVAL_MS = 5000;
static constexpr size_t MAX_COMMAND_LENGTH = 48;
static const char* FIRMWARE_VERSION = "0.1.0";
static const char* DEVICE_SERIAL = "SG-UNPROVISIONED";
static const char* HARDWARE_REVISION = "pending";
static const char* CALIBRATION_VERSION = "none";

static uint32_t sequenceNumber = 0;
static uint32_t lastHeartbeatMs = 0;
static char commandBuffer[MAX_COMMAND_LENGTH + 1] = {0};
static size_t commandLength = 0;

void emitStatus() {
  // This is deliberately "unconfigured", never "ready".
  Serial.printf(
    "{\"protocol\":\"sg.v1\",\"kind\":\"status\","
    "\"device_serial\":\"%s\",\"sequence\":%lu,\"uptime_ms\":%lu,"
    "\"firmware_version\":\"%s\",\"hardware_revision\":\"%s\","
    "\"calibration_version\":\"%s\",\"state\":\"unconfigured\","
    "\"error_code\":null}\n",
    DEVICE_SERIAL, static_cast<unsigned long>(sequenceNumber++),
    static_cast<unsigned long>(millis()), FIRMWARE_VERSION,
    HARDWARE_REVISION, CALIBRATION_VERSION);
}

void handleCommand(const char* command) {
  if (strcmp(command, "PING") == 0 || strcmp(command, "STATUS") == 0) {
    emitStatus();
  }
  // Unknown commands are ignored; never echo arbitrary input or customer data.
}

void setup() {
  Serial.begin(BAUD_RATE);
  // Do not wait forever for a serial monitor: a deployed controller must boot.
  delay(300);
  emitStatus();
  lastHeartbeatMs = millis();
}

void loop() {
  const uint32_t now = millis();
  if (static_cast<uint32_t>(now - lastHeartbeatMs) >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatMs = now;
    emitStatus();
  }
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n' || c == '\r') {
      if (commandLength > 0) {
        commandBuffer[commandLength] = '\0';
        handleCommand(commandBuffer);
        commandLength = 0;
      }
    } else if (commandLength < MAX_COMMAND_LENGTH) {
      commandBuffer[commandLength++] = c;
    } else {
      // Discard overlong command. Never execute a truncated command.
      commandLength = 0;
      while (Serial.available() > 0) Serial.read();
    }
  }
}
