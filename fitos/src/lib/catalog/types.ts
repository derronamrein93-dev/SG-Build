/** Catalog vocabulary. The engine's internal values, unchanged. */
export const CATALOG_CATEGORIES = [
  'running_neutral', 'running_stability', 'walking_comfort', 'work_support',
  'work_safety', 'hiking', 'casual_comfort', 'orthopedic_friendly',
  'court_sport', 'kids',
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];
