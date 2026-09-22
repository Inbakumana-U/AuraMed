import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      patient_id,
      from_unit,
      to_unit,
      target_bed_id,
      clinical_rationale,
      admin_id,
      admin_email,
      admin_name,
    } = body;

    if (!patient_id || !from_unit || !to_unit) {
      return NextResponse.json({ error: 'Missing required transfer parameters' }, { status: 400 });
    }

    const forwardedFor = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    const ipAddress = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || '127.0.0.1');
    const userAgent = req.headers.get('user-agent') || 'Admin Command Center';

    // 1. Fetch Patient Info
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('full_name, mrn, department')
      .eq('id', patient_id)
      .single();

    // 2. Clear old bed occupation
    await supabaseAdmin
      .from('beds')
      .update({ status: 'DIRTY_TURNOVER', current_patient_id: null, occupied_at: null })
      .eq('current_patient_id', patient_id);

    // 3. Assign target bed if supplied
    if (target_bed_id) {
      await supabaseAdmin
        .from('beds')
        .update({
          status: 'OCCUPIED',
          current_patient_id: patient_id,
          occupied_at: new Date().toISOString(),
        })
        .eq('id', target_bed_id);
    }

    // 4. Update Patient Department
    const departmentMap: Record<string, string> = {
      ED: 'Emergency',
      ICU: 'ICU',
      SDU: 'Step-Down',
      GEN: 'General',
    };

    const targetDeptName = departmentMap[to_unit] || to_unit;
    const fromDeptName = departmentMap[from_unit] || from_unit;

    await supabaseAdmin
      .from('patients')
      .update({ department: targetDeptName })
      .eq('id', patient_id);

    // 5. Insert Completed Transfer Log
    const actorDisplayName = admin_name ? `${admin_name} (${admin_email || 'Admin'})` : (admin_email || 'Hospital Administrator');

    const { data: transferRecord } = await supabaseAdmin
      .from('patient_transfers')
      .insert([
        {
          patient_id,
          from_unit,
          to_unit,
          priority: 'URGENT',
          transfer_status: 'COMPLETED',
          requested_by: actorDisplayName,
          target_bed_id: target_bed_id || null,
          clinical_rationale: clinical_rationale || 'Administrative bed capacity and acuity transfer.',
          completed_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    // 6. Explicitly stamp into Medico-Legal Audit Vault
    await supabaseAdmin.from('medico_legal_audit_logs').insert([
      {
        actor_id: admin_id || 'a0000000-0000-0000-0000-000000000001',
        actor_email: actorDisplayName,
        actor_role: 'ADMIN',
        action_type: 'WARD_TRANSFERRED',
        resource_type: 'BED_MANAGEMENT_UNIT',
        resource_id: target_bed_id || transferRecord?.id || patient_id,
        patient_mrn: patient?.mrn || null,
        patient_name: patient?.full_name || null,
        ip_address: ipAddress,
        user_agent: userAgent,
        state_delta: {
          event: 'PATIENT_WARD_TRANSFER_EXECUTED_BY_ADMIN',
          initiated_by: actorDisplayName,
          from_unit: fromDeptName,
          to_unit: targetDeptName,
          allocated_bed: target_bed_id || 'AUTO_ASSIGN_ON_WARD_ARRIVAL',
          rationale: clinical_rationale,
        },
      },
    ]);

    return NextResponse.json({ success: true, transfer: transferRecord });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}