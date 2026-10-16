import { NextRequest, NextResponse } from 'next/server';
import { assertReportingAccess } from '../../../../lib/reporting/access';
import { currentContext } from '../../../../lib/session';
import { startVerifiedFitting } from '../../../../lib/verifiedCheckin';
export async function POST(req: NextRequest) {
 try {
  assertReportingAccess();
  const body = await req.text();
  if (body.length > 4096) return NextResponse.json({error:'Invalid request'},{status:400});
  const input = JSON.parse(body) as {
   challengeId:string;phone:string;firstName?:string;lastName?:string;consent?:boolean
  };
  const result = await startVerifiedFitting(currentContext(),input);
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
 } catch (e) {
  const message = e instanceof Error ? e.message : '';
  return NextResponse.json({error:/consent|required|SMS verification|valid phone|name/i.test(message)
   ? message : 'Unable to start fitting; check the code and customer details.'},{status:400});
 }
}
