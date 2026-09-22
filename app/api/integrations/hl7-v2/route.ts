import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function POST(req: Request) {
  let rawMessage = '';
  try {
    rawMessage = await req.text();

    if (!rawMessage || !rawMessage.includes('MSH|')) {
      return NextResponse.json({ error: 'Invalid HL7 v2.x payload. Missing MSH segment.' }, { status: 400 });
    }

    // Split segments by CR or LF
    const segments = rawMessage.split(/\r?\n|\r/).filter((s) => s.trim().length > 0);

    let mshControlId = '';
    let sendingApp = 'ANALYZER';
    let patientMrn = '';
    const observations: Array<{
      loinc: string;
      testName: string;
      value: string;
      units: string;
      refRange: string;
      abnormalFlag: string;
    }> = [];

    for (const segment of segments) {
      const fields = segment.split('|');
      const segmentType = fields[0];

      if (segmentType === 'MSH') {
        sendingApp = fields[2] || 'BECKMAN_COULTER';
        mshControlId = fields[9] || String(Date.now());
      } else if (segmentType === 'PID') {
        // PID-3 is Patient Identifier List (MRN)
        patientMrn = fields[3]?.split('^')[0] || '';
      } else if (segmentType === 'OBX') {
        // OBX-3: Observation Identifier (Code^Name^CodingSystem)
        const obsIdParts = (fields[3] || '').split('^');
        const loinc = obsIdParts[0] || '';
        const testName = obsIdParts[1] || 'Laboratory Observation';

        // OBX-5: Observation Value
        const value = fields[5] || '';
        // OBX-6: Units
        const units = fields[6] || '';
        // OBX-7: Reference Range
        const refRange = fields[7] || '';
        // OBX-8: Abnormal Flags (N = Normal, H = High, L = Low, A = Abnormal, C = Critical)
        const abnormalFlag = fields[8] || 'N';

        observations.push({
          loinc,
          testName,
          value: units ? `${value} ${units}` : value,
          refRange,
          abnormalFlag,
        });
      }
    }

    if (!patientMrn) {
      await supabaseAdmin.from('ehr_integration_logs').insert([
        {
          source_system: sendingApp,
          protocol: 'HL7_V2_ORU',
          message_type: 'ORU^R01',
          status: 'UNMATCHED_PATIENT',
          raw_payload: rawMessage,
          error_message: 'PID segment contains no valid MRN',
        },
      ]);
      return NextResponse.json({ error: 'Patient MRN missing in PID segment' }, { status: 422 });
    }

    // Match patient by MRN
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('id, full_name')
      .eq('mrn', patientMrn)
      .maybeSingle();

    if (!patient) {
      await supabaseAdmin.from('ehr_integration_logs').insert([
        {
          source_system: sendingApp,
          protocol: 'HL7_V2_ORU',
          message_type: 'ORU^R01',
          patient_mrn: patientMrn,
          status: 'UNMATCHED_PATIENT',
          raw_payload: rawMessage,
          error_message: `No active patient with MRN ${patientMrn}`,
        },
      ]);

      // Return HL7 Application Reject (AR) ACK
      const ackReject = `MSH|^~\\&|AuraMed|HospitalSystem|${sendingApp}|LAB|${new Date().toISOString()||''}||ACK|${mshControlId}|P|2.5\rMSA|AR|${mshControlId}|Patient MRN ${patientMrn} not found`;
      return new Response(ackReject, {
        headers: { 'Content-Type': 'text/plain' },
        status: 404,
      });
    }

    // Map and insert observations directly into test_results
    const today = new Date().toISOString().split('T')[0];
    const insertPayload = observations.map((obs) => {
      let statusClassification = 'normal';
      const flag = obs.abnormalFlag.toUpperCase();
      if (flag === 'C' || flag === 'LL' || flag === 'HH') {
        statusClassification = 'critical';
      } else if (flag === 'H' || flag === 'L' || flag === 'A') {
        statusClassification = 'abnormal';
      }

      return {
        patient_id: patient.id,
        test_name: obs.testName,
        category: 'Diagnostic Lab',
        test_date: today,
        result_value: obs.value,
        reference_range: obs.refRange,
        status: statusClassification,
        loinc_code: obs.loinc,
        source_system: sendingApp,
      };
    });

    if (insertPayload.length > 0) {
      await supabaseAdmin.from('test_results').insert(insertPayload);
    }

    // Audit Success Log
    await supabaseAdmin.from('ehr_integration_logs').insert([
      {
        source_system: sendingApp,
        protocol: 'HL7_V2_ORU',
        message_type: 'ORU^R01',
        patient_mrn: patientMrn,
        status: 'PROCESSED',
        raw_payload: rawMessage,
      },
    ]);

    // Return standard HL7 Application Accept (AA) ACK
    const ackSuccess = `MSH|^~\\&|AuraMed|HospitalSystem|${sendingApp}|LAB|${new Date().toISOString()}||ACK|${mshControlId}|P|2.5\rMSA|AA|${mshControlId}|Results loaded successfully for ${patient.full_name}`;

    return new Response(ackSuccess, {
      headers: { 'Content-Type': 'text/plain' },
      status: 200,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}