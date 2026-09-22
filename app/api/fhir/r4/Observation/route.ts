import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function POST(req: Request) {
  try {
    const fhirResource = await req.json();

    if (fhirResource.resourceType !== 'Observation') {
      return NextResponse.json(
        {
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'error', code: 'invalid', diagnostics: 'Expected resourceType Observation' }],
        },
        { status: 400 }
      );
    }

    // Extract Subject (Patient reference: "Patient/MRN-84920" or UUID)
    const subjectRef: string = fhirResource.subject?.reference || '';
    const mrnMatch = subjectRef.replace(/^Patient\//, '');

    if (!mrnMatch) {
      return NextResponse.json(
        {
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'error', code: 'required', diagnostics: 'Missing subject.reference' }],
        },
        { status: 422 }
      );
    }

    // Lookup patient in AuraMed
    const { data: patient } = await supabaseAdmin
      .from('patients')
      .select('id, full_name')
      .or(`mrn.eq.${mrnMatch},fhir_id.eq.${mrnMatch}`)
      .maybeSingle();

    if (!patient) {
      await supabaseAdmin.from('ehr_integration_logs').insert([
        {
          source_system: 'SMART_ON_FHIR',
          protocol: 'FHIR_R4',
          message_type: 'Observation',
          patient_mrn: mrnMatch,
          status: 'UNMATCHED_PATIENT',
          raw_payload: JSON.stringify(fhirResource),
          error_message: `No patient linked to FHIR reference ${subjectRef}`,
        },
      ]);

      return NextResponse.json(
        {
          resourceType: 'OperationOutcome',
          issue: [{ severity: 'warning', code: 'not-found', diagnostics: `Patient ${mrnMatch} not enrolled in AuraMed` }],
        },
        { status: 404 }
      );
    }

    // Extract LOINC, Name, and Value
    const coding = fhirResource.code?.coding?.[0] || {};
    const loincCode = coding.code || '';
    const testName = coding.display || fhirResource.code?.text || 'Clinical Observation';

    let resultValue = '';
    if (fhirResource.valueQuantity) {
      resultValue = `${fhirResource.valueQuantity.value} ${fhirResource.valueQuantity.unit || ''}`.trim();
    } else if (fhirResource.valueString) {
      resultValue = fhirResource.valueString;
    }

    const refRange = fhirResource.referenceRange?.[0]?.text || '';
    
    // Status mapping (FHIR interpretation: H = High, L = Low, A = Abnormal, C = Critical)
    const interpretation = fhirResource.interpretation?.[0]?.coding?.[0]?.code || 'N';
    let statusClass = 'normal';
    if (['C', 'AA', 'HH', 'LL'].includes(interpretation)) statusClass = 'critical';
    else if (['A', 'H', 'L'].includes(interpretation)) statusClass = 'abnormal';

    const effectiveDate = fhirResource.effectiveDateTime
      ? fhirResource.effectiveDateTime.split('T')[0]
      : new Date().toISOString().split('T')[0];

    // Insert lab test
    await supabaseAdmin.from('test_results').insert([
      {
        patient_id: patient.id,
        test_name: testName,
        category: 'Diagnostic Lab',
        test_date: effectiveDate,
        result_value: resultValue,
        reference_range: refRange,
        status: statusClass,
        loinc_code: loincCode,
        fhir_resource_id: fhirResource.id || `FHIR-${Date.now()}`,
        source_system: 'EPIC_FHIR_R4',
      },
    ]);

    await supabaseAdmin.from('ehr_integration_logs').insert([
      {
        source_system: 'EPIC_FHIR_R4',
        protocol: 'FHIR_R4',
        message_type: 'Observation',
        patient_mrn: mrnMatch,
        status: 'PROCESSED',
        raw_payload: JSON.stringify(fhirResource),
      },
    ]);

    return NextResponse.json(
      {
        resourceType: 'Observation',
        id: fhirResource.id || 'accepted',
        status: 'final',
        meta: { lastUpdated: new Date().toISOString() },
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}