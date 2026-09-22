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
      actor_id,
      actor_email,
      actor_role,
      action_type,
      resource_type,
      resource_id,
      patient_mrn,
      patient_name,
      state_delta,
    } = body;

    // Resolve real IP address behind proxies/load balancers
    const forwardedFor = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    const ipAddress = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || '127.0.0.1');
    const userAgent = req.headers.get('user-agent') || 'Unknown Client';

    const { error } = await supabaseAdmin.from('medico_legal_audit_logs').insert([
      {
        actor_id: actor_id || null,
        actor_email: actor_email || 'anonymous',
        actor_role: actor_role || 'CLINICIAN',
        action_type,
        resource_type,
        resource_id: String(resource_id),
        patient_mrn: patient_mrn || null,
        patient_name: patient_name || null,
        ip_address: ipAddress,
        user_agent: userAgent,
        state_delta: state_delta || null,
      },
    ]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}