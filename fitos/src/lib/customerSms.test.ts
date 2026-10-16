import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestCustomerSms, confirmCustomerSms } from './customerSms';

test('SMS request fails closed without provider configuration', async () => {
 const prev = process.env.TWILIO_ACCOUNT_SID;
 delete process.env.TWILIO_ACCOUNT_SID;
 try {
  await assert.rejects(requestCustomerSms({
   organizationId:'aaaaaaaa-0000-0000-0000-000000000001',
   locationId:'aaaaaaaa-1111-0000-0000-000000000001',
  },'+15025551212'),/not configured/);
 } finally {
  if(prev===undefined) delete process.env.TWILIO_ACCOUNT_SID;
  else process.env.TWILIO_ACCOUNT_SID=prev;
 }
});
test('SMS confirmation rejects invalid challenge IDs and code formats', async () => {
 await assert.rejects(confirmCustomerSms({
  organizationId:'aaaaaaaa-0000-0000-0000-000000000001',
  locationId:'aaaaaaaa-1111-0000-0000-000000000001',
 },'bad-id','abc'),/Invalid verification input/);
});
