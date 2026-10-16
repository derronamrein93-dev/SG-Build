# Staff-assisted SMS verification — development implementation

## Staff procedure
1. Ask customer whether they want to identify their fitting by mobile number and receive a one-time code. Do not treat verification as marketing consent.
2. Enter mobile number on **Who are we fitting?**, press **Send verification code**.
3. Customer reads the code from their own phone. Staff enters it on the fitting screen.
4. After approval, provide the customer's name if this is their first visit, and obtain separate fitting-history/privacy consent.
5. Start the identified fitting. The server consumes the proof atomically with fitting creation. A reused, expired or wrong-number proof fails.
6. If customer declines SMS, use **Fitting without saving contact**. Never block the fitting.

## Provider configuration
Use Twilio Verify with the following server-side environment variables:
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`

Secrets must never be exposed in client JavaScript or committed to the repository. Verify that the provider's fraud controls, message templates, sender registration and local messaging requirements are configured before sending real SMS.

## Security and rollout limits
- SMS codes are generated and checked by Twilio Verify; FitOS never stores them.
- FitOS stores a keyed, organization-scoped phone hash and a provider challenge ID, not a raw phone number, in the verification record.
- Proof expires after 10 minutes; maximum 5 code checks and 3 sends per phone per hour. Rate limits must also be enforced at provider and network level before public rollout.
- The new identified check-in UI is **disabled in production** until real authenticated staff sessions replace the seeded demo identity. The new APIs share this restriction.
- This is **not** an independently authenticated customer portal login. It is staff-assisted proof of possession for an in-store fitting. Customer portal sessions require their own signed, revocable auth credentials.
- Legacy kiosk and other session creation paths must be audited before claiming universal SMS enforcement. SMS verification is not proof of legal identity.
- No marketing consent is inferred from an SMS verification. Opt-in for marketing SMS is separate, explicit and revocable.
- End-to-end delivery testing requires configured Twilio credentials and a consenting test phone. No real SMS delivery has been tested in this branch.
