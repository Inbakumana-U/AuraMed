import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      synthesis_id,
      patient_id,
      patient_name,
      patient_mrn,
      executive_summary,
      critical_alerts,
      recommended_actions,
      physician_notes,
      signer_id,
      signer_name,
      signer_staff_id,
    } = body;

    if (!synthesis_id || !patient_id || !signer_id) {
      return NextResponse.json({ error: 'Missing mandatory signature parameters.' }, { status: 400 });
    }

    const forwardedFor = req.headers.get('x-forwarded-for');
    const realIp = req.headers.get('x-real-ip');
    const ipAddress = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || '127.0.0.1');
    const userAgent = req.headers.get('user-agent') || 'Unknown Client';
    const verifiedAt = new Date().toISOString();

    // 1. Generate digital signature fingerprint
    const signaturePayload = `${synthesis_id}:${patient_id}:${signer_id}:${verifiedAt}:${executive_summary}`;
    const digitalSignatureHash = crypto.createHash('sha256').update(signaturePayload).digest('hex');

    // 2. Lock & update synthesis to PHYSICIAN_VERIFIED
    const { data: updatedSynth, error: updateError } = await supabaseAdmin
      .from('ai_clinical_syntheses')
      .update({
        status: 'PHYSICIAN_VERIFIED',
        executive_summary,
        critical_alerts,
        recommended_actions,
        physician_notes: physician_notes || null,
        verified_by_id: signer_id,
        verified_by_name: signer_name,
        verified_by_staff_id: signer_staff_id,
        verified_at: verifiedAt,
        verification_ip: ipAddress,
        digital_signature_hash: digitalSignatureHash,
      })
      .eq('id', synthesis_id)
      .select()
      .single();

    if (updateError) throw updateError;

    // 3. Medico-Legal Audit Vault Stamping
    await supabaseAdmin.from('medico_legal_audit_logs').insert([
      {
        actor_id: signer_id,
        actor_email: signer_name,
        actor_role: 'CLINICIAN',
        action_type: 'RECORD_UPDATED',
        resource_type: 'AI_CLINICAL_VERIFICATION',
        resource_id: synthesis_id,
        patient_mrn: patient_mrn || null,
        patient_name: patient_name || null,
        ip_address: ipAddress,
        user_agent: userAgent,
        state_delta: {
          event: 'AI_SYNTHESIS_PHYSICIAN_VERIFIED',
          digital_signature_hash: digitalSignatureHash,
          verified_at: verifiedAt,
          verified_by: `${signer_name} (${signer_staff_id})`,
          executive_summary,
          physician_notes,
          legal_status: 'ACCEPTED_FOR_CLINICAL_RECORD',
        },
      },
    ]);

    return NextResponse.json({ success: true, synthesis: updatedSynth });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}