/**
 * calibration.h - persistent hardware calibration for the Stride Guide device.
 *
 * Holds the two things that are true of one physical unit and nothing else:
 *   - the per-sensel unloaded zero map for the Velostat matrix, and
 *   - the load cell's counts-per-kilogram factor and tare offset.
 *
 * Stored in NVS so a unit keeps its calibration across reboots, and stamped
 * with a version string that travels with every event - a scan is only
 * interpretable if you know which calibration produced it.
 */

#ifndef STRIDE_CALIBRATION_H
#define STRIDE_CALIBRATION_H

#include <Arduino.h>

#include "config.h"

#define STRIDE_CAL_VERSION_LEN 24

/** Persisted calibration record. Written to NVS as a single blob. */
struct CalibrationData {
  uint16_t magic;                        ///< Record signature.
  uint16_t revision;                     ///< Bumped when this layout changes.
  char version[STRIDE_CAL_VERSION_LEN];  ///< Human-readable calibration id.

  // --- Pressure matrix ---
  uint16_t pressureZero[STRIDE_MATRIX_CELLS];  ///< Unloaded ADC counts/sensel.
  bool pressureZeroed;                         ///< Zero map has been captured.

  // --- Load cell ---
  float weightFactor;    ///< ADC counts per kilogram.
  long weightOffset;     ///< Raw counts with the platform unloaded.
  bool weightCalibrated; ///< Factor came from a known mass, not the default.
};

/**
 * Calibration store. Owns the record, its persistence and the corrections
 * derived from it. Sensor drivers ask this class for corrected values rather
 * than each keeping a private copy of the numbers.
 */
class Calibration {
 public:
  Calibration();

  /** Open NVS and load the stored record, or fall back to defaults. */
  bool begin();

  /** Reload from NVS. Returns false if no valid record exists. */
  bool load();

  /** Persist the current record. */
  bool save();

  /** Reset to compiled-in defaults. Does not persist until save(). */
  void reset();

  /** Erase the stored record from NVS. */
  bool erase();

  /** True when the active record came from storage rather than defaults. */
  bool loadedFromStorage() const { return loadedFromStorage_; }

  // --- Version -------------------------------------------------------------

  const char *version() const { return data_.version; }
  void setVersion(const char *version);

  /**
   * Derive a version string from what has actually been calibrated, e.g.
   * "p1-w1-20260820". Called after a successful zero or weight calibration.
   */
  void stampVersion();

  // --- Pressure ------------------------------------------------------------

  bool pressureZeroed() const { return data_.pressureZeroed; }

  /** Unloaded baseline for one sensel, in ADC counts. */
  uint16_t pressureZero(uint16_t index) const;

  void setPressureZero(uint16_t index, uint16_t counts);
  void setPressureZeroed(bool zeroed) { data_.pressureZeroed = zeroed; }

  /**
   * Apply the zero map to a raw reading. Clamps at zero so an unloaded sensel
   * reads 0 rather than drifting negative.
   */
  uint16_t correctPressure(uint16_t index, uint16_t raw) const;

  // --- Weight --------------------------------------------------------------

  bool weightCalibrated() const { return data_.weightCalibrated; }

  float weightFactor() const { return data_.weightFactor; }
  void setWeightFactor(float countsPerKg);

  long weightOffset() const { return data_.weightOffset; }
  void setWeightOffset(long counts);

  void setWeightCalibrated(bool calibrated) { data_.weightCalibrated = calibrated; }

  /** Convert raw HX711 counts to kilograms using the stored factor/offset. */
  float countsToKg(long raw) const;

  // --- Diagnostics ---------------------------------------------------------

  /** One-line summary for the boot report. Never contains secrets. */
  void describe(char *out, size_t len) const;

  const CalibrationData &data() const { return data_; }

 private:
  CalibrationData data_;
  bool loadedFromStorage_;
};

#endif  // STRIDE_CALIBRATION_H
