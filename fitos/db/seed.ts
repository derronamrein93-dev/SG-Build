/**
 * Pilot seed. Runs as fitos_svc — the service role — because RLS is FORCEd and
 * even the table owner cannot write past it.
 */
import { withService } from '../src/lib/db/client';
import { normalizePhone, phoneLookupHash, last4, PHONE_KEY_VERSION } from '../src/lib/db/identity';

const ORG = 'aaaaaaaa-0000-0000-0000-000000000001';
const LOC = 'aaaaaaaa-1111-0000-0000-000000000001';
const LOC2 = 'aaaaaaaa-1111-0000-0000-000000000002';

const CATALOG = [
  ['Meridian', 'Shift Work 6"', 'work_support', 'stability', 'plush', ['standard','wide','extra_wide'], 'wide_round', 'structured', true, 164.95, ['long shifts on concrete','wide forefoot']],
  ['Meridian', 'Shift Work Slip-On', 'work_support', 'light_stability', 'plush', ['standard','wide'], 'standard', 'soft', true, 139.95, ['easy on and off']],
  ['Corvid', 'Anchor GTS', 'running_stability', 'stability', 'plush', ['standard','wide'], 'standard', 'structured', true, 149.95, ['inward roll','daily mileage']],
  ['Corvid', 'Glide Neutral 14', 'running_neutral', 'neutral', 'plush', ['standard','wide'], 'standard', 'standard', true, 144.95, ['neutral gait','high mileage']],
  ['Corvid', 'Glide Wide 14', 'running_neutral', 'neutral', 'plush', ['wide','extra_wide'], 'wide_round', 'standard', true, 149.95, ['wide feet','neutral gait']],
  ['Northmoor', 'Camber Walker', 'walking_comfort', 'light_stability', 'plush', ['standard','wide'], 'roomy', 'standard', true, 129.95, ['all-day walking','smooth transition']],
  ['Northmoor', 'Camber Max', 'walking_comfort', 'stability', 'max', ['standard','wide','extra_wide'], 'wide_round', 'structured', true, 154.95, ['maximum cushioning','wide fit']],
  ['Alder', 'Ridge Mid', 'hiking', 'stability', 'moderate', ['standard','wide'], 'standard', 'structured', true, 179.95, ['uneven ground','ankle support']],
  ['Alder', 'Ridge Low GTX', 'hiking', 'stability', 'moderate', ['standard'], 'standard', 'structured', false, 189.95, ['wet conditions']],
  ['Selby', 'Haven Comfort', 'orthopedic_friendly', 'light_stability', 'plush', ['standard','wide','extra_wide'], 'wide_round', 'soft', true, 159.95, ['sensitive feet','seam-free interior','extra depth']],
  ['Selby', 'Haven Stretch', 'orthopedic_friendly', 'neutral', 'plush', ['wide','extra_wide'], 'wide_round', 'soft', true, 149.95, ['bunion accommodation','stretch upper']],
  ['Kestrel', 'Day Court', 'court_sport', 'stability', 'firm', ['standard'], 'tapered', 'structured', true, 119.95, ['lateral movement']],
];

async function main() {
  await withService(async (c) => {
    await c.query('delete from organization');
    await c.query('delete from product_model');

    await c.query(
      `insert into organization (id,name,org_type,plan,default_customer_access,identity_participation,data_owner_terms_version)
       values ($1,'Northside Running Co.','independent','design_partner','creating_location','none','terms-v1')`, [ORG]);

    await c.query(
      `insert into location (id,organization_id,name,address_line1,city,region,postal_code,phone,email,timezone,retail_focus,pos_system,inventory_source,tracks_associate_attribution,network_quality)
       values ($1,$2,'Northside — Grand Ave','1420 Grand Ave','Saint Paul','MN','55105','(612) 555-0148','hello@northside.test','America/Chicago','{running,comfort}','Lightspeed R-Series','csv',true,'variable'),
              ($3,$2,'Northside — Lakeview','88 Lake St','Minneapolis','MN','55408','(612) 555-0149','lakeview@northside.test','America/Chicago','{running}','Lightspeed R-Series','csv',true,'good')`,
      [LOC, ORG, LOC2]);

    await c.query(
      `insert into app_user (id,location_id,organization_id,first_name,last_name,role) values
       ('aaaaaaaa-2222-0000-0000-000000000001',$1,$2,'Denise','Okonkwo','associate'),
       ('aaaaaaaa-2222-0000-0000-000000000002',$1,$2,'Marcus','Hale','associate'),
       ('aaaaaaaa-2222-0000-0000-000000000003',$1,$2,'Ray','Whitfield','owner')`, [LOC, ORG]);

    for (const [brand, model, category, support, cushion, widths, toeBox, heel, removable, msrp, bestFor] of CATALOG) {
      const { rows } = await c.query(
        `insert into product_model (brand,model,category,use_case,support_level,cushioning_level,
           toe_box_shape,heel_structure,volume,removable_insole,best_for,msrp,data_source,verified_at)
         values ($1,$2,$3,'{}',$4,$5,$6,$7,'standard',$8,$9,$10,'curated',now()) returning id`,
        [brand, model, category, support, cushion, toeBox, heel, removable, bestFor as string[], msrp]);
      await c.query(
        `insert into location_inventory (location_id,organization_id,product_model_id,widths_stocked,size_low,size_high,retail_price,stocked,source)
         values ($1,$2,$3,$4,6,15,$5,true,'manual')`,
        [LOC, ORG, rows[0].id, widths as string[], msrp]);
    }

    // A returning customer, so the second-visit experience is demonstrable.
    const phone = normalizePhone('612-555-4417')!;
    const { rows: cust } = await c.query(
      `insert into organization_customer
        (organization_id,created_at_location_id,first_name,last_name,phone_lookup_hash,phone_encrypted,phone_last4,phone_key_version,identification_method)
       values ($1,$2,'Marisol','Alvarez',$3,$4,$5,$6,'phone') returning id`,
      [ORG, LOC, phoneLookupHash(ORG, phone), Buffer.from(phone), last4(phone), PHONE_KEY_VERSION]);

    await c.query(
      `insert into consent_record (scope,organization_customer_id,location_id,type,granted,consent_text_version,privacy_policy_version,method,captured_by_user_id)
       values ('organization',$1,$2,'fit_history_storage',true,'consent-fit-v1.0','privacy-v1.0','tablet_checkbox','aaaaaaaa-2222-0000-0000-000000000001'),
              ('organization',$1,$2,'privacy_ack',true,'consent-fit-v1.0','privacy-v1.0','tablet_checkbox','aaaaaaaa-2222-0000-0000-000000000001')`,
      [cust[0].id, LOC]);

    const { rows: sess } = await c.query(
      `insert into fitting_session
        (organization_id,location_id,organization_customer_id,user_id,status,visit_number,started_at,completed_at,
         shopping_purpose,discomfort_area,standing_hours_per_day,fit_priority,time_to_recommendation_ms)
       values ($1,$2,$3,'aaaaaaaa-2222-0000-0000-000000000001','completed',1, now() - interval '61 days', now() - interval '61 days',
         'work','{heel}','8_plus','{comfort,durability}',148000) returning id`,
      [ORG, LOC, cust[0].id]);

    await c.query(
      `insert into assessment (fitting_session_id,size_left,size_right,width,arch_type,pronation_tendency,wear_pattern,assessment_notes)
       values ($1,10.5,11,'wide','low','mild_inward','inner_edge','Sized to the right foot; volume insert on the left.')`,
      [sess[0].id]);

    await c.query(
      `insert into follow_up (organization_id,location_id,organization_customer_id,fitting_session_id,follow_up_reason,follow_up_due_at,follow_up_status)
       values ($1,$2,$3,$4,'90-day re-scan invitation', now() + interval '2 days','scheduled'),
              ($1,$2,$3,$4,'Comfort check-in', now() - interval '1 day','scheduled')`,
      [ORG, LOC, cust[0].id, sess[0].id]);

    const counts = await c.query(
      `select (select count(*) from product_model) models,
              (select count(*) from location_inventory) stocked,
              (select count(*) from organization_customer) customers,
              (select count(*) from fitting_session) sessions`);
    console.log('seeded:', counts.rows[0]);
  });
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
