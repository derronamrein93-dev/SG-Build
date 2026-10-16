import { NextRequest, NextResponse } from 'next/server';
import { assertReportingAccess } from '../../../../lib/reporting/access';
import { currentContext } from '../../../../lib/session';
import { confirmCustomerSms } from '../../../../lib/customerSms';
export async function POST(req: NextRequest) {
 try {
  assertReportingAccess();
  const body = await req.text();
  if (body.length > 1024) return NextResponse.json({error:'Invalid request'},{status:400});
  const { challengeId, code } = JSON.parse(body) as {challengeId?:string;code?:string};
  const result = await confirmCustomerSms(currentContext(),challengeId ?? '',code ?? '');
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 } catch {
  return NextResponse.json({error:'Code invalid or expired. Please try again.'},{status:400});
 }
}
