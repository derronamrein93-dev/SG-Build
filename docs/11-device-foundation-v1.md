# FitOS Device Foundation v1 — ESP32-S3 to Retail Station

**Status: bring-up / protocol foundation only. Not a connected scanner.**

## Hardware revision reconciliation — October 9, 2026

**Confirmed by founder:** the active bring-up controller is an **ESP32-S3 development unit**. The prior EasyEDA JSON (`SCH_SGMVP_2026-08-05(1).json`) describes a **different/older ESP32-WROOM-32U design**. Do not use that schematic for S3 GPIO assignments.

**Newer source:** uploaded Flux export `SG_MVP_GBRs(1).zip`, project `Stride Guide MVP Controller`, revision `#8b50d75e`, dated August 3, 2026. Its BOM specifies:
- U1: **ESP32-S3-WROOM-1-N16R8** (integrated module; the separately used S3 dev board's exact pinout remains to be confirmed).
- U4, U5, U10, U11: **four CD74HC4067M96** analog multiplexers.
- U6: **one HX711** ADC IC, not four HX711 devices.
- U3: AP2112K-3.3TRG1 regulator; U2: LM66100-Q1; J9: USB4105-GF-A.
- Headers/connectors J1–J14 and other passives, see BOM.

**Critical PCB export warning:** `stride-guide-mvp-controller-edge_cuts.gbr` outlines approximately **160 mm × 10 mm**, from x=10.045..170.045 mm, y=-110..-100 mm. The supplied `pick_and_place.csv` lists **50 component centers**, of which **only two** (C9 and C10) fall within those outline bounds. Components extend from x=-72.175..113.0859 mm and y=-184.2603..-56.93 mm. This suggests the export's board outline and component placement are inconsistent. **Do not submit these Gerbers for manufacturing without opening the design in the source CAD tool, resolving outline/placement, and passing DRC/fabrication checks.** This is an export-level geometry check, not a full electrical DRC.

**Firmware implication:** keep the ESP32-S3 Arduino heartbeat sketch as the correct controller family. It is still a **non-measuring bring-up sketch**. Do not assume the dev-board GPIO mapping equals the integrated-module PCB routing. Obtain the Flux schematic/netlist and confirm the exact S3 development-board variant and external wiring before implementing multiplexed analog reads, HX711 sampling, or calibration.

**Unresolved:** actual 24×24 matrix circuit topology; mux select/enable and signal GPIOs; ADC input pins and voltage levels; HX711 DOUT/SCK wiring and whether four load cells share a bridge/one HX711; physical USB connection and device provisioning. A BOM and Gerber package alone do not settle these questions.

## Existing foundations (preserved)

- `scan` and `scan_derivation` already store capture provenance and derived measurements.
- `device`, `device_installation`, and `device_health_event` already represent deployed stations.
- `fitting_feature` is the canonical boundary between sensor observations and the rules engine.
- The existing tenant-aware Postgres access pattern must remain intact. No sensor endpoint may use the service role with untrusted IDs.

## Architecture

```text
24x24 sensor matrix + 4 load cells
          |
          v
ESP32-S3 firmware (scan, calibration, health; not implemented yet)
          |
          | USB CDC NDJSON first; Wi-Fi/BLE transport later
          v
Android station gateway (not implemented)
          |  signed device/session association + bounded capture
          v
FitOS authenticated device-ingest API (not implemented)
          |  tenant + installation + active fitting checks
          v
raw object storage -> scan -> scan_derivation -> fitting_feature
                                             |
                                      recommendations + reports
```

**FitOS is a dedicated Android kiosk experience, not a custom kernel.** The
Android app may wrap the FitOS web UI, but native USB access requires a native
bridge. A browser alone cannot be assumed to support USB serial on Android.

## What this change actually adds

1. `firmware/esp32-s3/strideguide_s3/strideguide_s3.ino`: a safe, non-measuring
   USB serial heartbeat. It emits `state=unconfigured` until hardware is verified.
2. `fitos/src/lib/device/protocol.ts`: strict parser and line decoder for
   `sg.v1` status and raw scan frames.
3. `fitos/src/lib/device/protocol.test.ts`: synthetic protocol tests.

No ADC scan, HX711 driver, calibrated plantar pressure, live heatmap, remote
maintenance, OTA, device pairing, or database ingest is claimed by this change.

## Protocol: USB CDC, one JSON object per line

Status heartbeat example (illustrative):

```json
{"protocol":"sg.v1","kind":"status","device_serial":"SG-UNPROVISIONED","sequence":0,"uptime_ms":1000,"firmware_version":"0.1.0","hardware_revision":"pending","calibration_version":"none","state":"unconfigured","error_code":null}
```

Future **raw** scan frame shape:

```json
{"protocol":"sg.v1","kind":"scan","device_serial":"SG-001","sequence":1,"uptime_ms":1200,"firmware_version":"0.2.0","hardware_revision":"rev-a","calibration_version":"cal-1","capture_type":"static_stance","rows":24,"columns":24,"matrix":[576 unsigned ADC counts],"load_cells_raw":[0,0,0,0]}
```

The bracketed matrix above is explanatory notation, **not valid JSON**.
Actual frames contain exactly 576 integers in row-major order, 0–4095,
and four signed 32-bit raw load-cell counts. The 12-bit range is a **provisional
protocol decision** pending ADC and circuit confirmation; change with a
version bump if the final hardware requires another representation.

No name, phone number, store identity, customer ID, or consent token travels
in ESP32 frames. A device serial is an untrusted claim until verified by the
station/gateway. No raw scan is treated as calibrated pressure or medical data.

## Before implementing actual acquisition: mandatory hardware review

Confirm from the **current** PCB schematic and assembled board:

- ESP32-S3 module variant, power rails, ADC reference, GPIO assignments,
  strapping pins, and available USB CDC interface.
- Matrix dimensions and actual row/column addressing (24×24 is the
  software target, not yet proof of the assembled hardware).
- Velostat matrix excitation, mux count/channel assignments, settling time,
  ghosting/crosstalk mitigation, and analog readout design.
- Four load-cell wiring, HX711 count, DOUT/SCK pins, excitation and gain.
- Whether each of the 576 nodes can be read with sufficient repeatability.
- Sampling target, ADC dynamic range, pressure calibration fixtures and
  independent scale accuracy reference.
- Per-device serial provisioning, calibration storage, fault detection and
  recovery after power loss.

Do not generate simulated foot readings in production or report a successful
scan without a real calibrated capture.

## Next implementation slices

### A. Firmware acquisition

Hardware abstraction layer: matrix scanner + HX711 drivers + calibration
metadata + fault states + bounded capture. Validate timing and measurement
repeatability on the actual board. A unit must never emit `ready` unless the
self-test and calibration gates pass.

### B. Android station gateway

Android kiosk with a native USB serial adapter (or a separately justified
network transport), explicit pairing, frame sequencing, reconnect handling,
bounded local queue, offline recovery, and operator-visible status. Device
connection is not customer authorization.

### C. Secure FitOS ingest

Provision a per-device credential, authenticate it, bind it to an active
`device_installation`, resolve the location and organization on the server,
and require an authorized active fitting. Enforce frame size, rate, sequence,
time windows, and capture quality. Store raw frames in protected object
storage; persist only its URI and checksum in `scan`. Write versioned
`scan_derivation` records and approved `fitting_feature` observations.
Maintain strict tenant isolation and avoid raw payloads in logs/analytics.

**Do not add an unauthenticated `/api/device/ingest` route as a shortcut.**

### D. Maintenance request workflow

A retailer should be able to tap **Request Maintenance** in FitOS. The
request should bind to its authorized installation, record description,
severity, consent to attach diagnostics, and an audit trail. Add a separate
`maintenance_ticket` schema with tenant/location scope and status history.
No customer PII, raw pressure data or report tokens in diagnostic bundles.
Technician actions must be authenticated, narrowly scoped and logged;
firmware OTA must be signed and explicitly authorized.

### E. Home product compatibility

Keep the firmware wire contract hardware-oriented. Residential deployment
will need household ownership, explicit consent, separate identity and
retention rules, and potentially a distinct hardware revision. Do not attach
home devices to a fictitious retail `organization` just to reuse the schema.
Avoid diagnostic or injury-prediction claims without validation and regulatory
review.

## Run the parser tests

From `fitos/`:

```bash
npm ci
npm test
```

Arduino IDE: install the ESP32 board support package, select the correct
ESP32-S3 board, enable USB CDC on boot if appropriate for that board, upload
the sketch, and open Serial Monitor at 115200 baud. A successful bring-up
shows `unconfigured` heartbeat frames, **not** pressure measurements.

## Explicit go/no-go gate

No live hardware data pipeline until PCB pinout is verified, acquisition
produces real repeatable measurements, calibration is characterized, device
identity is authenticated, and the Android gateway's tenant/session mapping
passes isolation and offline tests.
