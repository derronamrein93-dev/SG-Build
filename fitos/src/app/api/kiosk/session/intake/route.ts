/**
 * POST /api/kiosk/session/intake — the three yes/no answers.
 *
 * Writes through the existing allowlist in src/lib/intake/save.ts. The kiosk
 * asks the same questions the associate app asks, in the same columns, so a
 * kiosk fitting and a counter fitting produce the same feature set.
 */
import { handle, json, readJson, requireKiosk } from '../../../../../lib/kiosk/api';
import { saveKioskIntake } from '../../../../../lib/kiosk/session';
import { QUICK_INTAKE_FIELDS } from '../../../../../lib/intake/questions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle('intake', req, async () => {
    const identity = await requireKiosk(req);
    const body = await readJson<Record<string, unknown>>(req);
    const answers = (body.answers ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { intake_mode: 'quick' };
    for (const field of QUICK_INTAKE_FIELDS) {
      if (typeof answers[field] === 'boolean') patch[field] = answers[field];
    }
    await saveKioskIntake(identity, String(body.sessionId ?? ''), patch);
    return json({ ok: true });
  });
}
