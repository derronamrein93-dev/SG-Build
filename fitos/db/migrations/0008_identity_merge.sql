-- =============================================================================
-- 0008 · identity merge primitive
--
-- Duplicates happen: the customer who gave a mobile in March and a landline in
-- June is two records. This resolves them without losing fitting history,
-- consent history, reports, follow-ups or auditability.
--
-- The merged-away record is NEVER deleted. Two schema facts make that
-- structural rather than stylistic:
--
--   1. phone_lookup_hash lives on organization_customer as a column, so the
--      survivor cannot absorb the other record's number — there is nowhere to
--      put it. The tombstone is the only thing that can carry that hash and
--      redirect a lookup on it.
--   2. fitting_session.organization_customer_id is ON DELETE SET NULL while the
--      other five references cascade, so deleting a customer would orphan their
--      fitting history rather than remove it.
-- =============================================================================

alter table organization_customer
  add column merged_into_customer_id uuid references organization_customer(id),
  add column merged_at               timestamptz;

alter table organization_customer
  add constraint organization_customer_merge_consistent
    check ((merged_into_customer_id is null) = (merged_at is null)),
  add constraint organization_customer_no_self_merge
    check (merged_into_customer_id is null or merged_into_customer_id <> id);

create index organization_customer_merged
  on organization_customer (merged_into_customer_id)
  where merged_into_customer_id is not null;

-- ── Resolver ────────────────────────────────────────────────────────────────
-- One hop, not recursive: chains are refused at merge time, so a second hop
-- would be unreachable code pretending to be robustness. Invoker rights, so a
-- foreign tenant's id resolves to itself and then fails the usual policies.
create or replace function app_resolve_customer(candidate uuid) returns uuid as $$
  select coalesce(
    (select merged_into_customer_id from organization_customer
      where id = candidate and merged_into_customer_id is not null),
    candidate)
$$ language sql stable;

-- ── A fitting may never attach to a tombstone ───────────────────────────────
-- Enforced by trigger rather than in application code: this must hold for the
-- seed, for a psql session, and for any future write path, not only for the one
-- function that exists today.
create or replace function fitting_session_reject_tombstone() returns trigger as $$
begin
  if new.organization_customer_id is not null
     and exists (select 1 from organization_customer
                  where id = new.organization_customer_id
                    and merged_into_customer_id is not null) then
    raise exception
      'customer % has been merged into another record; start the fitting on the surviving customer',
      new.organization_customer_id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$ language plpgsql;

create trigger fitting_session_no_tombstone
  before insert or update of organization_customer_id on fitting_session
  for each row execute function fitting_session_reject_tombstone();

-- ── Effective consent, per type, for one or two customers ───────────────────
-- Same resolution rule as the Step 4 chokepoint: latest row wins, and at equal
-- captured_at a withdrawal beats a grant. Duplicated here rather than shared
-- because the chokepoint answers for one customer and this must answer for the
-- union of two.
create or replace function app_effective_consent(customers uuid[])
returns table (consent consent_type, granted boolean) as $$
  select distinct on (type) type, granted
    from consent_record
   where organization_customer_id = any(customers)
   order by type, captured_at desc, granted asc
$$ language sql stable;

-- ── The merge ───────────────────────────────────────────────────────────────
create or replace function app_merge_customer(
  loser uuid, winner uuid, actor uuid, correlation uuid,
  confirm_marketing_flip boolean default false)
returns jsonb as $$
declare
  org_loser uuid; org_winner uuid;
  loser_merged uuid; winner_merged uuid;
  manifest jsonb; flips text[]; withdrawals text[]; marketing_flips text[];
begin
  if loser = winner then
    raise exception 'cannot merge a customer into itself';
  end if;

  select organization_id, merged_into_customer_id into org_loser, loser_merged
    from organization_customer where id = loser;
  select organization_id, merged_into_customer_id into org_winner, winner_merged
    from organization_customer where id = winner;

  -- One message for absent, invisible, and foreign. A distinct "belongs to
  -- another organization" error would confirm that an id exists somewhere,
  -- which is an existence oracle for anyone who can call this.
  if org_loser is null or org_winner is null or org_loser <> org_winner then
    raise exception 'customer not found or not eligible for merge';
  end if;

  -- No chains. Reversal of a chain is ambiguous, and merging into the live
  -- survivor is always available instead.
  if loser_merged is not null or winner_merged is not null then
    raise exception 'one of these records has already been merged; merge into the surviving record instead';
  end if;

  -- ── consent delta, computed BEFORE anything moves ───────────────────────
  select coalesce(array_agg(a.consent::text order by a.consent), '{}')
    into flips
    from app_effective_consent(array[loser, winner]) a
    left join app_effective_consent(array[winner]) b on b.consent = a.consent
   where a.granted and coalesce(b.granted, false) = false;

  select coalesce(array_agg(a.consent::text order by a.consent), '{}')
    into withdrawals
    from app_effective_consent(array[loser, winner]) a
    left join app_effective_consent(array[winner]) b on b.consent = a.consent
   where a.granted = false and coalesce(b.granted, false) = true;

  select coalesce(array_agg(f order by f), '{}') into marketing_flips
    from unnest(flips) f where f like 'marketing_%';

  if array_length(marketing_flips, 1) > 0 and not confirm_marketing_flip then
    raise exception
      'this merge would make marketing consent effective where the surviving record had none: %. '
      'Re-run with confirm_marketing_flip => true if that is intended.',
      array_to_string(marketing_flips, ', ');
  end if;

  -- ── manifest, recorded BEFORE the move so reversal can replay it ─────────
  -- location_customer_access is NOT moved: its unique key is
  -- (organization_customer_id, location_id) where revoked_at is null, so moving
  -- would collide wherever both records were recognised at the same door.
  -- Instead the survivor is granted access at any door the loser could use and
  -- it could not, and the loser keeps its own rows — harmless, since nothing
  -- resolves to a tombstone any more.
  --
  -- identity_resolution moves only where it does not collide with its own
  -- unique key; a duplicate link to the same person_identity stays put and is
  -- recorded as skipped.
  select jsonb_build_object(
    'fitting_session', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
                          from fitting_session where organization_customer_id = loser),
    'report',          (select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
                          from report where organization_customer_id = loser),
    'follow_up',       (select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
                          from follow_up where organization_customer_id = loser),
    'consent_record',  (select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
                          from consent_record where organization_customer_id = loser),
    'identity_resolution', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
                          from identity_resolution ir where ir.organization_customer_id = loser
                            and not exists (select 1 from identity_resolution w
                                             where w.organization_customer_id = winner
                                               and w.person_identity_id = ir.person_identity_id)),
    'identity_resolution_skipped', (select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
                          from identity_resolution ir where ir.organization_customer_id = loser
                            and exists (select 1 from identity_resolution w
                                         where w.organization_customer_id = winner
                                           and w.person_identity_id = ir.person_identity_id))
  ) into manifest;

  update fitting_session      set organization_customer_id = winner where organization_customer_id = loser;
  update report               set organization_customer_id = winner where organization_customer_id = loser;
  update follow_up            set organization_customer_id = winner where organization_customer_id = loser;
  update consent_record       set organization_customer_id = winner where organization_customer_id = loser;
  update identity_resolution  set organization_customer_id = winner
   where id in (select jsonb_array_elements_text(manifest->'identity_resolution')::uuid);

  -- Grant the survivor access wherever the loser had it and the survivor did not.
  with granted as (
    insert into location_customer_access
      (organization_id, organization_customer_id, location_id, access_level, reason)
    select a.organization_id, winner, a.location_id, a.access_level,
           'granted by customer merge'
      from location_customer_access a
     where a.organization_customer_id = loser and a.revoked_at is null
       and not exists (select 1 from location_customer_access w
                        where w.organization_customer_id = winner
                          and w.location_id = a.location_id
                          and w.revoked_at is null)
    returning id)
  select manifest || jsonb_build_object(
           'location_access_granted', coalesce(jsonb_agg(id order by id), '[]'::jsonb))
    into manifest from granted;

  update organization_customer
     set merged_into_customer_id = winner, merged_at = now()
   where id = loser;

  insert into audit_log (organization_id, actor_user_id, actor_type, action,
                         subject_type, subject_id, target_type, target_id,
                         correlation_id, metadata)
  values (org_winner, actor, 'user', 'customer_identity.merge_completed',
          'organization_customer', winner, 'organization_customer', loser,
          correlation,
          jsonb_build_object(
            'moved', manifest,
            'consent_delta', jsonb_build_object(
               'flipped_to_granted',   to_jsonb(flips),
               'flipped_to_withdrawn', to_jsonb(withdrawals),
               'marketing_confirmed',  confirm_marketing_flip)));

  return manifest;
end $$ language plpgsql;

-- ── Reversal ────────────────────────────────────────────────────────────────
-- Replays the manifest exactly. Rows created after the merge are not in it and
-- stay with the survivor, because at the time they were written only one record
-- was live and they cannot honestly be attributed to either original.
create or replace function app_revert_customer_merge(
  loser uuid, actor uuid, correlation uuid)
returns jsonb as $$
declare
  org uuid; winner uuid; winner_merged uuid; manifest jsonb; restored jsonb;
begin
  select organization_id, merged_into_customer_id into org, winner
    from organization_customer where id = loser;
  if org is null or winner is null then
    raise exception 'customer not found or not eligible for merge';
  end if;

  select merged_into_customer_id into winner_merged
    from organization_customer where id = winner;
  if winner_merged is not null then
    raise exception 'the surviving record has itself been merged; unwinding a chain is ambiguous — use a forward correction instead';
  end if;

  select metadata->'moved' into manifest from audit_log
   where action = 'customer_identity.merge_completed'
     and subject_id = winner and target_id = loser
   order by seq desc limit 1;
  if manifest is null then
    raise exception 'no merge_completed audit row found for this pair; cannot reverse what was not recorded';
  end if;

  -- Clear the redirect FIRST. The fitting_session trigger refuses to attach a
  -- session to a tombstone, and during a reversal the destination is still one
  -- until this runs — the guard would otherwise block the very operation that
  -- un-tombstones the record.
  update organization_customer
     set merged_into_customer_id = null, merged_at = null
   where id = loser;

  -- Only rows still sitting on the survivor move back. One deleted in the
  -- meantime is a gap, recorded rather than fatal.
  update fitting_session set organization_customer_id = loser
   where organization_customer_id = winner
     and id in (select jsonb_array_elements_text(manifest->'fitting_session')::uuid);
  update report set organization_customer_id = loser
   where organization_customer_id = winner
     and id in (select jsonb_array_elements_text(manifest->'report')::uuid);
  update follow_up set organization_customer_id = loser
   where organization_customer_id = winner
     and id in (select jsonb_array_elements_text(manifest->'follow_up')::uuid);
  update consent_record set organization_customer_id = loser
   where organization_customer_id = winner
     and id in (select jsonb_array_elements_text(manifest->'consent_record')::uuid);
  update identity_resolution set organization_customer_id = loser
   where organization_customer_id = winner
     and id in (select jsonb_array_elements_text(manifest->'identity_resolution')::uuid);

  delete from location_customer_access
   where id in (select jsonb_array_elements_text(
                  coalesce(manifest->'location_access_granted', '[]'::jsonb))::uuid);

  select jsonb_build_object(
    'fitting_session_remaining', (select count(*) from fitting_session
       where organization_customer_id = winner
         and id in (select jsonb_array_elements_text(manifest->'fitting_session')::uuid)),
    'sessions_created_after_merge_kept_by_survivor', (select count(*) from fitting_session
       where organization_customer_id = winner)
  ) into restored;

  insert into audit_log (organization_id, actor_user_id, actor_type, action,
                         subject_type, subject_id, target_type, target_id,
                         correlation_id, metadata)
  values (org, actor, 'user', 'customer_identity.merge_reverted',
          'organization_customer', winner, 'organization_customer', loser,
          correlation, jsonb_build_object('restored', manifest, 'gaps', restored));

  return manifest;
end $$ language plpgsql;

-- ── Authority ───────────────────────────────────────────────────────────────
-- A merge rewrites six tables. It is an operator action through a service path,
-- not something a tablet session can invoke. Note that fitos_svc has BYPASSRLS,
-- so the explicit organization check inside the function — not RLS — is what
-- actually prevents a cross-tenant merge. Invoker rights are kept so that RLS
-- ALSO applies if this is ever called as fitos_app.
revoke execute on function app_merge_customer(uuid, uuid, uuid, uuid, boolean) from public;
revoke execute on function app_revert_customer_merge(uuid, uuid, uuid) from public;
grant  execute on function app_merge_customer(uuid, uuid, uuid, uuid, boolean) to fitos_svc;
grant  execute on function app_revert_customer_merge(uuid, uuid, uuid) to fitos_svc;
grant  execute on function app_resolve_customer(uuid) to fitos_app, fitos_svc;
grant  execute on function app_effective_consent(uuid[]) to fitos_app, fitos_svc;
grant  update (organization_customer_id) on fitting_session, report, follow_up,
  consent_record, identity_resolution to fitos_svc;
grant  update (merged_into_customer_id, merged_at) on organization_customer to fitos_svc;
grant  delete on location_customer_access to fitos_svc;
