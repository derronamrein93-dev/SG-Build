-- =============================================================================
-- 0004 · delete rules on location references
--
-- Found by re-running the isolation suite against seeded application data:
-- deleting an organization cascaded to its locations, but consent_record,
-- fitting_session, follow_up and pilot_feedback referenced location with no
-- delete rule, so the cascade hit a foreign-key error. Tenant teardown has to
-- work — it is how erasure requests and pilot resets are honoured.
--
-- consent_record keeps its row and loses the pointer: a consent event happened,
-- and the record of it should not disappear because a store closed.
-- =============================================================================

alter table consent_record  drop constraint consent_record_location_id_fkey,
  add constraint consent_record_location_id_fkey
  foreign key (location_id) references location(id) on delete set null;

alter table fitting_session drop constraint fitting_session_location_id_fkey,
  add constraint fitting_session_location_id_fkey
  foreign key (location_id) references location(id) on delete cascade;

alter table follow_up       drop constraint follow_up_location_id_fkey,
  add constraint follow_up_location_id_fkey
  foreign key (location_id) references location(id) on delete cascade;

alter table pilot_feedback  drop constraint pilot_feedback_location_id_fkey,
  add constraint pilot_feedback_location_id_fkey
  foreign key (location_id) references location(id) on delete set null;

alter table organization_customer drop constraint organization_customer_created_at_location_id_fkey,
  add constraint organization_customer_created_at_location_id_fkey
  foreign key (created_at_location_id) references location(id) on delete cascade;

alter table report drop constraint report_organization_customer_id_fkey,
  add constraint report_organization_customer_id_fkey
  foreign key (organization_customer_id) references organization_customer(id) on delete cascade;

-- Same class of problem on user references: attribution should survive a
-- staff record being removed, so these null out rather than block.
alter table consent_record drop constraint consent_record_captured_by_user_id_fkey,
  add constraint consent_record_captured_by_user_id_fkey
  foreign key (captured_by_user_id) references app_user(id) on delete set null;

alter table fitting_session drop constraint fitting_session_user_id_fkey,
  add constraint fitting_session_user_id_fkey
  foreign key (user_id) references app_user(id) on delete cascade;

alter table follow_up drop constraint follow_up_completed_by_user_id_fkey,
  add constraint follow_up_completed_by_user_id_fkey
  foreign key (completed_by_user_id) references app_user(id) on delete set null;

alter table pilot_feedback drop constraint pilot_feedback_user_id_fkey,
  add constraint pilot_feedback_user_id_fkey
  foreign key (user_id) references app_user(id) on delete set null;

alter table location_customer_access drop constraint location_customer_access_granted_by_user_id_fkey,
  add constraint location_customer_access_granted_by_user_id_fkey
  foreign key (granted_by_user_id) references app_user(id) on delete set null;

alter table fitting_feature drop constraint fitting_feature_overridden_by_user_id_fkey,
  add constraint fitting_feature_overridden_by_user_id_fkey
  foreign key (overridden_by_user_id) references app_user(id) on delete set null;
