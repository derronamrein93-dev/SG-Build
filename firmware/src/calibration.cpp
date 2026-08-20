#include "calibration.h"

#include <Preferences.h>
#include <time.h>

namespace {
constexpr uint16_t kCalMagic = 0x5347;  // 'SG'
constexpr uint16_t kCalRevision = 1;
constexpr const char *kBlobKey = "record";
}  // namespace

Calibration::Calibration() : loadedFromStorage_(false) { reset(); }

void Calibration::reset() {
  memset(&data_, 0, sizeof(data_));
  data_.magic = kCalMagic;
  data_.revision = kCalRevision;
  strncpy(data_.version, STRIDE_CAL_DEFAULT_VERSION, STRIDE_CAL_VERSION_LEN - 1);
  data_.version[STRIDE_CAL_VERSION_LEN - 1] = '\0';

  // No zero map yet: every sensel baselines at 0 counts, which makes raw
  // readings pass through untouched until zeroPressureMatrix() runs.
  data_.pressureZeroed = false;
  data_.weightFactor = STRIDE_HX711_DEFAULT_FACTOR;
  data_.weightOffset = 0;
  data_.weightCalibrated = false;
  loadedFromStorage_ = false;
}

bool Calibration::begin() { return load(); }

bool Calibration::load() {
  Preferences prefs;
  if (!prefs.begin(STRIDE_CAL_NAMESPACE, /*readOnly=*/true)) {
    // Namespace has never been written. Defaults stand.
    return false;
  }

  CalibrationData stored;
  const size_t read = prefs.getBytes(kBlobKey, &stored, sizeof(stored));
  prefs.end();

  if (read != sizeof(stored) || stored.magic != kCalMagic ||
      stored.revision != kCalRevision) {
    // Absent, truncated, or written by an incompatible firmware layout.
    // Refusing a stale record is safer than misreading one.
    return false;
  }

  data_ = stored;
  data_.version[STRIDE_CAL_VERSION_LEN - 1] = '\0';
  if (!(data_.weightFactor > 0.0f)) {
    data_.weightFactor = STRIDE_HX711_DEFAULT_FACTOR;
    data_.weightCalibrated = false;
  }
  loadedFromStorage_ = true;
  return true;
}

bool Calibration::save() {
  Preferences prefs;
  if (!prefs.begin(STRIDE_CAL_NAMESPACE, /*readOnly=*/false)) {
    return false;
  }
  data_.magic = kCalMagic;
  data_.revision = kCalRevision;
  const size_t written = prefs.putBytes(kBlobKey, &data_, sizeof(data_));
  prefs.end();

  const bool ok = written == sizeof(data_);
  if (ok) {
    loadedFromStorage_ = true;
  }
  return ok;
}

bool Calibration::erase() {
  Preferences prefs;
  if (!prefs.begin(STRIDE_CAL_NAMESPACE, /*readOnly=*/false)) {
    return false;
  }
  const bool ok = prefs.clear();
  prefs.end();
  reset();
  return ok;
}

void Calibration::setVersion(const char *version) {
  if (version == nullptr) {
    return;
  }
  strncpy(data_.version, version, STRIDE_CAL_VERSION_LEN - 1);
  data_.version[STRIDE_CAL_VERSION_LEN - 1] = '\0';
}

void Calibration::stampVersion() {
  // "p<0|1>-w<0|1>-<YYYYMMDD>" - which halves are calibrated, and when. The
  // date is only meaningful once NTP has run; before that time() returns an
  // epoch near zero and the stamp reads 19700101, which is itself a useful
  // signal that the unit was calibrated without a clock.
  time_t now = time(nullptr);
  struct tm timeinfo;
  gmtime_r(&now, &timeinfo);

  // Fields are reduced modulo their width so the stamp always fits, whatever
  // a garbage clock hands back.
  const unsigned year = static_cast<unsigned>(timeinfo.tm_year + 1900) % 10000u;
  const unsigned month = static_cast<unsigned>(timeinfo.tm_mon + 1) % 100u;
  const unsigned day = static_cast<unsigned>(timeinfo.tm_mday) % 100u;

  snprintf(data_.version, STRIDE_CAL_VERSION_LEN, "p%u-w%u-%04u%02u%02u",
           data_.pressureZeroed ? 1u : 0u, data_.weightCalibrated ? 1u : 0u,
           year, month, day);
  data_.version[STRIDE_CAL_VERSION_LEN - 1] = '\0';
}

uint16_t Calibration::pressureZero(uint16_t index) const {
  if (index >= STRIDE_MATRIX_CELLS) {
    return 0;
  }
  return data_.pressureZero[index];
}

void Calibration::setPressureZero(uint16_t index, uint16_t counts) {
  if (index >= STRIDE_MATRIX_CELLS) {
    return;
  }
  data_.pressureZero[index] = counts;
}

uint16_t Calibration::correctPressure(uint16_t index, uint16_t raw) const {
  if (!data_.pressureZeroed || index >= STRIDE_MATRIX_CELLS) {
    return raw;
  }
  const uint16_t zero = data_.pressureZero[index];
  return raw > zero ? static_cast<uint16_t>(raw - zero) : 0;
}

void Calibration::setWeightFactor(float countsPerKg) {
  if (countsPerKg > 0.0f) {
    data_.weightFactor = countsPerKg;
  }
}

void Calibration::setWeightOffset(long counts) { data_.weightOffset = counts; }

float Calibration::countsToKg(long raw) const {
  const float factor =
      data_.weightFactor > 0.0f ? data_.weightFactor : STRIDE_HX711_DEFAULT_FACTOR;
  return static_cast<float>(raw - data_.weightOffset) / factor;
}

void Calibration::describe(char *out, size_t len) const {
  if (out == nullptr || len == 0) {
    return;
  }
  snprintf(out, len, "version=%s pressure_zero=%s weight=%s factor=%.1f",
           data_.version, data_.pressureZeroed ? "yes" : "no",
           data_.weightCalibrated ? "calibrated" : "default",
           static_cast<double>(data_.weightFactor));
}
