/**
 * The store's assortment, as the recommendation engine consumes it.
 *
 * Not `server-only`: mutations.test.ts drives the real recommendation path as
 * `fitos_app`, and a second copy of this query written for tests would drift
 * from this one and quietly test nothing.
 *
 * The context is a parameter with a default so the app calls it unchanged while
 * a test can pass an explicit tenant.
 */
import { withTenant, type TenantContext } from './db/client';
import { currentContext } from './session';
import type { CatalogItem } from './rules/engine';

export async function loadCatalog(ctx: TenantContext = currentContext()): Promise<CatalogItem[]> {
  return withTenant(ctx, async (c) => {
    const { rows } = await c.query(
      `select p.id, p.brand, p.model, p.category, p.support_level, p.cushioning_level,
              p.toe_box_shape, p.heel_structure, p.volume, p.removable_insole, p.best_for,
              i.widths_stocked
         from location_inventory i join product_model p on p.id = i.product_model_id
        where i.location_id = $1 and i.stocked`, [ctx.locationId]);
    return rows.map((r) => ({
      productModelId: r.id, brand: r.brand, model: r.model, category: r.category,
      supportLevel: r.support_level, cushioningLevel: r.cushioning_level,
      widthsStocked: r.widths_stocked ?? [], toeBoxShape: r.toe_box_shape,
      heelStructure: r.heel_structure, volume: r.volume,
      removableInsole: r.removable_insole, bestFor: r.best_for ?? [],
    }));
  });
}