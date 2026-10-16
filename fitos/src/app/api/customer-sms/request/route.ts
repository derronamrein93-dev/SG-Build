import { NextRequest, NextResponse } from 'next/server';
import { assertReportingAccess } from '../../../../lib/reporting/access';
import { currentContext } from '../../../../lib/session';
import { requestCustomerSms } from '../../../../lib/customerSms';
export async function POST(req: NextRequest) {
 try {
  assertReportingAccess();
  const body = await req.text();
  if (body.length > 1024) return NextResponse.json({error:'Invalid request'},{status:400});
  const { phone } = JSON.parse(body) as {phone?:string};
  const result = await requestCustomerSms(currentContext(),phone ?? '');
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 } catch {
  return NextResponse.json({error:'Unable to send code. Check the number or try later.'},{status:400});
 }
}
