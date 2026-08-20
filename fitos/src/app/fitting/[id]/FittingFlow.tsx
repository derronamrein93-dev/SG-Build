'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveIntake, saveAssessment, computeRecommendation, completeFitting } from '../../actions';
import { questionsFor, type IntakeQuestion } from '../../../lib/intake/questions';
import { emit } from '../../../lib/analytics';
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

/**
 * One question, two targets. 96px tall because this is used at arm's length on
 * a counter, often one-handed, sometimes while holding a shoe. Nothing here
 * depends on hover, and nothing needs a keyboard.
 */
function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  const base = 'flex-1 h-24 rounded-xl border-2 text-[22px] font-semibold transition-colors';
  return (
    <div className="flex gap-4 mt-8">
      <button type="button" aria-pressed={value === true} data-answer="yes"
        onClick={() => onChange(true)}
        className={`${base} ${value === true
          ? 'bg-accent text-white border-accent'
          : 'bg-surface-raised border-line text-ink-primary active:bg-accent-wash'}`}>Yes</button>
      <button type="button" aria-pressed={value === false} data-answer="no"
        onClick={() => onChange(false)}
        className={`${base} ${value === false
          ? 'bg-accent text-white border-accent'
          : 'bg-surface-raised border-line text-ink-primary active:bg-accent-wash'}`}>No</button>
    </div>
  );
}

export default function FittingFlow({ sessionId, customerName, visitNumber, initialIntake, initialAssessment, previous }: {
  sessionId: string; customerName: string | null; visitNumber: number;
  initialIntake: Values; initialAssessment: Values; previous: Values | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<'intake' | 'assessment' | 'recommendation'>('intake');
  const [intake, setIntake] = useState<Values>(initialIntake);

  // The quick intake: three questions for a new customer, two for a returning
  // one. One on screen at a time — a stacked list invites reading ahead, and
  // reading ahead is what made the old intake feel like paperwork.
  const questions = questionsFor(visitNumber);
  const [qIndex, setQIndex] = useState(0);
  const [showDetail, setShowDetail] = useState(false);
  const showDetailEver = useRef(false);
  const intakeStarted = useRef(Date.now());
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

  /** Record one yes/no and advance. Saves immediately: a tap is a decision, and
   *  there is nothing to debounce about a single boolean. */
  function answer(q: IntakeQuestion, value: boolean) {
    const next = { ...intake, [q.field]: value };
    setIntake(next);
    void saveIntake(sessionId, { [q.field]: value });

    // A No is the end of that subject — advance immediately, which is what keeps
    // the all-No path down to one tap per question.
    //
    // A Yes on a question that can expand does NOT advance. It used to, which
    // made "Add detail" unreachable on precisely the two questions that offer
    // it: the tap that revealed the button also navigated away from it. Staying
    // put costs a Continue tap and buys back the whole optional-detail feature.
    const canExpand = value === true && q.offersDetail;
    if (!canExpand && qIndex < questions.length - 1) {
      setQIndex(qIndex + 1);
      setShowDetail(false);
    }
  }

  /** Start Scan — the end of the intake and the beginning of the fitting. */
  async function startScan() {
    const seconds = Math.round((Date.now() - intakeStarted.current) / 1000);
    const answeredYes = questions.filter((q) => intake[q.field] === true).length;
    await saveIntake(sessionId, {
      intake_duration_seconds: seconds,
      intake_mode: showDetailEver.current ? 'detailed' : 'quick',
    });
    emit('intake_completed', {
      fitting_session_id: sessionId, visit_number: visitNumber,
      question_count: questions.length, answered_yes_count: answeredYes,
      intake_duration_seconds: seconds, detail_opened: showDetailEver.current,
      intake_mode: showDetailEver.current ? 'detailed' : 'quick',
    });
    emit('scan_started', { fitting_session_id: sessionId, visit_number: visitNumber });
    setStep('assessment');
  }

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
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] mt-1">
            {step === 'intake' ? 'Intake' : step === 'assessment' ? 'Scan · Measurements' : 'Recommendation'}
          </h1>
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
          <p className="text-[14px] text-ink-secondary mt-1">Two quick questions and we scan.</p>
        </div>
      )}

      {step === 'intake' && (() => {
        const q = questions[qIndex];
        // null is what an unanswered column looks like coming back from the
        // database, and it is NOT an answer. Treating it as one let the
        // associate walk past a question without answering it.
        const raw = intake[q.field];
        const answered: boolean | null = typeof raw === 'boolean' ? raw : null;
        const last = qIndex === questions.length - 1;
        return (
          <div className="card">
            <p className="overline">Question {qIndex + 1} of {questions.length}</p>
            <div className="flex gap-1.5 mt-3" aria-hidden="true">
              {questions.map((_, i) => (
                <span key={i} className={`h-1.5 flex-1 rounded-full ${
                  i < qIndex ? 'bg-accent' : i === qIndex ? 'bg-accent/50' : 'bg-line'}`} />
              ))}
            </div>

            <h2 className="text-[26px] leading-[1.25] font-semibold tracking-[-0.01em] mt-6 max-w-[24ch]">
              {q.prompt}
            </h2>

            <YesNo value={answered} onChange={(v) => answer(q, v)} />

            {/* Optional, and only after a Yes. Never a second questionnaire:
                the associate can go straight to Start Scan without it. */}
            {answered === true && q.offersDetail && !showDetail && (
              <button type="button" className="btn-ghost mt-6"
                onClick={() => { setShowDetail(true); showDetailEver.current = true; }}>
                Add detail (optional)
              </button>
            )}

            {answered === true && q.offersDetail && showDetail && (
              <div className="mt-6 pt-6 border-t border-line">
                <p className="text-[13px] text-ink-muted mb-4">
                  Optional. Skip it and press {last ? 'Start Scan' : 'Next'} whenever you like.
                </p>
                {q.detailFields.includes('discomfort_area') && (
                  <Chips label="Where is the discomfort?" multi value={intake.discomfort_area}
                    onChange={(v) => setI('discomfort_area', v)}
                    options={[['heel','Heel'],['arch','Arch'],['ball_of_foot','Ball of foot'],
                      ['toes','Toes'],['ankle','Ankle'],['knee','Knee'],['hip_back','Hip or back']]} />
                )}
                {q.detailFields.includes('current_shoe_problem') && (
                  <Chips label="What is wrong with the current shoes?" multi value={intake.current_shoe_problem}
                    onChange={(v) => setI('current_shoe_problem', v)}
                    options={[['too_tight','Too tight'],['too_loose','Too loose'],['heel_slips','Heel slips'],
                      ['rubs_blisters','Rubbing'],['worn_out','Worn out'],['not_enough_support','Not enough support']]} />
                )}
                {q.detailFields.includes('shopping_purpose') && (
                  <Chips label="What are they shopping for now?" value={intake.shopping_purpose}
                    onChange={(v) => setI('shopping_purpose', v)}
                    options={[['running','Running'],['walking','Walking'],['work','Work'],
                      ['casual','Everyday'],['hiking','Hiking'],['sports','Sport']]} />
                )}
              </div>
            )}

            {/* No Next button. Answering IS advancing — a second way forward is
                a second way to skip, and that is exactly what it did. Start Scan
                stays deliberate: the last answer reveals it rather than firing
                it, so nobody starts a scan with their thumb still moving. */}
            <div className="mt-8 flex items-center gap-4">
              {!last && answered !== null && (
                <button type="button" className="btn-primary text-[17px] px-6 py-3"
                  onClick={() => { setQIndex(qIndex + 1); setShowDetail(false); }}>Continue →</button>
              )}
              {last && (
                <button type="button" className="btn-primary text-[19px] px-8 py-4"
                  disabled={answered === null} onClick={startScan}>Start Scan →</button>
              )}
              {qIndex > 0 && (
                <button type="button" className="btn-ghost"
                  onClick={() => { setQIndex(qIndex - 1); setShowDetail(false); }}>Back</button>
              )}
            </div>
          </div>
        );
      })()}

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
          onClick={() => setStep(step === 'recommendation' ? 'assessment' : 'intake')}
          style={{ visibility: step === 'intake' ? 'hidden' : 'visible' }}>Back</button>
        {/* intake advances from inside the card: one question, one decision */}
        {step === 'assessment' && <button className="btn-primary" onClick={toRecommendation}>Recommendation →</button>}
        {step === 'recommendation' && <button className="btn-primary" onClick={finish}>Create fit report →</button>}
      </nav>
    </main>
  );
}
