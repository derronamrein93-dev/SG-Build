/**
 * Tenant context for the current request.
 *
 * The prototype resolves a seeded location and associate. Real auth plugs in
 * here and nowhere else: every query already goes through withTenant(), so
 * swapping this for a session lookup does not touch a single page.
 */
import type { TenantContext } from './db/client';

export const DEMO = {
  organizationId: 'aaaaaaaa-0000-0000-0000-000000000001',
  locationId: 'aaaaaaaa-1111-0000-0000-000000000001',
  userId: 'aaaaaaaa-2222-0000-0000-000000000001',
};

export function currentContext(): TenantContext {
  return { ...DEMO };
}
