'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveIntake, saveAssessment, computeRecommendation, completeFitting } from '../../actions';
import type { Recommendation } from '../../../lib/rules/engine';

type Values = Record<string, any>;

/* ── inputs ─────────────────────────────────────────────────────────── */

function Chips({ label, options, value, onChange, multi = false, hint }: {
  label: string; options: [string, string][]; value: any;
  onChange: (v: any) => void; multi?: boolean; hint?: string;
}) {
  const selected: string[] = multi ? (value ?? []) : value ? [value] : [];
  return (
    <div className="mb-6">
      <p className="label mb-2">{label}{hint && <span className="text-ink-muted font-normal"> · {hint}</span>}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, text]) => {
          const on = selected.includes(v);
          return (
            <button key={v} type="button" aria-pressed={on} className="chip"
              onClick={() => onChange(multi ? (on ? selected.filter((s) => s !== v) : [...selected, v]) : (on ? null : v))}>
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="label mb-2">{label}</p>
      <div className="flex items-center gap-3">
        <button type="button" className="chip !w-14 justify-center text-[22px]" onClick={() => onChange(Math.max(1, +(value - 0.5).toFixed(1)))}>−</button>
        <span className="text-[28px] font-semibold tabular-nums w-16 text-center">{value.toFixed(1)}</span>
        <button type="button" className="chip !w-14 justify-center text-[22px]" onClick={() => onChange(+(value + 0.5).toFixed(1))}>+</button>
      </div>
    </div>
  );
}

const Dots = ({ level, scale }: { level: string; scale: string[] }) => (
  <span className="tracking-[0.15em] text-accent" aria-label={level}>
    {scale.map((s, i) => (i <= scale.indexOf(level) ? '●' : '○')).join('')}
  </span>
);

/* ── the flow ───────────────────────────────────────────────────────── */

export default function FittingFlow({ sessionId, customerName, visitNumber, initialIntake, initialAssessment, previous }: {
  sessionId: string; customerName: string | null; visitNumber: number;
  initialIntake: Values; initialAssessment: Values; previous: Values | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<'intake' | 'assessment' | 'recommendation'>('intake');
  const [intake, setIntake] = useState<Values>(initialIntake);
  const [assessment, setAssessment] = useState<Values>({
    size_left: 10, size_right: 10, ...initialAssessment,
  });
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const started = useRef(Date.now());

  /* Debounced autosave: local optimistic state → debounce → server ack.
     Not a database write per tap. */
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const queue = useCallback((kind: 'intake' | 'assessment', patch: Values, delay: number) => {
    clearTimeout(timers.current[kind]);
    setSaving(true);
    timers.current[kind] = setTimeout(async () => {
      await (kind === 'intake' ? saveIntake(sessionId, patch) : saveAssessment(sessionId, patch));
      setSaving(false);
    }, delay);
  }, [sessionId]);

  const setI = (k: string, v: any) => {
    const next = { ...intake, [k]: v };
    setIntake(next);
    queue('intake', next, 600);            // chips debounce short
  };
  const setA = (k: string, v: any) => {
    const next = { ...assessment, [k]: v };
    setAssessment(next);
    queue('assessment', next, k.endsWith('notes') ? 1500 : 600);  // free text, long
  };

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  async function toRecommendation() {
    await saveIntake(sessionId, intake);
    await saveAssessment(sessionId, assessment);
    const r = await computeRecommendation(sessionId);
    setRec(r);
    setStep('recommendation');
  }

  async function finish() {
    const { token } = await completeFitting(sessionId);
    startTransition(() => router.push(`/r/${token}`));
  }

  const elapsed = Math.round((Date.now() - started.current) / 1000);

  return (
    <main className="max-w-[1100px] mx-auto p-6 pb-32">
      <header className="flex items-baseline justify-between mb-6">
        <div>
          <p className="overline">
            {customerName ?? 'Anonymous fitting'}{visitNumber > 1 && ` · Visit ${visitNumber}`}
          </p>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] mt-1 capitalize">{step}</h1>
        </div>
        <p className="text-[12px] text-ink-muted font-mono">
          {saving ? 'saving…' : 'saved on this device'} · {elapsed}s
        </p>
      </header>

      {previous && step === 'intake' && (
        <div className="card mb-6 bg-accent-wash border-accent">
          <p className="text-[15px]">
            Last fitted {new Date(previous.completed_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            {previous.arch_type && ` · ${previous.arch_type} arch`}
            {previous.width && ` · ${previous.width} width`}
            {previous.size_left && ` · ${previous.size_left}/${previous.size_right}`}
          </p>
          <p className="text-[14px] text-ink-secondary mt-1">Anything changed since then?</p>
        </div>
      )}

      {step === 'intake' && (
        <div className="card">
          <Chips label="What are they shopping for?" value={intake.shopping_purpose}
            onChange={(v) => setI('shopping_purpose', v)}
            options={[['running','Running'],['walking','Walking'],['work','Work'],['casual','Casual'],
              ['orthopedic','Comfort'],['kids','Kids'],['sports','Sports'],['hiking','Hiking']]} />
          <Chips label="Where is the discomfort?" multi value={intake.discomfort_area}
            onChange={(v) => setI('discomfort_area', v)} hint="tap all that apply"
            options={[['heel','Heel'],['arch','Arch'],['ball_of_foot','Ball of foot'],['toes','Toes'],
              ['ankle','Ankle'],['knee','Knee'],['hip_back','Hip / back'],['none','No pain']]} />
          <Chips label="When is it worst?" value={intake.discomfort_timing}
            onChange={(v) => setI('discomfort_timing', v)}
            options={[['during','During activity'],['after','After activity'],['all_day','All day'],
              ['first_steps_morning','First steps in the morning'],['certain_shoes','Only in certain shoes']]} />
          <Chips label="Hours on their feet each day" value={intake.standing_hours_per_day}
            onChange={(v) => setI('standing_hours_per_day', v)}
            options={[['under_2','Under 2'],['2_4','2–4'],['4_8','4–8'],['8_plus','8+']]} />
          <Chips label="What matters most?" multi value={intake.fit_priority}
            onChange={(v) => setI('fit_priority', v)} hint="pick up to two"
            options={[['comfort','Comfort'],['support','Support'],['performance','Performance'],
              ['durability','Durability'],['style','Style'],['price','Price']]} />
          <Chips label="Current shoe wear pattern" value={intake.shoe_wear_concern}
            onChange={(v) => setI('shoe_wear_concern', v)}
            options={[['even','Even'],['outer_edge','Outer edge'],['inner_edge','Inner edge'],
              ['heel','Heel'],['uneven_lr','Uneven L/R'],['unsure','Not sure']]} />
          <Chips label="Uses orthotics?" value={intake.uses_orthotics}
            onChange={(v) => setI('uses_orthotics', v)}
            options={[['no','No'],['custom','Yes — custom'],['otc','Yes — over the counter']]} />
        </div>
      )}

      {step === 'assessment' && (
        <div className="card">
          <div className="flex gap-10 mb-6">
            <Stepper label="Left" value={Number(assessment.size_left)} onChange={(v) => setA('size_left', v)} />
            <Stepper label="Right" value={Number(assessment.size_right)} onChange={(v) => setA('size_right', v)} />
          </div>
          <Chips label="Width" value={assessment.width} onChange={(v) => setA('width', v)}
            options={[['narrow','Narrow'],['standard','Standard'],['wide','Wide'],['extra_wide','Extra wide'],['unsure','Unsure']]} />
          <Chips label="Arch" value={assessment.arch_type} onChange={(v) => setA('arch_type', v)}
            options={[['low','Low / flat'],['medium','Medium'],['high','High'],['unknown','Unknown']]} />
          <Chips label="How the foot rolls" value={assessment.pronation_tendency}
            onChange={(v) => setA('pronation_tendency', v)} hint="plain words; clinical term stays off the floor"
            options={[['outward','Outward roll'],['neutral','Neutral'],['mild_inward','Mild inward roll'],
              ['strong_inward','Strong inward roll'],['unknown','Unknown']]} />
          <Chips label="Foot shape" multi value={assessment.foot_shape} onChange={(v) => setA('foot_shape', v)}
            options={[['narrow','Narrow'],['average','Average'],['wide','Wide'],
              ['high_volume','High volume'],['low_volume','Low volume']]} />
          <Chips label="Heel slip" value={assessment.heel_slip_risk} onChange={(v) => setA('heel_slip_risk', v)}
            options={[['none','None'],['slight','Slight'],['noticeable','Noticeable']]} />
          <Chips label="Toe box" multi value={assessment.toe_box_issue} onChange={(v) => setA('toe_box_issue', v)}
            options={[['length_tight','Length tight'],['width_tight','Width tight'],['depth_tight','Depth tight'],
              ['bunion','Bunion'],['toe_overlap','Toe overlap']]} />
          <div>
            <label className="label block mb-2" htmlFor="notes">Notes</label>
            <textarea id="notes" rows={2} defaultValue={assessment.assessment_notes ?? ''}
              onChange={(e) => setA('assessment_notes', e.target.value)}
              className="w-full p-3 rounded-control border border-line-strong text-[16px]" />
          </div>
        </div>
      )}

      {step === 'recommendation' && rec && (
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="overline">Fit profile</h2>
              <span className={`text-[12px] font-medium ${
                rec.evidenceStrength === 'high' ? 'text-success'
                : rec.evidenceStrength === 'moderate' ? 'text-attention' : 'text-ink-muted'}`}>
                Evidence: {rec.evidenceStrength === 'high' ? 'Strong'
                  : rec.evidenceStrength === 'moderate' ? 'Moderate' : 'Limited'}
              </span>
            </div>
            <dl className="space-y-2 text-[15px]">
              {[['Category', rec.fitProfile.category.replace(/_/g, ' ')],
                ['Width', rec.fitProfile.width.replace(/_/g, ' ')],
                ['Toe box', rec.fitProfile.toe_box.replace(/_/g, ' ')],
                ['Heel', rec.fitProfile.heel_fit.replace(/_/g, ' ')],
                ['Insole', rec.fitProfile.insole.replace(/_/g, ' ')]].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-line pb-2">
                  <dt className="text-ink-secondary">{k}</dt><dd className="font-medium capitalize">{v}</dd>
                </div>
              ))}
              <div className="flex justify-between border-b border-line pb-2">
                <dt className="text-ink-secondary">Support</dt>
                <dd className="font-medium capitalize">
                  {rec.fitProfile.support_level.replace(/_/g, ' ')}{' '}
                  <Dots level={rec.fitProfile.support_level} scale={['neutral','light_stability','stability','max_support']} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-secondary">Cushioning</dt>
                <dd className="font-medium capitalize">
                  {rec.fitProfile.cushioning_level}{' '}
                  <Dots level={rec.fitProfile.cushioning_level} scale={['firm','moderate','plush','max']} />
                </dd>
              </div>
            </dl>
            <p className="text-[13px] text-ink-muted mt-4">{rec.evidenceDetail.reason}</p>
          </div>

          <div className="card">
            <h2 className="overline mb-3">What to say</h2>
            <ul className="space-y-3">
              {rec.talkingPoints.map((t, i) => (
                <li key={i} className="text-[15px] leading-relaxed border-l-2 border-accent pl-3">“{t}”</li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2 className="overline mb-3">Consider</h2>
            {rec.candidates.length === 0
              ? <p className="text-[14px] text-ink-muted">Nothing in stock matches every requirement — fit on characteristics.</p>
              : <ul className="space-y-3">
                  {rec.candidates.map((c) => (
                    <li key={c.productModelId}>
                      <p className="font-medium text-[15px]">{c.brand} {c.model}</p>
                      <p className="text-[13px] text-ink-secondary">{c.reasons.join(' · ')}</p>
                    </li>
                  ))}
                </ul>}
          </div>

          <div className="card">
            <h2 className="overline mb-3">Avoid</h2>
            <ul className="space-y-2 text-[14px] text-ink-secondary">
              {rec.avoid.map((a) => <li key={a}>· {a}</li>)}
            </ul>
            {rec.flags.includes('referral_suggested') && (
              <p className="mt-4 text-[13px] text-attention border-t border-line pt-3">
                For you: keep the conversation on comfort and fit, and suggest they check in with a
                healthcare professional.
              </p>
            )}
            <p className="mt-4 font-mono text-[11px] text-ink-muted">
              {rec.versions.rule_set_version} · {rec.versions.recommendation_engine_version} · rules {rec.firedRuleIds.join(' ')}
            </p>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-surface-raised border-t border-line px-6 py-3 flex justify-between">
        <button className="btn-ghost" type="button"
          onClick={() => setStep(step === 'recommendation' ? 'assessment' : 'intake')}>Back</button>
        {step === 'intake' && <button className="btn-primary" onClick={() => setStep('assessment')}>Assessment →</button>}
        {step === 'assessment' && <button className="btn-primary" onClick={toRecommendation}>Recommendation →</button>}
        {step === 'recommendation' && <button className="btn-primary" onClick={finish}>Create fit report →</button>}
      </nav>
    </main>
  );
}
