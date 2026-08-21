/**
 * Kiosk and Stride Guide provisioning, from a terminal.
 *
 * This is the operator side of enrollment, and it is a CLI rather than a screen
 * for one reason: FitOS has no authentication yet (src/lib/session.ts returns a
 * seeded context, and the README says so). A web page that mints kiosk
 * credentials would therefore be a page anyone who can reach the server can
 * open, which is a worse thing to build than a command that requires database
 * access to run.
 *
 * When auth lands, this becomes an authorized-admin screen and the functions it
 * calls do not change — they already take an explicit tenant context and derive
 * nothing from the caller.
 *
 *   npm run kiosk:enroll -- list
 *   npm run kiosk:enroll -- provision SG-A19F         # a Stride Guide unit
 *   npm run kiosk:enroll -- ingest SG-A19F            # its telemetry token
 *   npm run kiosk:enroll -- code "Northside Front"    # a kiosk enrollment code
 *   npm run kiosk:enroll -- code "Northside Front" SG-A19F
 *   npm run kiosk:enroll -- revoke <kiosk-device-id>
 */
import { randomUUID } from 'crypto';
import { withTenant, withService, closePool } from '../src/lib/db/client';
import { currentContext } from '../src/lib/session';
import { createEnrollmentCode, revokeKioskDevice, ENROLLMENT_CODE_TTL_MINUTES } from '../src/lib/kiosk/device';
import { provisionIngestToken } from '../src/lib/kiosk/ingest';

const ctx = currentContext();

async function list() {
  const rows = await withTenant(ctx, async (c) => {
    const kiosks = await c.query(
      `select k.id, k.display_name, k.status, k.last_seen_at, k.app_version, d.serial
         from kiosk_device k
         left join device d on d.id = k.stride_guide_device_id
        where k.location_id = $1 order by k.enrolled_at`, [ctx.locationId]);
    const units = await c.query(
      `select d.serial, d.status, i.installed_at, (i.ingest_token_hash is not null) as has_token
         from device_installation i join device d on d.id = i.device_id
        where i.location_id = $1 and i.removed_at is null order by i.installed_at`, [ctx.locationId]);
    return { kiosks: kiosks.rows, units: units.rows };
  });
  console.log('\nKiosks');
  if (!rows.kiosks.length) console.log('  (none)');
  for (const k of rows.kiosks) {
    console.log(`  ${k.id}  ${k.status.padEnd(9)} ${k.display_name}` +
      `  hardware=${k.serial ?? '—'}  app=${k.app_version ?? '—'}  seen=${k.last_seen_at ?? 'never'}`);
  }
  console.log('\nStride Guide units');
  if (!rows.units.length) console.log('  (none)');
  for (const u of rows.units) {
    console.log(`  ${u.serial}  ${u.status.padEnd(11)} ingest_token=${u.has_token ? 'set' : 'not set'}`);
  }
  console.log();
}

/** Create a Stride Guide unit and install it at this location. */
async function provision(serial: string) {
  const deviceId = randomUUID();
  await withService(async (c) => {
    await c.query(
      `insert into device (id, serial, hardware_revision, status, current_firmware_version, current_calibration_version)
       values ($1,$2,'sg-rev-b','installed','0.4.2','cal-2024-11')
       on conflict (serial) do update set status = 'installed'`, [deviceId, serial]);
    const { rows } = await c.query('select id from device where serial = $1', [serial]);
    await c.query(
      `insert into device_installation (device_id, organization_id, location_id)
       select $1,$2,$3 where not exists (
         select 1 from device_installation
          where device_id = $1 and location_id = $3 and removed_at is null)`,
      [rows[0].id, ctx.organizationId, ctx.locationId]);
    console.log(`installed ${serial} at ${ctx.locationId}`);
  });
}

async function ingest(serial: string) {
  const deviceId = await withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `select d.id from device d join device_installation i on i.device_id = d.id
        where d.serial = $1 and i.location_id = $2 and i.removed_at is null limit 1`,
      [serial, ctx.locationId]);
    if (!rows.length) throw new Error(`${serial} is not installed at this location — run provision first`);
    return rows[0].id as string;
  });
  const token = await provisionIngestToken(ctx, deviceId);
  console.log('\nIngest token (shown once — put it in the bridge configuration):\n');
  console.log(`  ${token}\n`);
  console.log('  curl -X POST http://127.0.0.1:3000/api/hardware/telemetry \\');
  console.log(`       -H "Authorization: Bearer ${token}" \\`);
  console.log('       -H "Content-Type: application/json" -d \'{"matrixReady":true,...}\'\n');
}

async function code(displayName: string, serial?: string) {
  let strideGuideDeviceId: string | null = null;
  if (serial) {
    strideGuideDeviceId = await withTenant(ctx, async (c) => {
      const { rows } = await c.query(
        `select d.id from device d join device_installation i on i.device_id = d.id
          where d.serial = $1 and i.location_id = $2 and i.removed_at is null limit 1`,
        [serial, ctx.locationId]);
      if (!rows.length) throw new Error(`${serial} is not installed at this location`);
      return rows[0].id as string;
    });
  }
  const { code, expiresAt } = await createEnrollmentCode(ctx, { displayName, strideGuideDeviceId });
  console.log('\nEnrollment code (single use, shown once):\n');
  console.log(`  ${code}\n`);
  console.log(`  expires ${expiresAt}  (${ENROLLMENT_CODE_TTL_MINUTES} minutes)`);
  console.log('  Type it on the iPad at /kiosk → Enter Device Code.\n');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'list' || !command) await list();
    else if (command === 'provision') await provision(args[0]);
    else if (command === 'ingest') await ingest(args[0]);
    else if (command === 'code') await code(args[0], args[1]);
    else if (command === 'revoke') { await revokeKioskDevice(args[0]); console.log('revoked', args[0]); }
    else { console.error(`unknown command "${command}"`); process.exitCode = 2; }
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
