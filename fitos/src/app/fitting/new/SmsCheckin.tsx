'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = 'phone'|'code'|'details';
export default function SmsCheckin() {
 const router=useRouter();
 const [step,setStep]=useState<Step>('phone');
 const [phone,setPhone]=useState('');
 const [challengeId,setChallengeId]=useState('');
 const [last4,setLast4]=useState('');
 const [code,setCode]=useState('');
 const [firstName,setFirstName]=useState('');
 const [lastName,setLastName]=useState('');
 const [consent,setConsent]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 async function submit(url:string, payload:unknown) {
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(payload),cache:'no-store'});
  const result=await response.json();
  if(!response.ok) throw new Error(result.error ?? 'Request failed');
  return result;
 }
 async function send() {
  setBusy(true);setError('');
  try {
   const result=await submit('/api/customer-sms/request',{phone});
   setChallengeId(result.challengeId);setLast4(result.phoneLast4);setStep('code');
  } catch(e){setError(e instanceof Error?e.message:'Unable to send SMS');}
  finally{setBusy(false);}
 }
 async function confirm() {
  setBusy(true);setError('');
  try {
   await submit('/api/customer-sms/confirm',{challengeId,code});
   setStep('details');
  } catch(e){setError(e instanceof Error?e.message:'Invalid code');}
  finally{setBusy(false);}
 }
 async function start() {
  setBusy(true);setError('');
  try {
   const result=await submit('/api/customer-sms/start-fitting',
    {challengeId,phone,firstName,lastName,consent});
   router.push('/fitting/'+result.fittingId);
  } catch(e){setError(e instanceof Error?e.message:'Unable to start fitting');}
  finally{setBusy(false);}
 }
 return <div className="card space-y-4">
  {step==='phone'&&<>
   <label htmlFor="checkinPhone" className="label block">Customer mobile number</label>
   <input id="checkinPhone" type="tel" autoComplete="tel" value={phone}
    onChange={e=>setPhone(e.target.value)} placeholder="(502) 555-1212"
    className="w-full min-h-touch px-4 rounded-control border border-line-strong text-[17px]"/>
   <p className="text-[13px] text-ink-muted">Ask the customer for permission to send a one-time verification code. SMS verification is not marketing opt-in.</p>
   <button type="button" className="btn-primary" disabled={busy||!phone.trim()} onClick={send}>
    {busy?'Sending…':'Send verification code'}</button>
  </>}
  {step==='code'&&<>
   <h2 className="text-[20px] font-semibold">Verify mobile number</h2>
   <p className="text-ink-secondary text-[14px]">Ask the customer to read the code sent to the phone ending in {last4}. Never ask them to share unrelated account codes.</p>
   <label htmlFor="checkinCode" className="label block">One-time code</label>
   <input id="checkinCode" inputMode="numeric" autoComplete="one-time-code"
    value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,10))}
    className="w-full min-h-touch px-4 rounded-control border border-line-strong text-[17px]"/>
   <button type="button" className="btn-primary" disabled={busy||code.length<4} onClick={confirm}>
    {busy?'Checking…':'Verify code'}</button>
   <button type="button" className="btn-ghost ml-3" onClick={()=>{setStep('phone');setCode('');}}>Change number</button>
  </>}
  {step==='details'&&<>
   <h2 className="text-[20px] font-semibold">Number verified</h2>
   <p className="text-ink-secondary text-[14px]">If the phone matches an existing customer, FitOS uses their saved record. For a new customer, collect their name and fitting-history consent.</p>
   <label htmlFor="checkinFirst" className="label block">First name (new customers)</label>
   <input id="checkinFirst" value={firstName} onChange={e=>setFirstName(e.target.value)}
    className="w-full min-h-touch px-4 rounded-control border border-line-strong"/>
   <label htmlFor="checkinLast" className="label block">Last name (new customers)</label>
   <input id="checkinLast" value={lastName} onChange={e=>setLastName(e.target.value)}
    className="w-full min-h-touch px-4 rounded-control border border-line-strong"/>
   <label className="flex items-start gap-3 text-[14px]">
    <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
    <span>Customer agrees to store fitting history and acknowledges the privacy notice. This does not authorize marketing messages.</span>
   </label>
   <button type="button" className="btn-primary" disabled={busy} onClick={start}>
    {busy?'Starting…':'Start verified fitting'}</button>
  </>}
  {error&&<p role="alert" className="text-alert text-[14px]">{error}</p>}
 </div>;
}
