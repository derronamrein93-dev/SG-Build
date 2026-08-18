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
