/**
 * pressure_matrix.h - plantar pressure acquisition.
 *
 * Two layers, deliberately separated:
 *
 *   MuxBank       Knows about CD74HC4067 devices: how a logical line number
 *                 (row 0..24, column 0..24) maps onto a device and one of its
 *                 16 channels, and which pins to wiggle to select it. This is
 *                 the ONLY place multiplexer wiring is understood. Swapping
 *                 part numbers, adding a third device, or moving to per-device
 *                 select nibbles is a change to the tables in config.h plus,
 *                 at most, this class.
 *
 *   PressureMatrix  Knows about scanning: drive a row, sample every column,
 *                 apply calibration, accumulate frame statistics. It never
 *                 names a GPIO.
 *
 * The matrix is scanned row by row so a full frame can be spread across
 * several loop() iterations, keeping the state machine responsive.
 */

#ifndef STRIDE_PRESSURE_MATRIX_H
#define STRIDE_PRESSURE_MATRIX_H

#include <Arduino.h>
#include <time.h>

#include "calibration.h"
#include "config.h"

/** One CD74HC4067 (or equivalent) as described by config.h. */
struct MuxDevice {
  uint8_t selectPins[4];  ///< S0..S3.
  uint8_t enablePin;      ///< Active-low /E, or STRIDE_PIN_UNUSED.
  uint8_t signalPin;      ///< SIG (common) pin.
  uint8_t channelCount;   ///< Channels actually wired on this device.
};

/** How a bank's SIG pins are used. */
enum class MuxSignalMode {
  kDrive,  ///< SIG is a digital output (row bank energises one row).
  kSense,  ///< SIG is an analog input (column bank reads one column).
};

/**
 * An ordered group of mux devices presenting one flat line space.
 *
 * Line N is resolved by walking the device list and consuming each device's
 * channelCount, so a bank of {16, 9} exposes lines 0..24 with lines 16..24
 * landing on channels 0..8 of the second device.
 */
class MuxBank {
 public:
  MuxBank(const MuxDevice *devices, uint8_t deviceCount, MuxSignalMode mode);

  /** Configure every pin the bank owns. Idempotent. */
  bool begin();

  /** Total addressable lines across all devices in the bank. */
  uint16_t lineCount() const { return lineCount_; }

  /** Devices in this bank. Exposed for the boot diagnostic report. */
  uint8_t deviceCount() const { return deviceCount_; }

  /**
   * Point the bank at one logical line: sets the owning device's address,
   * enables it, and disables every other device so only one channel is live.
   * Returns false for an out-of-range line.
   */
  bool select(uint16_t line);

  /** Disable every device in the bank (all channels floating). */
  void disableAll();

  /** SIG pin serving the given line, or STRIDE_PIN_UNUSED if out of range. */
  uint8_t signalPinFor(uint16_t line) const;

 private:
  bool resolve(uint16_t line, uint8_t *deviceIndex, uint8_t *channel) const;
  void setEnabled(uint8_t deviceIndex, bool enabled);

  const MuxDevice *devices_;
  uint8_t deviceCount_;
  MuxSignalMode mode_;
  uint16_t lineCount_;
  bool begun_;
};

/**
 * One complete pressure capture.
 *
 * Values are calibrated ADC counts, row-major: index = row * COLUMNS + column.
 * They are intentionally not converted to kPa - the device ships counts plus a
 * calibration version, and the SaaS side owns interpretation.
 */
struct PressureFrame {
  uint16_t values[STRIDE_MATRIX_CELLS];

  uint32_t timestampMs;      ///< millis() when the scan started.
  time_t epochSeconds;       ///< Wall clock at scan start, 0 if unsynced.
  uint32_t scanDurationMs;   ///< Wall time to acquire the frame.

  uint16_t minValue;
  uint16_t maxValue;
  float averageValue;
  uint16_t activeSensorCount;  ///< Sensels above the active threshold.
  uint16_t saturatedCount;     ///< Sensels pinned at full scale.

  bool complete;  ///< Every row was acquired.
  bool valid;     ///< Passed validatePressureFrame().

  PressureFrame();
  void clear();

  uint16_t at(uint8_t row, uint8_t column) const;
  static constexpr uint16_t index(uint8_t row, uint8_t column) {
    return static_cast<uint16_t>(row) * STRIDE_MATRIX_COLUMNS + column;
  }
};

/** Result of validating a frame. */
struct FrameValidation {
  bool ok;
  const char *reason;  ///< Static string; "ok" when ok is true.
};

class PressureMatrix {
 public:
  explicit PressureMatrix(Calibration *calibration);

  /** Configure both mux banks and the ADC. Safe to call more than once. */
  bool initializePressureMatrix();

  bool initialized() const { return initialized_; }

  /**
   * Acquire a complete frame. Convenience wrapper around the incremental API;
   * takes roughly rows * (row settle + columns * sample time).
   */
  bool scanPressureMatrix(PressureFrame &out);

  // --- Incremental scanning (used by the state machine) --------------------

  /** Start a new frame. Clears the working frame and resets the row cursor. */
  void beginScan();

  /**
   * Acquire the next row. Returns true once the final row has been read, at
   * which point frame() holds a finished, validated frame.
   */
  bool scanStep();

  bool scanning() const { return scanning_; }

  const PressureFrame &frame() const { return frame_; }

  // --- Point access --------------------------------------------------------

  /**
   * Read a single calibrated sensel. Drives the row, samples the column and
   * releases the row - correct but slow; a full scan reuses one row drive
   * across all columns instead.
   */
  uint16_t readPressurePoint(uint8_t row, uint8_t column);

  /** Read a single sensel without applying the zero map. */
  uint16_t readRawPressurePoint(uint8_t row, uint8_t column);

  // --- Calibration ---------------------------------------------------------

  /**
   * Capture the unloaded baseline for every sensel into the calibration store.
   * Nothing may be resting on the mat. Does not persist - the caller decides
   * whether to save().
   */
  bool zeroPressureMatrix(uint8_t samples = STRIDE_PRESSURE_ZERO_SAMPLES);

  // --- Validation ----------------------------------------------------------

  /**
   * Cheap plausibility checks: enough loaded sensels to be a foot, not so many
   * that a row is shorted, a real peak, and no saturation blow-out. This is
   * validation, not interpretation - no fit logic runs on the device.
   */
  FrameValidation validatePressureFrame(const PressureFrame &frame) const;

  /** Human-readable bank summary for the boot report. */
  void describe(char *out, size_t len) const;

 private:
  void computeStatistics(PressureFrame &frame) const;
  void finishFrame();
  uint16_t sampleColumn(uint8_t column);
  bool driveRow(uint8_t row);
  void releaseRows();

#if SIMULATION_MODE
  /** Synthesise one sensel of a two-foot stance. */
  uint16_t simulatePoint(uint8_t row, uint8_t column) const;
  void beginSimulatedStance();

  float simCentreCol_[2];  ///< Column centre of each foot.
  float simRowOffset_;     ///< Fore/aft placement on the mat.
  float simLoadScale_;     ///< Overall load, tracks the simulated weight.
  bool simUnloaded_;       ///< Synthesise an empty mat (used when zeroing).
#endif

  Calibration *calibration_;
  MuxBank rowBank_;
  MuxBank columnBank_;
  PressureFrame frame_;

  uint8_t nextRow_;
  uint32_t scanStartedMs_;
  uint32_t scanStartedMicros_;
  bool scanning_;
  bool initialized_;
};

#endif  // STRIDE_PRESSURE_MATRIX_H
