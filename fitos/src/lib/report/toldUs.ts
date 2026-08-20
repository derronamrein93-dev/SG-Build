/**
 * "What you told us" — docs/04 §2 block 5.
 *
 * Reflecting the customer's own answers back is what makes the report feel
 * personalised and traceable: every recommendation below it can be checked
 * against something they actually said. Only present values are emitted — an
 * empty row reads as a form the associate failed to fill in.
 */
export interface ToldUsItem { label: string; value: string; }

const WORDS: Record<string, Record<string, string>> = {
  purpose: {
    running: 'Running', walking: 'Walking', work: 'Work', casual: 'Everyday wear',
    orthopedic: 'All-day comfort', kids: 'Kids', sports: 'Sport', hiking: 'Hiking',
  },
  area: {
    heel: 'Heel', arch: 'Arch', ball_of_foot: 'Ball of foot', toes: 'Toes',
    ankle: 'Ankle', knee: 'Knee', hip_back: 'Hip or back', none: 'No pain reported',
  },
  priority: {
    comfort: 'Comfort', support: 'Support', performance: 'Performance',
    durability: 'Durability', style: 'Style', price: 'Price',
  },
  hours: {
    under_2: 'Under 2 hours a day', '2_4': '2–4 hours a day',
    '4_8': '4–8 hours a day', '8_plus': '8+ hours a day',
  },
  activity: {
    light: 'Light activity', moderate: 'Moderate activity',
    active: 'Active', very_active: 'Very active',
  },
  problem: {
    hurts: 'Hurts after a while', never_fit: 'Never fit right', worn_out: 'Worn out',
    too_tight: 'Too tight', too_loose: 'Too loose', heel_slips: 'Heel slips',
    rubs_blisters: 'Rubbing or blisters', not_enough_support: 'Not enough support',
    not_enough_cushion: 'Not enough cushioning', replacing: 'Replacing a worn pair',
  },
  orthotics: { no: 'No', custom: 'Yes — custom orthotics', otc: 'Yes — over-the-counter inserts' },
  wear: {
    even: 'Even wear', outer_edge: 'Outer edge', inner_edge: 'Inner edge',
    heel: 'Heel', uneven_lr: 'Uneven left to right', unsure: 'Not sure',
  },
};

const look = (group: string, key: unknown) =>
  typeof key === 'string' ? WORDS[group]?.[key] : undefined;

const listOf = (group: string, values: unknown, max = 2) =>
  Array.isArray(values)
    ? values.map((v) => look(group, v)).filter(Boolean).slice(0, max).join(', ')
    : '';

const yesNo = (v: unknown) => (v === true ? 'Yes' : v === false ? 'No' : undefined);

export function buildToldUs(session: Record<string, any>): ToldUsItem[] {
  const items: ToldUsItem[] = [];
  const push = (label: string, value?: string) => { if (value) items.push({ label, value }); };

  // The quick intake first — these are the questions actually asked in the
  // default flow, so they lead. Null means "not asked", which prints nothing:
  // a blank line reads as a question the associate skipped.
  push('Foot discomfort reported', yesNo(session.intake_discomfort));
  push('Current shoe discomfort or pressure', yesNo(session.intake_shoe_issue));
  push('High activity or extended standing', yesNo(session.intake_high_activity));
  push('New discomfort since last visit', yesNo(session.intake_new_discomfort_since_last));
  push('Activity or use changed since last visit', yesNo(session.intake_use_changed_since_last));

  // Everything below comes from the optional Add detail panel. Still read, still
  // printed when present, never required.
  push('Shopping for', look('purpose', session.shopping_purpose));
  push('Where it bothers you', listOf('area', session.discomfort_area));
  push('What matters most', listOf('priority', session.fit_priority));
  push('Time on your feet', look('hours', session.standing_hours_per_day)
    ?? look('activity', session.activity_level));
  push('Current shoes', listOf('problem', session.current_shoe_problem)
    || look('wear', session.shoe_wear_concern));
  // Only when they told us — absence is not "No".
  if (session.uses_orthotics && session.uses_orthotics !== 'no') {
    push('Inserts or orthotics', look('orthotics', session.uses_orthotics));
  }
  return items;
}
