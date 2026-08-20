#include "weight_sensor.h"

#if !SIMULATION_MODE
#include <HX711.h>
namespace {
HX711 gScale;
}  // namespace
#endif

WeightSensor::WeightSensor(Calibration *calibration)
    : calibration_(calibration), initialized_(false), lastError_("not initialized") {
#if SIMULATION_MODE
  simWeightKg_ = 0.0f;
  simOverrideKg_ = -1.0f;
#endif
}

bool WeightSensor::initializeWeightSensor() {
#if SIMULATION_MODE
  // No hardware required: the whole point of simulation mode.
  initialized_ = true;
  lastError_ = "ok";
  return true;
#else
  gScale.begin(STRIDE_PIN_HX711_DOUT, STRIDE_PIN_HX711_SCK, STRIDE_HX711_GAIN);

  // The HX711 needs a conversion cycle after power-up before DOUT falls.
  if (!gScale.wait_ready_timeout(STRIDE_HX711_READY_TIMEOUT_MS)) {
    initialized_ = false;
    lastError_ = "HX711 not responding (check DOUT/SCK wiring and 5V supply)";
    return false;
  }

  // The library's own scale/offset are bypassed: raw counts come out here and
  // the conversion lives in Calibration, so one store owns every number.
  gScale.set_scale(1.0f);
  gScale.set_offset(0);

  initialized_ = true;
  lastError_ = "ok";
  return true;
#endif
}

bool WeightSensor::isReady() {
#if SIMULATION_MODE
  return true;
#else
  return initialized_ && gScale.is_ready();
#endif
}

long WeightSensor::readRawWeight(uint8_t samples) {
  if (samples == 0) {
    samples = 1;
  }
  if (!initialized_) {
    lastError_ = "not initialized";
    return 0;
  }

#if SIMULATION_MODE
  return simulateRawCounts();
#else
  if (!gScale.wait_ready_timeout(STRIDE_HX711_READY_TIMEOUT_MS)) {
    lastError_ = "HX711 timed out waiting for data";
    return 0;
  }
  lastError_ = "ok";
  return gScale.read_average(samples);
#endif
}

float WeightSensor::readWeightKg(uint8_t samples) {
  const long raw = readRawWeight(samples);
  if (calibration_ == nullptr) {
    return static_cast<float>(raw) / STRIDE_HX711_DEFAULT_FACTOR;
  }
  return calibration_->countsToKg(raw);
}

WeightReading WeightSensor::readWeight(uint8_t samples) {
  WeightReading reading;
  reading.rawCounts = readRawWeight(samples);
  reading.kilograms = calibration_ != nullptr
                          ? calibration_->countsToKg(reading.rawCounts)
                          : static_cast<float>(reading.rawCounts) /
                                STRIDE_HX711_DEFAULT_FACTOR;
  reading.valid = true;
  reading.reason = "ok";

  if (!initialized_) {
    reading.valid = false;
    reading.reason = "weight sensor not initialized";
    return reading;
  }
  if (reading.rawCounts == 0) {
    reading.valid = false;
    reading.reason = "no reading from HX711";
    return reading;
  }
  if (reading.kilograms < STRIDE_WEIGHT_MIN_KG) {
    reading.valid = false;
    reading.reason = "weight below plausible range";
    return reading;
  }
  if (reading.kilograms > STRIDE_WEIGHT_MAX_KG) {
    reading.valid = false;
    reading.reason = "weight above plausible range";
    return reading;
  }
  return reading;
}

bool WeightSensor::tareWeightSensor(uint8_t samples) {
  if (!initialized_) {
    lastError_ = "not initialized";
    return false;
  }

#if SIMULATION_MODE
  // Taring means an empty platform, so force the simulated mass to zero for
  // the duration of the reading rather than drawing a standing weight.
  simOverrideKg_ = 0.0f;
#endif
  const long raw = readRawWeight(samples);
#if SIMULATION_MODE
  simOverrideKg_ = -1.0f;
#else
  if (raw == 0) {
    lastError_ = "tare failed: no reading from HX711";
    return false;
  }
#endif

  if (calibration_ != nullptr) {
    calibration_->setWeightOffset(raw);
  }
  lastError_ = "ok";
  return true;
}

bool WeightSensor::calibrateWeightSensor(float knownKilograms, uint8_t samples) {
  if (!initialized_) {
    lastError_ = "not initialized";
    return false;
  }
  if (!(knownKilograms > 0.0f)) {
    lastError_ = "reference mass must be greater than zero";
    return false;
  }
  if (calibration_ == nullptr) {
    lastError_ = "no calibration store";
    return false;
  }

#if SIMULATION_MODE
  // The reference mass is "on the platform" for this reading.
  simOverrideKg_ = knownKilograms;
#endif
  const long raw = readRawWeight(samples);
#if SIMULATION_MODE
  simOverrideKg_ = -1.0f;
#endif
  const long delta = raw - calibration_->weightOffset();
  if (delta == 0) {
    lastError_ = "no change from tare: is the reference mass on the platform?";
    return false;
  }

  const float factor = static_cast<float>(delta) / knownKilograms;
  if (!(factor > 0.0f)) {
    // A negative factor means the bridge is wired backwards. Swapping E+/E-
    // (or A+/A-) is the fix; silently accepting it would hide the mistake.
    lastError_ = "negative scale factor: load cell bridge is likely reversed";
    return false;
  }

  calibration_->setWeightFactor(factor);
  calibration_->setWeightCalibrated(true);
  calibration_->stampVersion();
  lastError_ = "ok";
  return true;
}

void WeightSensor::describe(char *out, size_t len) const {
  if (out == nullptr || len == 0) {
    return;
  }
#if SIMULATION_MODE
  snprintf(out, len, "simulated (%.0f-%.0f kg), no hardware required",
           static_cast<double>(STRIDE_SIM_WEIGHT_MIN_KG),
           static_cast<double>(STRIDE_SIM_WEIGHT_MAX_KG));
#else
  snprintf(out, len, "DOUT=%d SCK=%d gain=%d %s", STRIDE_PIN_HX711_DOUT,
           STRIDE_PIN_HX711_SCK, STRIDE_HX711_GAIN,
           initialized_ ? "ready" : lastError_);
#endif
}

#if SIMULATION_MODE
long WeightSensor::simulateRawCounts() {
  // Draw a standing weight inside the configured band, then convert it back
  // through the active calibration so the rest of the pipeline sees ordinary
  // raw counts and the tare/calibrate paths behave the same as on hardware.
  if (simOverrideKg_ >= 0.0f) {
    simWeightKg_ = simOverrideKg_;
  } else {
    const float span = STRIDE_SIM_WEIGHT_MAX_KG - STRIDE_SIM_WEIGHT_MIN_KG;
    const float unit = static_cast<float>(random(0, 10001)) / 10000.0f;
    simWeightKg_ = STRIDE_SIM_WEIGHT_MIN_KG + unit * span;
  }

  const float factor = calibration_ != nullptr && calibration_->weightFactor() > 0.0f
                           ? calibration_->weightFactor()
                           : STRIDE_HX711_DEFAULT_FACTOR;
  const long offset = calibration_ != nullptr ? calibration_->weightOffset() : 0;

  // A little jitter so consumers cannot depend on a perfectly stable reading.
  const float jitter = (static_cast<float>(random(-50, 51)) / 10000.0f) * factor;

  lastError_ = "ok";
  return offset + static_cast<long>(simWeightKg_ * factor + jitter);
}
#endif
