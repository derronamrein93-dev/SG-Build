# Stride Guide — ESP32 Device Firmware

Firmware for the Stride Guide in-store scanning device: a 25×25 Velostat
plantar-pressure mat plus a load cell, which captures a scan, measures total
weight, packages both into a versioned event and posts it to the Stride Guide
event API.

**Status:** bring-up. The production PCB does not exist yet, so every GPIO
assignment in this tree is a placeholder and `SIMULATION_MODE` is on by
default. The firmware compiles, runs and completes the full device-to-cloud
pipeline on a bare ESP32 dev board with nothing wired to it.

---

## What the device does — and does not do

The ESP32 is responsible for six things:

1. **Sensor acquisition** — scan the pressure matrix, read the load cell.
2. **Hardware calibration** — per-sensel zero map, load-cell scale and tare.
3. **Validation** — cheap plausibility checks on a frame before it ships.
4. **Device identity** — which unit, which firmware, which calibration.
5. **Wi-Fi communication**.
6. **Event transmission** — the versioned envelope, with retry and buffering.

It does **not** run fit logic, choose shoes, or match customers. The device
measures and identifies itself; recommendation happens server-side, where the
catalogue and the rules engine live. A scan leaves the device as raw calibrated
counts plus the calibration version needed to interpret them.

---

## Physical geometry

Confirmed production geometry, defined once in `config.h` §4 and shipped with
every scan so the SaaS can reconstruct sensor coordinates:

| Constant | Value |
| --- | --- |
| `MATRIX_ROWS` × `MATRIX_COLS` | 25 × 25 (625 sensels) |
| `SENSOR_PITCH_MM` | 13.0 mm centre-to-centre |
| `COPPER_TRACE_WIDTH_MM` | 6.5 mm |
| `SENSOR_GAP_MM` | 6.5 mm bare substrate between traces |
| `GRID_CENTER_SPAN_MM` | **312.0 mm** (24 × 13.0) |
| `ACTIVE_COPPER_WIDTH_MM` / `_HEIGHT_MM` | **318.5 mm** (312.0 + 6.5) |
| `PLATFORM_WIDTH_MM` / `_HEIGHT_MM` | 355.6 mm (14 in) |
| `PLATFORM_MARGIN_X_MM` / `_Y_MM` | 18.55 mm per side |

> **25 traces have 24 intervals, not 25.** The centre-to-centre span is
> 24 × 13 = 312 mm, *not* 25 × 13 = 325 mm. Using the trace count instead of
> the interval count inflates the active area by a full pitch and puts every
> reconstructed coordinate 13 mm out at the far edge. Five `static_assert`s at
> the foot of `config.h` fail the build if anyone reintroduces that mistake,
> and they also check that the trace width is smaller than the pitch (or
> adjacent traces short) and that the copper fits on the platform with margin
> to spare.

Sensel `(row, column)` sits at `(column × 13.0, row × 13.0)` mm from the centre
of sensel `(0, 0)` — `SENSEL_X_MM()` / `SENSEL_Y_MM()`. Sensel (24, 24) is
therefore at (312.0, 312.0) mm. Each sensel covers 1.69 cm².

## Architecture

```
main.cpp            State machine, serial console, boot diagnostics
├── config.h        ★ Every pin, dimension, timing and endpoint
├── pressure_matrix Mux banks (CD74HC4067) + frame acquisition
├── weight_sensor   HX711 abstraction
├── calibration     Zero map, scale, tare — persisted to NVS
└── api_client      Wi-Fi, event envelope, bounded retry, offline buffer
```

### Hardware abstraction

`config.h` is the hardware boundary. No other file names a GPIO. Bringing the
firmware up on the production PCB should mean editing that file, not rewriting
drivers.

The multiplexer layer is the part most likely to change, so it is described by
tables rather than code. A CD74HC4067 has 16 channels and the matrix needs 25
lines per axis, so each axis is a **bank**: an ordered list of mux devices whose
channels are concatenated into one flat line space.

```
Row bank    device 0 (16 ch)  device 1 (9 ch)   → rows 0..24
                                                   row 20 = device 1, channel 4
Column bank device 0 (16 ch)  device 1 (9 ch)   → columns 0..24
```

`MuxBank::select(line)` resolves a line to a device and channel by walking that
list. Nothing above it knows how many mux boards exist. Adding a third device,
moving to 8-channel parts, giving each device its own select nibble, or
changing which SIG pin serves which device is a change to the tables in
`config.h` §5 — the scanning code is unaffected. Compile-time assertions verify
the banks expose enough channels for the declared geometry.

Scanning is a standard resistive-matrix sweep: energise one row through the row
bank, sample every column through the column bank's ADC pins, move on. Rows are
acquired one per `loop()` iteration so a scan never monopolises the device.

### State machine

```
BOOT ──► SELF_TEST ──► CONNECTING ──► READY ──► SCANNING ──► UPLOADING ──┐
             ▲                          ▲                                │
             │                          └────────────────────────────────┘
             └──────────── ERROR ◄───── (matrix self-test failure)
```

| State | Does |
| --- | --- |
| `BOOT` | Load calibration from NVS, initialise the API client. |
| `SELF_TEST` | Initialise both sensors, print the diagnostic report. |
| `CONNECTING` | Poll Wi-Fi association in short slices, sync NTP, send a boot health event. |
| `READY` | Wait for a trigger; run periodic health checks; drain the event queue. |
| `SCANNING` | Acquire one matrix row per iteration, then validate the frame. |
| `UPLOADING` | Wait for the upload cycle to resolve, then report it. |
| `ERROR` | Hold, then retry the self test. |

Every handler returns promptly. There is no long blocking loop: uploads are
driven by `ApiClient::loop()` on every iteration, including during a scan.

A failed Wi-Fi connection is **not** an error state. The device continues into
`READY` offline, buffers scans, and uploads them when the link returns.

---

## Getting started

### 1. Install PlatformIO

PlatformIO Core is a Python package:

```bash
python3 -m venv ~/.pio-venv
~/.pio-venv/bin/pip install platformio
~/.pio-venv/bin/pio --version
```

Or use the [PlatformIO IDE extension](https://platformio.org/install/ide) for
VS Code, which bundles Core.

The first build downloads the ESP32 toolchain and the Arduino framework
(a few hundred MB); later builds take seconds.

### 2. Compile

```bash
cd firmware
pio run -e esp32dev-sim     # simulation build, no hardware needed
pio run -e esp32dev-hw      # real sensor acquisition
pio run                     # default env, honours SIMULATION_MODE in config.h
```

### 3. Flash and watch

```bash
pio run -e esp32dev-sim -t upload
pio device monitor -b 115200
```

`pio run -t upload -t monitor` does both in one go. If the board is not
detected, pass the port explicitly: `pio run -t upload --upload-port /dev/ttyUSB0`.

### 4. Drive it from the serial console

| Key | Action |
| --- | --- |
| `s` | Run a scan and upload it |
| `z` | Capture the pressure zero map (mat must be empty) |
| `t` | Tare the load cell (platform must be empty) |
| `c<kg>` | Calibrate the load cell against a known mass, e.g. `c20` |
| `w` | Persist calibration to NVS |
| `r` | Erase stored calibration |
| `h` | Send a health event now |
| `i` | Print state, connectivity, queue depth and calibration |

A scan can also be triggered by the button on `STRIDE_PIN_SCAN_BUTTON`
(GPIO 0 — the dev board's BOOT button — during bring-up).

---

## Simulation mode

```c
#define SIMULATION_MODE true   // config.h §1
```

With simulation on, no sensor needs to be connected:

- The pressure matrix synthesises **two foot-shaped contact regions** — heel,
  lateral midfoot, metatarsal heads, hallux and lesser toes — from summed
  Gaussian blobs, with a contact floor that leaves the rest of the mat empty.
  The feet are laid out in **physical millimetre coordinates** (a 265 mm foot,
  stance ±65 mm from the mat centre, blob sigmas in mm) and then sampled at the
  sensel positions given by `SENSOR_PITCH_MM`, so the synthetic footprint
  rescales correctly if the pitch ever changes rather than being drawn in
  sensel units. Foot placement, stance and overall load vary from scan to scan,
  so nothing downstream can quietly depend on a fixed frame. At 13 mm pitch a
  typical stance loads 190–250 of the 625 sensels — 320–420 cm² of contact, the
  right order for two adult feet — and passes validation.
- The load cell returns a plausible standing weight between
  `STRIDE_SIM_WEIGHT_MIN_KG` and `STRIDE_SIM_WEIGHT_MAX_KG`, converted back
  through the active calibration so `t` and `c<kg>` behave as they do on
  hardware.
- Scan timing is preserved, so durations reported in events stay realistic.

Everything else — calibration storage, validation, envelope construction,
retry, buffering, upload — is the same code that runs on hardware. That is the
point: the API contract and the whole device-to-cloud path can be exercised
and integration-tested before the PCB arrives.

Set `SIMULATION_MODE` to `false` (or build `esp32dev-hw`) for real acquisition.

---

## Where the GPIO mappings live

All of them are in **`src/config.h`**:

| Section | Contents |
| --- | --- |
| §3 | Status LED, scan button |
| §4 | Matrix geometry: pitch, trace width, spans, platform size |
| §5 | Mux banks: select, enable and signal pins; per-device channel counts |
| §6 | ADC resolution, attenuation, oversampling |
| §8 | HX711 `DOUT`/`SCK`, gain, sample counts |

Constraints the production mapping must respect — all noted inline in §5:

- **Column SIG pins must be on ADC1 (GPIO 32–39).** ADC2 is unusable while
  Wi-Fi is active on the ESP32.
- **GPIO 34–39 are input-only.** Fine for column SIG, invalid for anything
  driven (row SIG, select, enable).
- **GPIO 6–11 are the SPI flash.** Never use them.
- **GPIO 0, 2, 12, 15 are strapping pins.** Driving them at reset changes boot
  behaviour; GPIO 12 selects flash voltage.

---

## Calibration

Calibration lives in NVS and is stamped with a version string
(`p1-w1-20260820` — pressure zeroed, weight calibrated, date) that travels in
every event. A scan is only interpretable alongside the calibration that
produced it.

**Pressure zero map.** With nothing on the mat, press `z`. Each sensel is
sampled `STRIDE_PRESSURE_ZERO_SAMPLES` times and the average stored as that
sensel's unloaded baseline; later readings subtract it, clamped at zero. Press
`w` to persist.

**Load cell.** With the platform empty, press `t` to capture the tare offset.
Place a known mass on it and press `c<kg>` (e.g. `c20`) to derive
counts-per-kilogram. A negative factor is rejected with an explicit message —
it means the bridge is wired backwards. Press `w` to persist.

Until both have been done the device runs on defaults and says so at boot, in
`i`, and through `calibration_version` in every event.

---

## API contract

`POST {STRIDE_API_BASE_URL}/api/v1/events`

Headers: `Content-Type: application/json`, `Authorization: Bearer <key>`,
`X-Stride-Device-Id`, `X-Stride-Firmware`.

```jsonc
{
  "event_id": "9f1c7e2a-....",            // UUID v4, generated per event
  "event_type": "plantar_pressure_scan",
  "schema_version": "1.0",
  "organization_id": "org-0001",
  "location_id": "loc-0001",
  "device_id": "dev-0001",
  "customer_id": null,                    // often unknown at scan time
  "timestamp": "2026-08-20T14:31:07Z",    // UTC, ISO 8601
  "payload": {
    "weight_kg": 78.42,
    "rows": 25,
    "columns": 25,
    "pressure_matrix": [0, 0, 41, ...],   // 625 values, row-major
    "scan_duration_ms": 312,
    "calibration_version": "p1-w1-20260820",
    "firmware_version": "0.1.0"
  },
  "metadata": {
    "device_serial": "SG-0001-000001",
    "hardware_revision": "breadboard-r0",
    "simulation_mode": true,
    "clock_synced": true,
    "uptime_ms": 84213,
    "wifi_rssi": -54,
    "adc_max_value": 4095,
    "geometry": {
      "rows": 25, "columns": 25,
      "pitch_mm": 13.00,
      "trace_width_mm": 6.50,
      "center_span_x_mm": 312.00, "center_span_y_mm": 312.00,
      "active_copper_width_mm": 318.50, "active_copper_height_mm": 318.50,
      "platform_width_mm": 355.6, "platform_height_mm": 355.6,
      "origin": "sensel_0_0_center",
      "order": "row_major"
    },
    "min_value": 0, "max_value": 3422, "average_value": 410.2,
    "active_sensor_count": 221, "saturated_count": 0,
    "frame_valid": true
  }
}
```

**`pressure_matrix`** is a flat, row-major array of `rows × columns` calibrated
ADC counts: `index = row * columns + column`. Row 0 is the toe end. Values are
counts, not pressure units — converting them needs the calibration record
named by `calibration_version`, which lives server-side.

**`metadata.geometry`** carries what is needed to turn an index into a physical
position: sensel `(row, column)` is at `(column × pitch_mm, row × pitch_mm)` mm
from the centre of sensel `(0, 0)`, which is what `origin` and `order` name. It
is sent per event rather than assumed server-side, so a hardware revision that
changes the pitch cannot silently corrupt every stored scan. Note that
`center_span_x_mm` is `(columns - 1) × pitch_mm`, not `columns × pitch_mm`.

**`customer_id`** is explicitly `null` rather than omitted when the customer
has not been identified. The receiver never has to guess which case it is.

**Health events** go to the same endpoint with
`event_type: "device_health_event"`, carrying uptime, free heap, RSSI, queue
depth and dropped-event count. Sent at boot, every
`STRIDE_HEALTH_INTERVAL_MS`, and on demand with `h`.

### Delivery behaviour

- An upload cycle makes at most `STRIDE_HTTP_MAX_ATTEMPTS` attempts with
  exponential backoff (1 s, 2 s, 4 s… capped). **There is no unbounded retry
  path.**
- When a cycle is exhausted, the event **stays in the queue** and a fresh cycle
  starts after `STRIDE_QUEUE_RETRY_INTERVAL_MS`. A network failure never
  discards a scan the customer already stood for.
- `4xx` responses other than `408`/`429` are treated as permanent: retrying
  will not help, and keeping the event would block every later scan behind one
  bad request. It is dropped and the reason is printed.
- Frames that **fail validation are still transmitted**, flagged
  `frame_valid: false`. A rejected scan is evidence of what the hardware did.
- Every failure is reported over Serial with the HTTP status and what happened
  to the data.

The queue is behind the `EventQueue` interface. `RamEventQueue` is the
bring-up implementation — a ring buffer of `STRIDE_EVENT_QUEUE_DEPTH` events
that counts anything it has to drop. A flash-backed implementation can be
substituted without touching `ApiClient`.

---

## Security

No real credential is in this repository, and none should ever be.

- `config.h` carries placeholders only (`CHANGE_ME_SSID`, `CHANGE_ME_API_KEY`).
  The device prints a warning at boot while any of them is still in place.
- Real values go in **`src/secrets.h`**, which is git-ignored and included at
  the end of `config.h` so its `#undef`/`#define` pairs override the
  placeholders. Start from `src/secrets.example.h`:

  ```bash
  cp src/secrets.example.h src/secrets.h
  ```

- The serial console prints the SSID as an operational aid. It never prints the
  Wi-Fi password, the API key, or any customer identifier.

`.gitignore` covers `src/secrets.h`, `.env` files and build output.

---

## Serial output

At boot:

```
========================================
Stride Guide Device
========================================
Firmware:        0.1.0 (schema 1.0, hardware breadboard-r0)
Device ID:       dev-esp32-unprovisioned (serial SG-DEV-000000)
Simulation Mode: ON - synthetic sensor data, no hardware required
Pressure Matrix: 25x25 (625 cells), 13.0 mm pitch, 6.5 mm trace, 318.5 x 318.5 mm active copper; row mux x2 (25 lines), col mux x2 (25 lines)
HX711:           simulated (55-105 kg), no hardware required
Wi-Fi:           CHANGE_ME_SSID (not connected)
API:             POST https://api.example.invalid/api/v1/events
Calibration:     version=uncalibrated pressure_zero=no weight=default factor=22000.0
Tenancy:         org=org-unassigned location=loc-unassigned
WARNING:         placeholder credentials in use - copy src/secrets.example.h to src/secrets.h before deploying
========================================
Commands: s=scan  z=zero matrix  t=tare  c<kg>=calibrate weight  w=save cal  h=health  i=info  r=reset cal
```

During a scan:

```
Scan started
Weight: 78.42 kg
Active sensors: 221 / 625
Pressure min/max: 0 / 3422 (avg 410.2, 0 saturated)
Scan duration: 312 ms
Upload status: OK (HTTP 202)
Scan complete
```

---

## After the PCB arrives

Tracked in-tree as `TODO(...)` markers — `grep -rn "TODO(" src/`.

- **`TODO(pcb)`** — replace the bring-up GPIO map in `config.h` §5 and §8 with
  the production assignment; add a `stride_pcb` build environment. Confirm the
  mux device count and per-device channel counts against the real board. The
  §4 geometry is already confirmed and needs no further change.
- **`TODO(calibration)`** — characterise Velostat response (non-linearity,
  creep, temperature drift) and replace the single active threshold with a
  per-unit curve. Measure and correct matrix crosstalk: resistive matrices leak
  current through unselected sensels, and the sneak-path error needs either
  actively grounded columns or a driven-guard readout.
- **`TODO(calibration)`** — capture the HX711 counts-per-kg factor per unit at
  manufacture and write it to NVS during provisioning, so a unit is calibrated
  before it ships.
- **`TODO(auth)`** — per-device credentials and signed events (the data model's
  `device.public_key`), plus certificate pinning for the API host. No static
  bearer token in production.
- **`TODO(offline)`** — back the event queue with flash so a buffered scan
  survives a power cut, and size it for a full retail day.
- **`TODO(ota)`** — signed over-the-air updates with rollback, reporting the
  running version through the health event.

Also outstanding: a scan trigger appropriate to the retail floor rather than a
dev-board button, and a decision on whether the device or the tablet owns the
association between a scan and a fitting session.

One consequence of the confirmed geometry is worth stating plainly: the active
area is 318.5 mm square, and an adult foot is roughly 260–280 mm long by 95–100
mm wide. Two feet side by side need about 200 mm of width, so they fit, but
with little room for a wide stance or a large foot placed off-centre. If
two-foot capture at full stance width matters, that is a platform-size
conversation rather than a firmware one.
