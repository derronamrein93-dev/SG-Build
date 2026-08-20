import { notFound } from 'next/navigation';
import { loadSession } from '../../../lib/queries';
import FittingFlow from './FittingFlow';

export const dynamic = 'force-dynamic';

export default async function FittingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadSession(id);
  if (!data) notFound();
  const s = data.session;
  return (
    <FittingFlow
      sessionId={id}
      customerName={s.first_name ? `${s.first_name} ${s.last_name}` : null}
      visitNumber={s.visit_number ?? 1}
      initialIntake={{
        // Quick-intake answers first, so a reload mid-fitting restores which
        // questions were already answered rather than starting over.
        intake_discomfort: s.intake_discomfort,
        intake_shoe_issue: s.intake_shoe_issue,
        intake_high_activity: s.intake_high_activity,
        intake_new_discomfort_since_last: s.intake_new_discomfort_since_last,
        intake_use_changed_since_last: s.intake_use_changed_since_last,
        current_shoe_problem: s.current_shoe_problem ?? [],
        shopping_purpose: s.shopping_purpose, discomfort_area: s.discomfort_area ?? [],
        discomfort_timing: s.discomfort_timing, standing_hours_per_day: s.standing_hours_per_day,
        fit_priority: s.fit_priority ?? [], shoe_wear_concern: s.shoe_wear_concern,
        uses_orthotics: s.uses_orthotics,
      }}
      initialAssessment={data.assessment ? {
        size_left: Number(data.assessment.size_left ?? 10), size_right: Number(data.assessment.size_right ?? 10),
        width: data.assessment.width, arch_type: data.assessment.arch_type,
        pronation_tendency: data.assessment.pronation_tendency, foot_shape: data.assessment.foot_shape ?? [],
        heel_slip_risk: data.assessment.heel_slip_risk, toe_box_issue: data.assessment.toe_box_issue ?? [],
        assessment_notes: data.assessment.assessment_notes,
      } : {}}
      previous={data.previous}
    />
  );
}
