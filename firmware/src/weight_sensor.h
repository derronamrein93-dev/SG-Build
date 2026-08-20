/**
 * weight_sensor.h - total body weight via an HX711 load cell interface.
 *
 * The driver reads counts and applies a scale. It does not assume how the
 * bridge is arranged: one cell, or four cells summed into a single Wheatstone
 * bridge feeding one HX711, both look the same from here. Changing that
 * arrangement changes the calibration factor in config.h/NVS, not this code.
 *
 * Only the pin numbers, gain and sample counts in config.h describe hardware.
 */

#ifndef STRIDE_WEIGHT_SENSOR_H
#define STRIDE_WEIGHT_SENSOR_H

#include <Arduino.h>

#include "calibration.h"
#include "config.h"

/** Outcome of a weight reading. */
struct WeightReading {
  float kilograms;
  long rawCounts;
  bool valid;          ///< Sensor responded and the value is in range.
  const char *reason;  ///< Static string; "ok" when valid.
};

class WeightSensor {
 public:
  explicit WeightSensor(Calibration *calibration);

  /** Bring up the HX711 and restore the stored scale/offset. */
  bool initializeWeightSensor();

  bool initialized() const { return initialized_; }

  /** True when the chip is asserting data-ready. Always true in simulation. */
  bool isReady();

  /** Capture the unloaded offset. Nothing may be on the platform. */
  bool tareWeightSensor(uint8_t samples = STRIDE_HX711_TARE_SAMPLES);

  /** Averaged raw counts, offset NOT removed. Returns 0 on timeout. */
  long readRawWeight(uint8_t samples = STRIDE_HX711_SAMPLES);

  /** Weight in kilograms, offset and factor applied. */
  float readWeightKg(uint8_t samples = STRIDE_HX711_SAMPLES);

  /** Weight plus range/health checks, for the scan path. */
  WeightReading readWeight(uint8_t samples = STRIDE_HX711_SAMPLES);

  /**
   * Derive counts-per-kilogram from a known mass resting on the platform.
   * Tare first with the platform empty, then call this with the reference
   * weight in place. Updates the calibration store; the caller decides whether
   * to persist it.
   */
  bool calibrateWeightSensor(float knownKilograms,
                             uint8_t samples = STRIDE_HX711_TARE_SAMPLES);

  /** One-line summary for the boot report. */
  void describe(char *out, size_t len) const;

  const char *lastError() const { return lastError_; }

 private:
#if SIMULATION_MODE
  /**
   * Plausible standing weight within the configured simulation limits, or the
   * mass currently forced by simOverrideKg_ (used so tare and calibrate behave
   * the way they do on hardware).
   */
  long simulateRawCounts();

  float simWeightKg_;
  float simOverrideKg_;  ///< < 0 means "draw a random standing weight".
#endif

  Calibration *calibration_;
  bool initialized_;
  const char *lastError_;
};

#endif  // STRIDE_WEIGHT_SENSOR_H
