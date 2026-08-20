/**
 * secrets.example.h - template for src/secrets.h.
 *
 *   cp src/secrets.example.h src/secrets.h
 *
 * src/secrets.h is git-ignored and is included at the end of config.h, so
 * anything defined here overrides the placeholders. Never commit real
 * credentials, and never print them over Serial.
 *
 * TODO(auth): this file is a bring-up mechanism. Production units should be
 * provisioned with per-device credentials written to NVS at manufacture rather
 * than compiled into a firmware image shared across a fleet.
 */

#ifndef STRIDE_SECRETS_H
#define STRIDE_SECRETS_H

// --- Wi-Fi -----------------------------------------------------------------

#undef STRIDE_WIFI_SSID
#define STRIDE_WIFI_SSID "your-network-ssid"

#undef STRIDE_WIFI_PASSWORD
#define STRIDE_WIFI_PASSWORD "your-network-password"

// --- Stride Guide event API -------------------------------------------------

#undef STRIDE_API_BASE_URL
#define STRIDE_API_BASE_URL "https://api.strideguide.example"

#undef STRIDE_API_KEY
#define STRIDE_API_KEY "your-device-api-key"

// --- Device identity ---------------------------------------------------------
//
// Assigned per unit at provisioning. The values below are what the SaaS side
// uses to attribute a scan, so they must match the device record.

#undef DEVICE_ID
#define DEVICE_ID "dev-0001"

#undef DEVICE_SERIAL
#define DEVICE_SERIAL "SG-0001-000001"

// --- Tenancy -----------------------------------------------------------------
//
// Set at installation time, not at manufacture: a device that moves between
// locations gets a new installation record.

#undef STRIDE_ORGANIZATION_ID
#define STRIDE_ORGANIZATION_ID "org-0001"

#undef STRIDE_LOCATION_ID
#define STRIDE_LOCATION_ID "loc-0001"

#endif  // STRIDE_SECRETS_H
