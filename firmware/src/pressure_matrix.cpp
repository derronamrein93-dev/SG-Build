#include "pressure_matrix.h"

#include <math.h>

namespace {

/**
 * Build the runtime device tables from the config.h pin tables.
 *
 * Done in a loop rather than a hand-written initialiser so that changing
 * STRIDE_ROW_MUX_COUNT (adding a third mux, dropping to one) needs no edit
 * here. Function-local statics guarantee the tables exist before the first
 * MuxBank is constructed.
 */
const MuxDevice *rowDeviceTable() {
  static MuxDevice devices[STRIDE_ROW_MUX_COUNT];
  static bool built = false;
  if (!built) {
    for (uint8_t i = 0; i < STRIDE_ROW_MUX_COUNT; ++i) {
      for (uint8_t s = 0; s < 4; ++s) {
        devices[i].selectPins[s] = STRIDE_ROW_MUX_SELECT_PINS[i][s];
      }
      devices[i].enablePin = STRIDE_ROW_MUX_ENABLE_PINS[i];
      devices[i].signalPin = STRIDE_ROW_MUX_SIGNAL_PINS[i];
      devices[i].channelCount = STRIDE_ROW_MUX_CHANNELS[i];
    }
    built = true;
  }
  return devices;
}

const MuxDevice *columnDeviceTable() {
  static MuxDevice devices[STRIDE_COL_MUX_COUNT];
  static bool built = false;
  if (!built) {
    for (uint8_t i = 0; i < STRIDE_COL_MUX_COUNT; ++i) {
      for (uint8_t s = 0; s < 4; ++s) {
        devices[i].selectPins[s] = STRIDE_COL_MUX_SELECT_PINS[i][s];
      }
      devices[i].enablePin = STRIDE_COL_MUX_ENABLE_PINS[i];
      devices[i].signalPin = STRIDE_COL_MUX_SIGNAL_PINS[i];
      devices[i].channelCount = STRIDE_COL_MUX_CHANNELS[i];
    }
    built = true;
  }
  return devices;
}

#if SIMULATION_MODE
/** Unit-height Gaussian contact blob. */
float blob(float row, float column, float centreRow, float centreCol,
           float sigma, float weight) {
  const float dr = row - centreRow;
  const float dc = column - centreCol;
  const float d2 = dr * dr + dc * dc;
  return weight * expf(-d2 / (2.0f * sigma * sigma));
}

float randomUnit() { return static_cast<float>(random(0, 10001)) / 10000.0f; }
#endif

}  // namespace

// ===========================================================================
// MuxBank
// ===========================================================================

MuxBank::MuxBank(const MuxDevice *devices, uint8_t deviceCount, MuxSignalMode mode)
    : devices_(devices),
      deviceCount_(deviceCount),
      mode_(mode),
      lineCount_(0),
      begun_(false) {
  for (uint8_t i = 0; i < deviceCount_; ++i) {
    lineCount_ = static_cast<uint16_t>(lineCount_ + devices_[i].channelCount);
  }
}

bool MuxBank::begin() {
  for (uint8_t i = 0; i < deviceCount_; ++i) {
    const MuxDevice &device = devices_[i];

    for (uint8_t s = 0; s < 4; ++s) {
      if (device.selectPins[s] == STRIDE_PIN_UNUSED) {
        continue;
      }
      pinMode(device.selectPins[s], OUTPUT);
      digitalWrite(device.selectPins[s], LOW);
    }

    if (device.enablePin != STRIDE_PIN_UNUSED) {
      pinMode(device.enablePin, OUTPUT);
      digitalWrite(device.enablePin, HIGH);  // /E high = device disabled
    }

    if (device.signalPin == STRIDE_PIN_UNUSED) {
      continue;
    }

    if (mode_ == MuxSignalMode::kDrive) {
      pinMode(device.signalPin, OUTPUT);
      digitalWrite(device.signalPin, STRIDE_ROW_DRIVE_ACTIVE_HIGH ? LOW : HIGH);
    } else {
      pinMode(device.signalPin, INPUT);
      analogSetPinAttenuation(device.signalPin, STRIDE_ADC_ATTENUATION);
    }
  }

  begun_ = true;
  return lineCount_ > 0;
}

bool MuxBank::resolve(uint16_t line, uint8_t *deviceIndex, uint8_t *channel) const {
  uint16_t remaining = line;
  for (uint8_t i = 0; i < deviceCount_; ++i) {
    if (remaining < devices_[i].channelCount) {
      *deviceIndex = i;
      *channel = static_cast<uint8_t>(remaining);
      return true;
    }
    remaining = static_cast<uint16_t>(remaining - devices_[i].channelCount);
  }
  return false;
}

void MuxBank::setEnabled(uint8_t deviceIndex, bool enabled) {
  const uint8_t pin = devices_[deviceIndex].enablePin;
  if (pin == STRIDE_PIN_UNUSED) {
    // /E strapped to ground on this board revision: permanently enabled.
    return;
  }
  digitalWrite(pin, enabled ? LOW : HIGH);  // /E is active low
}

void MuxBank::disableAll() {
  for (uint8_t i = 0; i < deviceCount_; ++i) {
    setEnabled(i, false);
  }
}

bool MuxBank::select(uint16_t line) {
  uint8_t deviceIndex = 0;
  uint8_t channel = 0;
  if (!resolve(line, &deviceIndex, &channel)) {
    return false;
  }

  // Disable first: select pins are typically shared across the bank, so
  // writing the address while a device is live would briefly connect the
  // wrong channel.
  disableAll();

  const MuxDevice &device = devices_[deviceIndex];
  for (uint8_t s = 0; s < 4; ++s) {
    if (device.selectPins[s] == STRIDE_PIN_UNUSED) {
      continue;
    }
    digitalWrite(device.selectPins[s], (channel >> s) & 0x01 ? HIGH : LOW);
  }

  setEnabled(deviceIndex, true);
  return true;
}

uint8_t MuxBank::signalPinFor(uint16_t line) const {
  uint8_t deviceIndex = 0;
  uint8_t channel = 0;
  if (!resolve(line, &deviceIndex, &channel)) {
    return STRIDE_PIN_UNUSED;
  }
  return devices_[deviceIndex].signalPin;
}

// ===========================================================================
// PressureFrame
// ===========================================================================

PressureFrame::PressureFrame() { clear(); }

void PressureFrame::clear() {
  memset(values, 0, sizeof(values));
  timestampMs = 0;
  epochSeconds = 0;
  scanDurationMs = 0;
  minValue = 0;
  maxValue = 0;
  averageValue = 0.0f;
  activeSensorCount = 0;
  saturatedCount = 0;
  complete = false;
  valid = false;
}

uint16_t PressureFrame::at(uint8_t row, uint8_t column) const {
  if (row >= STRIDE_MATRIX_ROWS || column >= STRIDE_MATRIX_COLUMNS) {
    return 0;
  }
  return values[index(row, column)];
}

// ===========================================================================
// PressureMatrix
// ===========================================================================

PressureMatrix::PressureMatrix(Calibration *calibration)
    : calibration_(calibration),
      rowBank_(rowDeviceTable(), STRIDE_ROW_MUX_COUNT, MuxSignalMode::kDrive),
      columnBank_(columnDeviceTable(), STRIDE_COL_MUX_COUNT, MuxSignalMode::kSense),
      nextRow_(0),
      scanStartedMs_(0),
      scanStartedMicros_(0),
      scanning_(false),
      initialized_(false) {
#if SIMULATION_MODE
  simCentreCol_[0] = STRIDE_MATRIX_COLUMNS * 0.30f;
  simCentreCol_[1] = STRIDE_MATRIX_COLUMNS * 0.70f;
  simRowOffset_ = 0.0f;
  simLoadScale_ = 1.0f;
  simUnloaded_ = false;
#endif
}

bool PressureMatrix::initializePressureMatrix() {
  analogReadResolution(STRIDE_ADC_RESOLUTION_BITS);

  const bool rowsOk = rowBank_.begin();
  const bool columnsOk = columnBank_.begin();

  rowBank_.disableAll();
  columnBank_.disableAll();

  // The banks must be able to address every row and column the geometry
  // declares. If they cannot, config.h and the hardware disagree.
  const bool enoughRows = rowBank_.lineCount() >= STRIDE_MATRIX_ROWS;
  const bool enoughColumns = columnBank_.lineCount() >= STRIDE_MATRIX_COLUMNS;

  initialized_ = rowsOk && columnsOk && enoughRows && enoughColumns;
  frame_.clear();
  scanning_ = false;
  nextRow_ = 0;
  return initialized_;
}

void PressureMatrix::describe(char *out, size_t len) const {
  if (out == nullptr || len == 0) {
    return;
  }
  snprintf(out, len, "%dx%d (%d cells), row mux x%u (%u lines), col mux x%u (%u lines)",
           STRIDE_MATRIX_ROWS, STRIDE_MATRIX_COLUMNS, STRIDE_MATRIX_CELLS,
           static_cast<unsigned>(rowBank_.deviceCount()),
           static_cast<unsigned>(rowBank_.lineCount()),
           static_cast<unsigned>(columnBank_.deviceCount()),
           static_cast<unsigned>(columnBank_.lineCount()));
}

// --- Row drive / column sense ---------------------------------------------

bool PressureMatrix::driveRow(uint8_t row) {
#if SIMULATION_MODE
  (void)row;
  return true;
#else
  if (!rowBank_.select(row)) {
    return false;
  }
  const uint8_t signalPin = rowBank_.signalPinFor(row);
  if (signalPin == STRIDE_PIN_UNUSED) {
    return false;
  }
  digitalWrite(signalPin, STRIDE_ROW_DRIVE_ACTIVE_HIGH ? HIGH : LOW);
  delayMicroseconds(STRIDE_ROW_SETTLE_US);
  return true;
#endif
}

void PressureMatrix::releaseRows() {
#if !SIMULATION_MODE
  for (uint16_t row = 0; row < rowBank_.lineCount(); ++row) {
    const uint8_t signalPin = rowBank_.signalPinFor(row);
    if (signalPin != STRIDE_PIN_UNUSED) {
      digitalWrite(signalPin, STRIDE_ROW_DRIVE_ACTIVE_HIGH ? LOW : HIGH);
    }
  }
  rowBank_.disableAll();
#endif
}

uint16_t PressureMatrix::sampleColumn(uint8_t column) {
#if SIMULATION_MODE
  (void)column;
  return 0;
#else
  if (!columnBank_.select(column)) {
    return 0;
  }
  const uint8_t signalPin = columnBank_.signalPinFor(column);
  if (signalPin == STRIDE_PIN_UNUSED) {
    return 0;
  }

  delayMicroseconds(STRIDE_MUX_SETTLE_US);

  uint32_t accumulator = 0;
  for (uint8_t sample = 0; sample < STRIDE_ADC_SAMPLES_PER_POINT; ++sample) {
    accumulator += static_cast<uint32_t>(analogRead(signalPin));
  }
  return static_cast<uint16_t>(accumulator / STRIDE_ADC_SAMPLES_PER_POINT);

  // TODO(calibration): resistive matrices leak current through unselected
  // sensels ("crosstalk" / the sneak-path problem). Once the PCB exists,
  // either ground unselected columns actively or move to a driven-guard
  // readout, and characterise the residual here.
#endif
}

uint16_t PressureMatrix::readRawPressurePoint(uint8_t row, uint8_t column) {
  if (row >= STRIDE_MATRIX_ROWS || column >= STRIDE_MATRIX_COLUMNS) {
    return 0;
  }
#if SIMULATION_MODE
  delayMicroseconds(STRIDE_SIM_POINT_DELAY_US);
  return simulatePoint(row, column);
#else
  if (!driveRow(row)) {
    return 0;
  }
  const uint16_t value = sampleColumn(column);
  releaseRows();
  return value;
#endif
}

uint16_t PressureMatrix::readPressurePoint(uint8_t row, uint8_t column) {
  const uint16_t raw = readRawPressurePoint(row, column);
  if (calibration_ == nullptr) {
    return raw;
  }
  return calibration_->correctPressure(PressureFrame::index(row, column), raw);
}

// --- Scanning --------------------------------------------------------------

void PressureMatrix::beginScan() {
  frame_.clear();
  nextRow_ = 0;
  scanning_ = true;
  scanStartedMs_ = millis();
  scanStartedMicros_ = micros();
  frame_.timestampMs = scanStartedMs_;
  frame_.epochSeconds = time(nullptr);

#if SIMULATION_MODE
  beginSimulatedStance();
#endif
}

void PressureMatrix::finishFrame() {
  scanning_ = false;
  frame_.complete = true;
  frame_.scanDurationMs = (micros() - scanStartedMicros_ + 500) / 1000;
  computeStatistics(frame_);
  const FrameValidation validation = validatePressureFrame(frame_);
  frame_.valid = validation.ok;
}

bool PressureMatrix::scanStep() {
  if (!scanning_) {
    return true;
  }

  const uint8_t row = nextRow_;

  // One row drive serves the whole row: energise once, walk the columns.
  // A row that cannot be addressed leaves its cells at zero rather than
  // aborting the frame; validation rejects a frame that loses too much.
  const bool rowLive = driveRow(row);

  for (uint8_t column = 0; column < STRIDE_MATRIX_COLUMNS; ++column) {
    const uint16_t index = PressureFrame::index(row, column);
    uint16_t raw = 0;
    if (rowLive) {
#if SIMULATION_MODE
      delayMicroseconds(STRIDE_SIM_POINT_DELAY_US);
      raw = simulatePoint(row, column);
#else
      raw = sampleColumn(column);
#endif
    }
    frame_.values[index] =
        calibration_ != nullptr ? calibration_->correctPressure(index, raw) : raw;
  }

  releaseRows();

  ++nextRow_;
  if (nextRow_ < STRIDE_MATRIX_ROWS) {
    return false;
  }

  finishFrame();
  return true;
}

bool PressureMatrix::scanPressureMatrix(PressureFrame &out) {
  beginScan();
  while (!scanStep()) {
    // Rows are cheap; yielding keeps the RTOS idle task and Wi-Fi stack fed.
    yield();
  }
  out = frame_;
  return out.valid;
}

void PressureMatrix::computeStatistics(PressureFrame &frame) const {
  uint32_t sum = 0;
  uint16_t minValue = 0xFFFF;
  uint16_t maxValue = 0;
  uint16_t active = 0;
  uint16_t saturated = 0;

  for (uint16_t i = 0; i < STRIDE_MATRIX_CELLS; ++i) {
    const uint16_t value = frame.values[i];
    sum += value;
    if (value < minValue) {
      minValue = value;
    }
    if (value > maxValue) {
      maxValue = value;
    }
    if (value >= STRIDE_PRESSURE_ACTIVE_THRESHOLD) {
      ++active;
    }
    if (value >= STRIDE_ADC_MAX_VALUE) {
      ++saturated;
    }
  }

  frame.minValue = minValue == 0xFFFF ? 0 : minValue;
  frame.maxValue = maxValue;
  frame.averageValue = static_cast<float>(sum) / STRIDE_MATRIX_CELLS;
  frame.activeSensorCount = active;
  frame.saturatedCount = saturated;
}

// --- Zeroing ---------------------------------------------------------------

bool PressureMatrix::zeroPressureMatrix(uint8_t samples) {
  if (calibration_ == nullptr || samples == 0) {
    return false;
  }

#if SIMULATION_MODE
  // Synthesise an empty mat for the duration of the sweep.
  simUnloaded_ = true;
#endif

  bool ok = true;
  for (uint8_t row = 0; row < STRIDE_MATRIX_ROWS && ok; ++row) {
    if (!driveRow(row)) {
      ok = false;
      break;
    }
    for (uint8_t column = 0; column < STRIDE_MATRIX_COLUMNS; ++column) {
      uint32_t accumulator = 0;
      for (uint8_t sample = 0; sample < samples; ++sample) {
#if SIMULATION_MODE
        accumulator += simulatePoint(row, column);
#else
        accumulator += sampleColumn(column);
#endif
      }
      calibration_->setPressureZero(PressureFrame::index(row, column),
                                    static_cast<uint16_t>(accumulator / samples));
    }
    releaseRows();
    yield();
  }

  releaseRows();

#if SIMULATION_MODE
  simUnloaded_ = false;
#endif

  if (!ok) {
    return false;
  }

  calibration_->setPressureZeroed(true);
  calibration_->stampVersion();
  return true;
}

// --- Validation ------------------------------------------------------------

FrameValidation PressureMatrix::validatePressureFrame(const PressureFrame &frame) const {
  if (!frame.complete) {
    return {false, "frame incomplete"};
  }
  if (frame.saturatedCount >
      static_cast<uint16_t>(STRIDE_MATRIX_CELLS * STRIDE_VALIDATE_MAX_SATURATED_RATIO)) {
    return {false, "too many saturated sensels (short or stuck line?)"};
  }
  if (frame.activeSensorCount < STRIDE_VALIDATE_MIN_ACTIVE) {
    return {false, "too few active sensels (nobody on the mat?)"};
  }
  if (frame.activeSensorCount > STRIDE_VALIDATE_MAX_ACTIVE) {
    return {false, "implausibly many active sensels (mat loaded or shorted?)"};
  }
  if (frame.maxValue < STRIDE_VALIDATE_MIN_PEAK) {
    return {false, "peak pressure below threshold"};
  }
  return {true, "ok"};
}

// ===========================================================================
// Simulation
// ===========================================================================

#if SIMULATION_MODE

void PressureMatrix::beginSimulatedStance() {
  // A slightly different stance each scan: feet shift, load varies. Enough
  // variation that downstream code cannot quietly depend on a fixed frame.
  const float spread = STRIDE_MATRIX_COLUMNS * 0.20f;
  const float centre = (STRIDE_MATRIX_COLUMNS - 1) / 2.0f;
  const float jitter = (randomUnit() - 0.5f) * 1.5f;

  simCentreCol_[0] = centre - spread + jitter;
  simCentreCol_[1] = centre + spread + jitter;
  simRowOffset_ = (randomUnit() - 0.5f) * 2.0f;
  simLoadScale_ = 0.80f + randomUnit() * 0.35f;
  simUnloaded_ = false;
}

uint16_t PressureMatrix::simulatePoint(uint8_t row, uint8_t column) const {
  const uint16_t noise =
      static_cast<uint16_t>(random(0, STRIDE_SIM_NOISE_FLOOR + 1));
  if (simUnloaded_) {
    return noise;
  }

  const float r = static_cast<float>(row) + simRowOffset_;
  const float c = static_cast<float>(column);

  // Rows run toes (0) to heel (ROWS-1). Contact regions are placed as
  // fractions of the mat so the shape survives a change of geometry.
  const float rows = static_cast<float>(STRIDE_MATRIX_ROWS);
  const float heelRow = rows * 0.82f;
  const float midRow = rows * 0.58f;
  const float metRow = rows * 0.30f;
  const float toeRow = rows * 0.12f;
  // Keep blob sizes proportional if the geometry changes.
  const float scale = (rows / 25.0f) * STRIDE_SIM_BLOB_SCALE;

  float load = 0.0f;
  for (uint8_t foot = 0; foot < 2; ++foot) {
    const float centreCol = simCentreCol_[foot];
    // Medial (big-toe) side faces the body's midline: right for the left
    // foot, left for the right foot.
    const float medial = foot == 0 ? 1.0f : -1.0f;

    load += blob(r, c, heelRow, centreCol, 2.6f * scale, 1.00f);
    load += blob(r, c, midRow, centreCol - medial * 1.7f, 2.0f * scale, 0.40f);
    load += blob(r, c, metRow, centreCol, 2.9f * scale, 0.85f);
    load += blob(r, c, metRow - 0.6f * scale, centreCol + medial * 2.0f,
                 1.9f * scale, 0.55f);
    load += blob(r, c, toeRow, centreCol + medial * 1.9f, 1.3f * scale, 0.50f);
    load += blob(r, c, toeRow + 0.4f * scale, centreCol - medial * 1.1f,
                 1.5f * scale, 0.22f);
  }

  load *= simLoadScale_;

  // Cut the Gaussian tails so the mat outside the feet reads as no contact,
  // then rescale what is left across the full range. See
  // STRIDE_SIM_CONTACT_FLOOR in config.h.
  if (load <= STRIDE_SIM_CONTACT_FLOOR) {
    return noise;
  }
  load = (load - STRIDE_SIM_CONTACT_FLOOR) / (1.0f - STRIDE_SIM_CONTACT_FLOOR);
  if (load > 1.0f) {
    load = 1.0f;
  }

  const uint32_t value =
      noise + static_cast<uint32_t>(load * STRIDE_SIM_PEAK_VALUE);
  return value > STRIDE_ADC_MAX_VALUE ? STRIDE_ADC_MAX_VALUE
                                      : static_cast<uint16_t>(value);
}

#endif  // SIMULATION_MODE
