/**
 * config.h - Stride Guide ESP32 firmware configuration.
 *
 * THIS FILE IS THE HARDWARE ABSTRACTION BOUNDARY.
 *
 * Every GPIO number, matrix dimension, multiplexer arrangement, timing
 * constant and endpoint lives here. No other translation unit may hard-code a
 * pin number or assume how many multiplexer boards exist. When the production
 * Stride Guide PCB arrives, bringing the firmware up on it should mean editing
 * this file - not rewriting drivers.
 *
 * Secrets do NOT live here. Real Wi-Fi credentials and API keys belong in
 * src/secrets.h, which is git-ignored. See secrets.example.h.
 */

#ifndef STRIDE_CONFIG_H
#define STRIDE_CONFIG_H

#include <Arduino.h>

// ===========================================================================
// 1. BUILD MODE
// ===========================================================================

/**
 * Simulation mode.
 *
 * true  - no physical sensors required. The pressure matrix synthesises two
 *         foot-shaped contact regions and the load cell returns a plausible
 *         body weight, so the acquisition -> validation -> event -> upload
 *         pipeline can be tested end to end before the PCB exists.
 * false - real acquisition through the multiplexer banks and the HX711.
 *
 * Overridable from platformio.ini via -DSIMULATION_MODE=0/1.
 */
#ifndef SIMULATION_MODE
#define SIMULATION_MODE true
#endif

// ===========================================================================
// 2. DEVICE IDENTITY
// ===========================================================================
//
// Placeholders only. Production identity is provisioned per unit - see
// secrets.h, and TODO(auth) below.

#ifndef DEVICE_ID
#define DEVICE_ID "dev-esp32-unprovisioned"
#endif

#ifndef DEVICE_SERIAL
#define DEVICE_SERIAL "SG-DEV-000000"
#endif

#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.1.0"
#endif

/** Version of the event envelope this firmware emits. */
#ifndef SCHEMA_VERSION
#define SCHEMA_VERSION "1.0"
#endif

/** Hardware revision string reported in event metadata. */
#ifndef HARDWARE_REVISION
#define HARDWARE_REVISION "breadboard-r0"
#endif

/** Tenancy. Assigned at installation time, not baked into a firmware image. */
#ifndef STRIDE_ORGANIZATION_ID
#define STRIDE_ORGANIZATION_ID "org-unassigned"
#endif

#ifndef STRIDE_LOCATION_ID
#define STRIDE_LOCATION_ID "loc-unassigned"
#endif

// TODO(auth): production device authentication. Each unit should carry a
// unique key pair (device.public_key in the data model), sign its events, and
// obtain a short-lived token rather than shipping a static bearer secret.

// ===========================================================================
// 3. SERIAL / DIAGNOSTICS
// ===========================================================================

#define STRIDE_SERIAL_BAUD          115200
#define STRIDE_SERIAL_BOOT_DELAY_MS 400   // let USB CDC enumerate before printing

/** Sentinel for "this pin is not wired on this board revision". */
#define STRIDE_PIN_UNUSED 255

/** Optional status LED. Set to STRIDE_PIN_UNUSED to disable. */
#define STRIDE_PIN_STATUS_LED 2
#define STRIDE_STATUS_LED_ACTIVE_HIGH true

/** Optional physical scan trigger button (active low, internal pull-up). */
#define STRIDE_PIN_SCAN_BUTTON 0
#define STRIDE_BUTTON_DEBOUNCE_MS 60

// ===========================================================================
// 4. PRESSURE MATRIX GEOMETRY
// ===========================================================================

//
// Confirmed production geometry. These are the canonical names; the
// STRIDE_-prefixed aliases below exist so the rest of the firmware keeps one
// naming style, but the numbers are defined exactly once, here.

#define MATRIX_ROWS 25
#define MATRIX_COLS 25

/** Centre-to-centre spacing between adjacent copper traces, millimetres. */
#define SENSOR_PITCH_MM 13.0f

/** Width of each copper tape trace, millimetres. */
#define COPPER_TRACE_WIDTH_MM 6.5f

/**
 * Centre-to-centre span of the grid, millimetres.
 *
 * N traces have N-1 intervals between them, NOT N. With 25 traces at 13 mm
 * that is 24 x 13 = 312 mm, not 25 x 13 = 325 mm. Getting this wrong inflates
 * the active area by one full pitch and puts every reconstructed sensor
 * coordinate 13 mm out at the far edge. The static assertions at the foot of
 * this file exist specifically to catch that mistake.
 */
#define GRID_CENTER_SPAN_X_MM ((MATRIX_COLS - 1) * SENSOR_PITCH_MM)  // 312.0
#define GRID_CENTER_SPAN_Y_MM ((MATRIX_ROWS - 1) * SENSOR_PITCH_MM)  // 312.0

/** Square grid, so both axes share one span. */
#define GRID_CENTER_SPAN_MM GRID_CENTER_SPAN_X_MM  // 312.0

/**
 * Outside copper edge to outside copper edge, millimetres.
 *
 * The centre-to-centre span plus half a trace width of overhang at each end,
 * i.e. span + one full trace width: 312 + 6.5 = 318.5 mm.
 */
#define ACTIVE_COPPER_WIDTH_MM  (GRID_CENTER_SPAN_X_MM + COPPER_TRACE_WIDTH_MM)   // 318.5
#define ACTIVE_COPPER_HEIGHT_MM (GRID_CENTER_SPAN_Y_MM + COPPER_TRACE_WIDTH_MM)   // 318.5

/** Bare substrate between adjacent traces, millimetres. */
#define SENSOR_GAP_MM (SENSOR_PITCH_MM - COPPER_TRACE_WIDTH_MM)  // 6.5

/** Physical platform, approximately 14 in square. */
#define PLATFORM_SIZE_IN     14.0f
#define PLATFORM_WIDTH_MM    (PLATFORM_SIZE_IN * 25.4f)  // 355.6
#define PLATFORM_HEIGHT_MM   (PLATFORM_SIZE_IN * 25.4f)  // 355.6

/** Substrate left over around the copper, per side, millimetres. */
#define PLATFORM_MARGIN_X_MM ((PLATFORM_WIDTH_MM - ACTIVE_COPPER_WIDTH_MM) / 2.0f)
#define PLATFORM_MARGIN_Y_MM ((PLATFORM_HEIGHT_MM - ACTIVE_COPPER_HEIGHT_MM) / 2.0f)

/**
 * Physical centre of sensel (row, column) in millimetres, measured from the
 * centre of sensel (0, 0). This is the mapping the SaaS reconstructs from the
 * geometry metadata shipped with every scan; the simulator uses it directly to
 * place synthetic feet.
 */
#define SENSEL_X_MM(column) ((column) * SENSOR_PITCH_MM)
#define SENSEL_Y_MM(row)    ((row) * SENSOR_PITCH_MM)

// --- Aliases used by the rest of the firmware ------------------------------

#define STRIDE_MATRIX_ROWS    MATRIX_ROWS
#define STRIDE_MATRIX_COLUMNS MATRIX_COLS
#define STRIDE_MATRIX_CELLS   (STRIDE_MATRIX_ROWS * STRIDE_MATRIX_COLUMNS)  // 625
#define STRIDE_MATRIX_PITCH_MM SENSOR_PITCH_MM

// ===========================================================================
// 5. MULTIPLEXER BANKS (CD74HC4067)
// ===========================================================================
//
// A CD74HC4067 carries 16 channels, so 25 lines need at least two devices per
// axis. The driver treats each axis as a *bank*: an ordered list of mux
// devices whose channels are concatenated into one logical line space
// (line 0..STRIDE_MATRIX_ROWS-1). Adding a third device, moving to 8-channel
// parts, or giving each device its own select pins is a change to the tables
// below and nothing else.
//
// Select pins are declared per device. Sharing one nibble across every device
// on a bank (the usual layout, and what is shown here) is expressed by
// repeating the same four pins; independent select lines just means different
// numbers. Enable pins are active LOW (CD74HC4067 /E) and are what actually
// selects which device in the bank is live; a device wired with /E tied to
// ground uses STRIDE_PIN_UNUSED and is assumed always enabled.
//
// TODO(pcb): every number in this section is a bring-up placeholder. Replace
// with the production Stride Guide PCB mapping. Constraints to preserve:
//   - Column SIG pins MUST be on ADC1 (GPIO 32-39). ADC2 is unavailable while
//     Wi-Fi is active on the ESP32.
//   - GPIO 34-39 are input-only: valid for column SIG, invalid for anything
//     driven (row SIG, select, enable).
//   - GPIO 6-11 are the SPI flash and must never be used.
//   - GPIO 0, 2, 12, 15 are strapping pins; driving them at reset changes boot
//     behaviour. GPIO 12 in particular selects flash voltage.

// --- Row bank: DRIVES one row at a time (digital output) -------------------

#define STRIDE_ROW_MUX_COUNT 2

/** Select pins S0..S3 for each row-bank device. */
constexpr uint8_t STRIDE_ROW_MUX_SELECT_PINS[STRIDE_ROW_MUX_COUNT][4] = {
    {13, 12, 14, 27},  // device 0
    {13, 12, 14, 27},  // device 1 - shares the select nibble with device 0
};

/** Active-low enable (/E) per row-bank device. */
constexpr uint8_t STRIDE_ROW_MUX_ENABLE_PINS[STRIDE_ROW_MUX_COUNT] = {26, 4};

/** Common signal pin (SIG) per row-bank device. Driven as a digital output. */
constexpr uint8_t STRIDE_ROW_MUX_SIGNAL_PINS[STRIDE_ROW_MUX_COUNT] = {25, 25};

/** Channels actually wired on each row-bank device. Must sum to >= ROWS. */
constexpr uint8_t STRIDE_ROW_MUX_CHANNELS[STRIDE_ROW_MUX_COUNT] = {16, 9};

// --- Column bank: SENSES one column at a time (analog input) ---------------

#define STRIDE_COL_MUX_COUNT 2

constexpr uint8_t STRIDE_COL_MUX_SELECT_PINS[STRIDE_COL_MUX_COUNT][4] = {
    {16, 17, 5, 18},
    {16, 17, 5, 18},
};

constexpr uint8_t STRIDE_COL_MUX_ENABLE_PINS[STRIDE_COL_MUX_COUNT] = {19, 21};

/** SIG pin per column-bank device. ADC1 only - see note above. */
constexpr uint8_t STRIDE_COL_MUX_SIGNAL_PINS[STRIDE_COL_MUX_COUNT] = {34, 35};

constexpr uint8_t STRIDE_COL_MUX_CHANNELS[STRIDE_COL_MUX_COUNT] = {16, 9};

// --- Bank electrical behaviour ---------------------------------------------

/** Logic level written to a row's SIG pin to energise that row. */
#define STRIDE_ROW_DRIVE_ACTIVE_HIGH true

/** Settle time after changing mux address before sampling, microseconds. */
#define STRIDE_MUX_SETTLE_US 25

/** Extra settle after switching rows (the whole column bus must discharge). */
#define STRIDE_ROW_SETTLE_US 60

// ===========================================================================
// 6. ADC / PRESSURE CONDITIONING
// ===========================================================================

#define STRIDE_ADC_RESOLUTION_BITS 12
#define STRIDE_ADC_MAX_VALUE       ((1 << STRIDE_ADC_RESOLUTION_BITS) - 1)  // 4095

/** Oversampling per sensel. Higher = quieter, slower. */
#define STRIDE_ADC_SAMPLES_PER_POINT 2

/** Attenuation applied to column SIG pins (full 0-3.3V range). */
#define STRIDE_ADC_ATTENUATION ADC_11db

/**
 * Counts above a sensel's zero offset before it is considered loaded.
 * TODO(calibration): derive from a real Velostat characterisation sweep rather
 * than this bring-up guess. Velostat is non-linear and drifts with temperature
 * and creep, so a per-unit curve (not a single threshold) is the end state.
 */
#define STRIDE_PRESSURE_ACTIVE_THRESHOLD 40

/** Samples averaged per sensel when capturing the unloaded zero map. */
#define STRIDE_PRESSURE_ZERO_SAMPLES 8

// ===========================================================================
// 7. FRAME VALIDATION
// ===========================================================================
//
// Cheap sanity checks so obviously broken frames are not shipped to the API.
// The device validates; it does not interpret. No fit logic runs here.

/** A scan with fewer loaded sensels than this is nobody standing on the mat. */
#define STRIDE_VALIDATE_MIN_ACTIVE 24

/** More than this means a short, a stuck row, or a mat under a shelf. */
#define STRIDE_VALIDATE_MAX_ACTIVE (STRIDE_MATRIX_CELLS * 9 / 10)

/** Peak must clear this or the mat is not really loaded. */
#define STRIDE_VALIDATE_MIN_PEAK 120

/** Fraction of cells at full scale that indicates saturation/short. */
#define STRIDE_VALIDATE_MAX_SATURATED_RATIO 0.25f

// ===========================================================================
// 8. HX711 LOAD CELL INTERFACE
// ===========================================================================
//
// TODO(pcb): confirm against the production PCB.
// The bridge arrangement is deliberately not assumed: one HX711 may read a
// single cell or the summed output of a four-cell Wheatstone arrangement.
// Either way the driver reads counts and applies a scale, so only the numbers
// below change.

#define STRIDE_PIN_HX711_DOUT 23
#define STRIDE_PIN_HX711_SCK  22

/** HX711 channel/gain: 128 or 64 for channel A, 32 for channel B. */
#define STRIDE_HX711_GAIN 128

/** Readings averaged for a normal weight measurement. */
#define STRIDE_HX711_SAMPLES 10

/** Readings averaged when taring or calibrating. */
#define STRIDE_HX711_TARE_SAMPLES 20

/** Milliseconds to wait for the chip to signal data-ready before giving up. */
#define STRIDE_HX711_READY_TIMEOUT_MS 1000

/**
 * Default counts-per-kilogram. Overwritten by the stored calibration once
 * calibrateWeightSensor() has been run against a known mass.
 * TODO(calibration): capture the real factor per unit at manufacture and burn
 * it into NVS during provisioning.
 */
#define STRIDE_HX711_DEFAULT_FACTOR 22000.0f

/** Weights outside this band are rejected as implausible for a standing adult. */
#define STRIDE_WEIGHT_MIN_KG 15.0f
#define STRIDE_WEIGHT_MAX_KG 250.0f

// ===========================================================================
// 9. CALIBRATION STORAGE
// ===========================================================================

/** NVS namespace holding the zero map, weight factor and tare offset. */
#define STRIDE_CAL_NAMESPACE "stride-cal"

/** Identifies the calibration record shipped with an event. */
#define STRIDE_CAL_DEFAULT_VERSION "uncalibrated"

// ===========================================================================
// 10. WI-FI
// ===========================================================================
//
// Placeholders. Real credentials belong in secrets.h.

#ifndef STRIDE_WIFI_SSID
#define STRIDE_WIFI_SSID "CHANGE_ME_SSID"
#endif

#ifndef STRIDE_WIFI_PASSWORD
#define STRIDE_WIFI_PASSWORD "CHANGE_ME_PASSWORD"
#endif

#define STRIDE_WIFI_CONNECT_TIMEOUT_MS 20000
#define STRIDE_WIFI_RETRY_INTERVAL_MS  30000
#define STRIDE_WIFI_HOSTNAME           "stride-guide-device"

// ===========================================================================
// 11. STRIDE GUIDE EVENT API
// ===========================================================================

#ifndef STRIDE_API_BASE_URL
#define STRIDE_API_BASE_URL "https://api.example.invalid"
#endif

#define STRIDE_API_EVENTS_PATH "/api/v1/events"
#define STRIDE_API_HEALTH_PATH "/api/v1/events"

/** Bearer token. Placeholder only - never commit a real key. */
#ifndef STRIDE_API_KEY
#define STRIDE_API_KEY "CHANGE_ME_API_KEY"
#endif

#define STRIDE_EVENT_TYPE_SCAN   "plantar_pressure_scan"
#define STRIDE_EVENT_TYPE_HEALTH "device_health_event"

#define STRIDE_HTTP_TIMEOUT_MS 12000

/** Attempts per upload cycle. Bounded - there is no unlimited retry path. */
#define STRIDE_HTTP_MAX_ATTEMPTS 3

/** Backoff before attempt N: base * 2^(N-1), clamped to the maximum. */
#define STRIDE_HTTP_BACKOFF_BASE_MS 1000
#define STRIDE_HTTP_BACKOFF_MAX_MS  8000

/**
 * How long a buffered event waits before a new upload cycle is started for it.
 * A failed cycle parks the event; it is never silently dropped.
 */
#define STRIDE_QUEUE_RETRY_INTERVAL_MS 60000

/**
 * Buffered events held in RAM.
 * TODO(offline): back the queue with NVS or SPIFFS so a scan survives a power
 * cycle, and raise the depth to a full retail day.
 */
#define STRIDE_EVENT_QUEUE_DEPTH 4

/** Health check cadence once connected. 0 disables periodic health checks. */
#define STRIDE_HEALTH_INTERVAL_MS 300000

// ===========================================================================
// 12. TIME
// ===========================================================================

#define STRIDE_NTP_SERVER_PRIMARY   "pool.ntp.org"
#define STRIDE_NTP_SERVER_SECONDARY "time.nist.gov"

/** Events carry UTC. Local presentation is the SaaS side's problem. */
#define STRIDE_NTP_GMT_OFFSET_SEC     0
#define STRIDE_NTP_DAYLIGHT_OFFSET_SEC 0
#define STRIDE_NTP_SYNC_TIMEOUT_MS    8000

// ===========================================================================
// 13. SIMULATION PARAMETERS
// ===========================================================================
//
// Only consulted when SIMULATION_MODE is true.

#define STRIDE_SIM_WEIGHT_MIN_KG 55.0f
#define STRIDE_SIM_WEIGHT_MAX_KG 105.0f

/** Peak synthetic sensel value and background noise floor, in ADC counts. */
#define STRIDE_SIM_PEAK_VALUE  3400
#define STRIDE_SIM_NOISE_FLOOR 25

/**
 * Synthetic stance, in physical millimetres.
 *
 * The simulated feet are laid out in real millimetre coordinates and then
 * sampled at the sensel positions given by SENSOR_PITCH_MM, so the synthetic
 * footprint changes shape correctly if the pitch changes. Contact regions are
 * placed as fractions of foot length, which keeps the anatomy right for any
 * foot size.
 */
#define STRIDE_SIM_FOOT_LENGTH_MM       265.0f  ///< Heel to toe.
#define STRIDE_SIM_STANCE_HALF_WIDTH_MM 65.0f   ///< Foot centre to mat centre.
#define STRIDE_SIM_STANCE_JITTER_MM     20.0f   ///< Placement variation per scan.

/**
 * Contact blob sigmas and lateral offsets, millimetres. Anatomical, not
 * per-sensel: at 13 mm pitch a 24 mm heel sigma is under two sensels wide.
 */
#define STRIDE_SIM_SIGMA_HEEL_MM     24.0f
#define STRIDE_SIM_SIGMA_MIDFOOT_MM  18.0f
#define STRIDE_SIM_SIGMA_METHEAD_MM  26.0f
#define STRIDE_SIM_SIGMA_MTH1_MM     16.0f
#define STRIDE_SIM_SIGMA_HALLUX_MM   12.0f
#define STRIDE_SIM_SIGMA_TOES_MM     14.0f

#define STRIDE_SIM_OFFSET_MIDFOOT_MM 20.0f  ///< Lateral column, away from midline.
#define STRIDE_SIM_OFFSET_MTH1_MM    20.0f  ///< First metatarsal head, medial.
#define STRIDE_SIM_OFFSET_HALLUX_MM  26.0f  ///< Big toe, medial.
#define STRIDE_SIM_OFFSET_TOES_MM    12.0f  ///< Lesser toes, lateral.

/**
 * Synthetic contact shaping.
 *
 * The foot regions are summed Gaussian blobs, which never quite reach zero -
 * without a floor, the tails put every sensel on the mat above the active
 * threshold and no simulated frame ever looks like a footprint. Load at or
 * below the floor is treated as no contact; what remains is rescaled to the
 * full range.
 *
 * Floor 0.15 at 13 mm pitch yields roughly 190-250 loaded sensels for a
 * two-foot stance, with a clear arch gap and an empty border. At 1.69 cm2 per
 * sensel that is 320-420 cm2 of contact, which is the right order for two
 * adult feet, and sits comfortably inside the validation window in section 7.
 * Retune this if the pitch or the blob sigmas change.
 */
#define STRIDE_SIM_CONTACT_FLOOR 0.15f

/** Global multiplier on every blob sigma, for tuning. */
#define STRIDE_SIM_BLOB_SCALE 1.0f

/** Simulated per-sensel acquisition cost, so scan timings stay realistic. */
#define STRIDE_SIM_POINT_DELAY_US 20

/**
 * Auto-scan interval in simulation, milliseconds, so an unattended board keeps
 * exercising the pipeline. 0 disables (scan on serial command or button only).
 */
#define STRIDE_SIM_AUTO_SCAN_INTERVAL_MS 0

// ===========================================================================
// 14. STATE MACHINE TIMING
// ===========================================================================

/** Cooldown after a completed scan before another may be triggered. */
#define STRIDE_SCAN_COOLDOWN_MS 1500

/** How long ERROR is held before the device retries its self test. */
#define STRIDE_ERROR_RETRY_MS 10000

// ===========================================================================
// 15. LOCAL OVERRIDES / SECRETS
// ===========================================================================
//
// src/secrets.h is git-ignored (see .gitignore) and, when present, overrides
// any of the placeholders above. Copy secrets.example.h to secrets.h to start.
// Included last so its #undef/#define pairs win.

#if defined(__has_include)
#if __has_include("secrets.h")
#include "secrets.h"
#endif
#endif

// ===========================================================================
// COMPILE-TIME CONSISTENCY CHECKS
// ===========================================================================

/** Constant-expression float comparison with a tolerance. */
constexpr bool strideNear(float a, float b, float tolerance) {
  return (a - b) < tolerance && (b - a) < tolerance;
}

// --- Geometry -------------------------------------------------------------

static_assert(MATRIX_ROWS > 1 && MATRIX_COLS > 1,
              "A grid needs at least two traces per axis to have a pitch");

// The one that matters: N traces span N-1 intervals. If someone "simplifies"
// GRID_CENTER_SPAN to MATRIX_COLS * SENSOR_PITCH_MM, this fails.
static_assert(strideNear(GRID_CENTER_SPAN_X_MM,
                         (MATRIX_COLS - 1) * SENSOR_PITCH_MM, 0.001f),
              "Centre span must use MATRIX_COLS-1 intervals, not MATRIX_COLS");
static_assert(GRID_CENTER_SPAN_X_MM < MATRIX_COLS * SENSOR_PITCH_MM,
              "Centre span is a full pitch too large: 25 traces have 24 gaps");
static_assert(GRID_CENTER_SPAN_Y_MM < MATRIX_ROWS * SENSOR_PITCH_MM,
              "Centre span is a full pitch too large: 25 traces have 24 gaps");

// Confirmed production figures, asserted literally so a change to pitch or
// trace width that was not meant to move the active area is caught at build
// time rather than discovered in reconstructed coordinates.
static_assert(strideNear(GRID_CENTER_SPAN_MM, 312.0f, 0.001f),
              "24 intervals x 13.0 mm must be 312.0 mm");
static_assert(strideNear(ACTIVE_COPPER_WIDTH_MM, 318.5f, 0.001f),
              "312.0 mm span + 6.5 mm trace width must be 318.5 mm");
static_assert(strideNear(ACTIVE_COPPER_HEIGHT_MM, 318.5f, 0.001f),
              "312.0 mm span + 6.5 mm trace width must be 318.5 mm");

static_assert(COPPER_TRACE_WIDTH_MM < SENSOR_PITCH_MM,
              "Trace width must be less than pitch or adjacent traces short");
static_assert(SENSOR_GAP_MM > 0.0f, "Traces need bare substrate between them");

static_assert(ACTIVE_COPPER_WIDTH_MM <= PLATFORM_WIDTH_MM &&
                  ACTIVE_COPPER_HEIGHT_MM <= PLATFORM_HEIGHT_MM,
              "Active copper does not fit on the physical platform");
static_assert(PLATFORM_MARGIN_X_MM > 0.0f && PLATFORM_MARGIN_Y_MM > 0.0f,
              "Platform leaves no margin around the copper");

// --- Multiplexer banks ------------------------------------------------------

/** Sum of a compile-time channel table. C++11-compatible (recursive). */
constexpr uint16_t strideSumChannels(const uint8_t *table, uint8_t count) {
  return count == 0 ? 0
                    : static_cast<uint16_t>(table[count - 1] +
                                            strideSumChannels(table, count - 1));
}

static_assert(strideSumChannels(STRIDE_ROW_MUX_CHANNELS, STRIDE_ROW_MUX_COUNT) >=
                  STRIDE_MATRIX_ROWS,
              "Row mux bank does not expose enough channels for STRIDE_MATRIX_ROWS");
static_assert(strideSumChannels(STRIDE_COL_MUX_CHANNELS, STRIDE_COL_MUX_COUNT) >=
                  STRIDE_MATRIX_COLUMNS,
              "Column mux bank does not expose enough channels for STRIDE_MATRIX_COLUMNS");
static_assert(STRIDE_EVENT_QUEUE_DEPTH >= 1, "Event queue needs at least one slot");
static_assert(STRIDE_HTTP_MAX_ATTEMPTS >= 1 && STRIDE_HTTP_MAX_ATTEMPTS <= 10,
              "Bounded retry: pick between 1 and 10 attempts");

#endif  // STRIDE_CONFIG_H
