import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { patient, vitals, conditions, tests } = body;

    const groqApiKey = process.env.GROQ_API_KEY_SUMMARIZER || process.env.GROQ_API_KEY || '';
    if (!groqApiKey) {
      return NextResponse.json(
        { error: 'GROQ_API_KEY_SUMMARIZER is not configured in .env.local' },
        { status: 500 }
      );
    }

    if (!patient?.id) {
      return NextResponse.json({ error: 'Patient data is required.' }, { status: 400 });
    }

    // 1. Dynamically query Groq's active models catalog to avoid decommissioned models
    let availableModels: string[] = [];
    try {
      const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${groqApiKey}` },
      });
      if (modelsRes.ok) {
        const modelsJson = await modelsRes.json();
        availableModels = (modelsJson.data || [])
          .filter((m: any) => m.active !== false)
          .map((m: any) => m.id);
      }
    } catch (e) {
      console.warn('Could not retrieve dynamic model list, using defaults:', e);
    }

    // Prioritized preferences among current active Groq models
    const preferredCandidates = [
      'llama-3.1-8b-instant',
      'llama-3.3-70b-specdec',
      'qwen-2.5-32b',
      'deepseek-r1-distill-llama-70b',
      'gemma2-9b-it',
    ];

    // Filter to models that actually exist in your account catalog
    let candidateList = preferredCandidates.filter((m) => availableModels.includes(m));
    if (candidateList.length === 0) {
      // Fallback to text models currently available in your account
      candidateList = availableModels.filter(
        (m) => !m.includes('whisper') && !m.includes('guard') && !m.includes('vision')
      );
    }
    // Ultimate fallback if catalog was unreachable
    if (candidateList.length === 0) {
      candidateList = ['llama-3.1-8b-instant'];
    }

    const prompt = `
You are an expert clinical reasoning engine for AuraMed Health Systems. Synthesize this electronic medical record into a structured triage summary.

Patient: ${patient?.full_name || 'Unknown'} (MRN: ${patient?.mrn || 'N/A'})
Acuity: ${patient?.acuity_status || 'Stable'} (${patient?.department || 'General'})
Triage Admission Notes: ${patient?.admission_notes || 'None'}

Current Telemetry:
- Heart Rate: ${vitals?.heart_rate ?? '--'} bpm
- Blood Pressure: ${vitals?.systolic_bp ?? '--'}/${vitals?.diastolic_bp ?? '--'} mmHg
- SpO2: ${vitals?.oxygen_saturation ?? '--'}%
- Core Temperature: ${vitals?.temperature ?? '--'} °C

Active Conditions:
${(conditions || []).map((c: any) => `- ${c.condition_name}: ${c.notes || 'Documented'}`).join('\n') || 'None reported'}

Diagnostic Labs:
${(tests || []).map((t: any) => `- ${t.test_name}: ${t.result_value} (${t.status})`).join('\n') || 'None reported'}

Return strict JSON only matching this schema without preamble or markdown ticks:
{
  "executive_summary": "Comprehensive 2-3 sentence clinical narrative detailing current status, risk factors, and trajectory.",
  "critical_alerts": ["Flag 1", "Flag 2"],
  "recommended_actions": ["Action 1", "Action 2"]
}
`;

    let groqJson: any = null;
    let selectedModel = '';
    let lastError = '';

    for (const model of candidateList) {
      try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${groqApiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'You are an emergency and inpatient medicine AI synthesizer. Return valid JSON only.' },
              { role: 'user', content: prompt },
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' },
          }),
        });

        if (groqRes.ok) {
          groqJson = await groqRes.json();
          selectedModel = model;
          break;
        } else {
          const errText = await groqRes.text();
          lastError = `Model ${model} failed (${groqRes.status}): ${errText}`;
          console.warn(lastError);
        }
      } catch (err: any) {
        lastError = err.message;
        console.warn(`Model ${model} connection error:`, err);
      }
    }

    if (!groqJson) {
      return NextResponse.json(
        { error: `Unable to access Groq inference models. Last error: ${lastError}` },
        { status: 502 }
      );
    }

    let rawContent = groqJson.choices?.[0]?.message?.content || '{}';
    rawContent = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsedSynthesis: any;
    try {
      parsedSynthesis = JSON.parse(rawContent);
    } catch {
      parsedSynthesis = {
        executive_summary: rawContent || 'Clinical synthesis generation completed.',
        critical_alerts: [],
        recommended_actions: [],
      };
    }

    const executiveSummary = parsedSynthesis.executive_summary || 'Clinical synthesis generation completed.';
    const criticalAlerts = Array.isArray(parsedSynthesis.critical_alerts) ? parsedSynthesis.critical_alerts : [];
    const recommendedActions = Array.isArray(parsedSynthesis.recommended_actions) ? parsedSynthesis.recommended_actions : [];

    // Persist as DRAFT_UNVERIFIED
    const { data: savedRecord, error: insertError } = await supabaseAdmin
      .from('ai_clinical_syntheses')
      .insert([
        {
          patient_id: patient.id,
          model_name: selectedModel,
          status: 'DRAFT_UNVERIFIED',
          executive_summary: executiveSummary,
          critical_alerts: criticalAlerts,
          recommended_actions: recommendedActions,
          raw_ai_response: groqJson,
        },
      ])
      .select()
      .single();

    if (insertError) {
      console.warn('Draft synthesis storage warning:', insertError.message);
    }

    return NextResponse.json({
      id: savedRecord?.id || null,
      status: 'DRAFT_UNVERIFIED',
      model_name: selectedModel,
      executive_summary: executiveSummary,
      critical_alerts: criticalAlerts,
      recommended_actions: recommendedActions,
    });
  } catch (err: any) {
    console.error('Summarize error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}