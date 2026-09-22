import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      patient_id,
      patient_name,
      patient_mrn,
      delegating_doctor_id,
      delegating_doctor_name,
      covering_doctor_id,
      shift_hours,
      sbar_situation,
      sbar_background,
      sbar_assessment,
      sbar_recommendation,
    } = body;

    if (!patient_id) {
      return NextResponse.json({ error: 'Patient ID is missing.' }, { status: 400 });
    }

    if (!covering_doctor_id) {
      return NextResponse.json({ error: 'Please select an on-call covering physician.' }, { status: 400 });
    }

    if (!delegating_doctor_id) {
      return NextResponse.json({ error: 'Delegating clinician identity is missing. Please re-login.' }, { status: 401 });
    }

    if (!sbar_situation || !sbar_recommendation) {
      return NextResponse.json({ error: 'Situation (S) and Recommendations (R) are mandatory clinical fields.' }, { status: 400 });
    }

    const startsAt = new Date();
    const hoursNum = Number(shift_hours) || 12;
    const endsAt = new Date(startsAt.getTime() + hoursNum * 60 * 60 * 1000);

    // 1. Fetch covering doctor profile
    const { data: coveringDoc } = await supabaseAdmin
      .from('clinicians')
      .select('id, full_name, staff_id, email')
      .eq('id', covering_doctor_id)
      .maybeSingle();

    // 2. Insert delegation into shift_coverage_delegations
    const { data: delegation, error: delegationError } = await supabaseAdmin
      .from('shift_coverage_delegations')
      .insert([
        {
          patient_id: String(patient_id),
          delegating_doctor_id,
          covering_doctor_id,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          status: 'ACTIVE',
          sbar_situation: sbar_situation.trim(),
          sbar_background: (sbar_background || '').trim(),
          sbar_assessment: (sbar_assessment || '').trim(),
          sbar_recommendation: sbar_recommendation.trim(),
        },
      ])
      .select()
      .single();

    if (delegationError) {
      console.error('Delegation DB Insert Error:', delegationError);
      return NextResponse.json({ error: `Database delegation error: ${delegationError.message}` }, { status: 500 });
    }

    // 3. Stamp into Medico-Legal Audit Vault
    try {
      await supabaseAdmin.from('medico_legal_audit_logs').insert([
        {
          actor_id: delegating_doctor_id,
          actor_email: delegating_doctor_name || 'Clinician',
          actor_role: 'CLINICIAN',
          action_type: 'PATIENT_REASSIGNED',
          resource_type: 'SHIFT_HANDOFF_DELEGATION',
          resource_id: delegation.id,
          patient_mrn: patient_mrn || null,
          patient_name: patient_name || null,
          state_delta: {
            event: 'SHIFT_COVERAGE_DELEGATED',
            patient_id: String(patient_id),
            delegating_doctor: delegating_doctor_name,
            covering_doctor: coveringDoc?.full_name || covering_doctor_id,
            duration_hours: hoursNum,
            window_start: startsAt.toISOString(),
            window_end: endsAt.toISOString(),
            sbar: {
              situation: sbar_situation,
              background: sbar_background || '',
              assessment: sbar_assessment || '',
              recommendation: sbar_recommendation,
            },
          },
        },
      ]);
    } catch (auditErr) {
      console.warn('Audit logging non-fatal warning:', auditErr);
    }

    return NextResponse.json({ success: true, delegation });
  } catch (err: any) {
    console.error('Handoff API fatal error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}