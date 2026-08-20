'use server';

/**
 * Server-action boundary. Thin on purpose: every one of these delegates to
 * src/lib/fitting/mutations.ts, which is importable by tests and therefore
 * drivable as `fitos_app` — the role the tablet actually runs as, and the one
 * no test exercised until a browser walk found customer creation broken under
 * its policy.
 */
import { revalidatePath } from 'next/cache';
import { currentContext } from '../lib/session';
import { writeIntake } from '../lib/intake/save';
import { writeAssessment, buildRecommendation, finishFitting, writeFeedback }
  from '../lib/fitting/mutations';
import { loadCatalog } from '../lib/queries';

/** Debounced autosave target. Every field write lands here; there is no Save button. */
export async function saveIntake(sessionId: string, patch: Record<string, unknown>) {
  return writeIntake(currentContext(), sessionId, patch);
}

export async function saveAssessment(sessionId: string, patch: Record<string, unknown>) {
  return writeAssessment(currentContext(), sessionId, patch);
}

export async function computeRecommendation(sessionId: string) {
  return buildRecommendation(currentContext(), sessionId, await loadCatalog());
}

export async function completeFitting(sessionId: string, overrides?: Record<string, string>) {
  const result = await finishFitting(currentContext(), sessionId, await loadCatalog(), overrides);
  revalidatePath('/');
  return result;
}

export async function logFeedback(type: string, screen: string, note: string, sessionId?: string) {
  return writeFeedback(currentContext(), type, screen, note, sessionId);
}
