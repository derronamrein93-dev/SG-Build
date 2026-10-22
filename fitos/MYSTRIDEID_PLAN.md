# MyStrideID implementation plan

## Existing foundation
FitOS already includes organization_customer, person_identity, identity_resolution, location_customer_access, consent_record, fitting_session, scan, recommendation, and reports. Reuse existing access controls and consent logic.

## Competitive workflow findings
- Shopify POS: customer creation, notes, tags, custom fields and checkout-linked customer records. Reference: https://help.shopify.com/en/manual/sell-in-person/shopify-pos/customer-management/create-customer-profile
- Volumental: saved digital foot profiles, repeat access and online store continuity. Reference: https://volumental.com/shopify
- FootBalance: scanning, biomechanical analysis and personalized products. Reference: https://www.footbalance.com/become-partner
- Fleet Feet fit id: verify its public-facing workflows before recording specific product claims.

## Delivery milestones
1. Read existing outcome, follow-up, report and access tables and UI. Identify reuse before migrations.
2. Add retailer-authorized customer detail view showing fitting history and recommendations.
3. Implement purchase and return capture with source and timestamp; distinguish purchases from validated fit success.
4. Add customer feedback and post-wear outcome history.
5. Implement verified customer account claiming and explicitly authorized cross-retailer profile sharing.
6. Add export, revocation, retention and isolation tests.

## Acceptance criteria
No customer from another organization is readable without an explicit authorized grant. Phone matching alone never creates cross-store access. Existing fitting flows continue to pass. Production deployment requires separate verification.
