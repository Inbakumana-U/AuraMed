import { NextResponse } from "next/server";
import { z } from "zod";

import { groqClinical } from "@/lib/groq/clients";
import { clinicalRecordSchema, parseModelJson, validationMessage } from "@/lib/groq/utils";

const requestSchema = z.object({
  latest_vitals: z.object({
    recorded_at: z.string().max(40).optional(),
    heart_rate: z.number().finite().positive().optional(),
    systolic_bp: z.number().finite().positive().optional(),
    diastolic_bp: z.number().finite().positive().optional(),
    respiratory_rate: z.number().finite().positive().optional(),
    oxygen_saturation: z.number().finite().min(0).max(100).optional(),
    temperature: z.number().finite().optional(),
  }).optional(),
  recent_lab_results: z.array(clinicalRecordSchema.extend({ result_value: z.string().max(500).optional(), reference_range: z.string().max(500).optional(), status: z.string().max(40).optional() })).max(100).default([]),
  current_treatments: z.array(clinicalRecordSchema.extend({ dosage: z.string().max(500).optional() })).max(100).default([]),
  active_conditions: z.array(clinicalRecordSchema).max(100).default([]),
});

const responseSchema = z.object({
  clinical_assessment: z.string(),
  vital_risk_flags: z.array(z.object({ flag: z.string(), severity: z.enum(["low", "moderate", "high", "urgent"]), rationale: z.string() })),
  recommended_pathways: z.array(z.object({ pathway: z.string(), rationale: z.string(), urgency: z.enum(["routine", "soon", "urgent"]) })),
  contraindications_warnings: z.array(z.string()),
  recommended_followup_tests: z.array(z.object({ test: z.string(), purpose: z.string(), timeframe: z.string() })),
}).strict();

type TreatmentAnalysisResponse = z.infer<typeof responseSchema>;

function fallbackAnalysis(): TreatmentAnalysisResponse {
  return {
    clinical_assessment: "Automated treatment analysis is temporarily unavailable. A licensed clinician should review all current findings and treatment decisions.",
    vital_risk_flags: [],
    recommended_pathways: [],
    contraindications_warnings: ["No AI-derived contraindication screening is available in this fallback response."],
    recommended_followup_tests: [],
  };
}

const systemPrompt = `You are AuraMed's Clinical Pharmacology & Treatment Decision Specialist. Analyze only the supplied clinical data and provide conservative, evidence-aware decision support for a licensed clinician. Do not diagnose, prescribe, calculate a dose, or claim that a treatment is safe. Flag uncertainty, missing medication/allergy/renal/hepatic data, and situations that need urgent in-person assessment. Do not invent facts. This output is not medical advice for a patient and must be reviewed by a qualified clinician.

Return valid JSON only, with exactly these fields:
{
  "clinical_assessment": "string",
  "vital_risk_flags": [{ "flag": "string", "severity": "low|moderate|high|urgent", "rationale": "string" }],
  "recommended_pathways": [{ "pathway": "string", "rationale": "string", "urgency": "routine|soon|urgent" }],
  "contraindications_warnings": ["string"],
  "recommended_followup_tests": [{ "test": "string", "purpose": "string", "timeframe": "string" }]
}`;

export async function POST(request: Request) {
  let payload: z.infer<typeof requestSchema>;

  try {
    payload = requestSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? validationMessage(error) : "Request body must be valid JSON.";
    return NextResponse.json({ error: "Invalid treatment-analysis request.", details: message }, { status: 400 });
  }

  try {
    const completion = await groqClinical.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });

    const parsed = responseSchema.safeParse(parseModelJson(completion.choices[0]?.message.content));
    if (!parsed.success) {
      console.error("Treatment analysis response validation failed:", validationMessage(parsed.error));
      return NextResponse.json({ result: fallbackAnalysis(), fallback: true, error: "AI response did not match the required clinical schema." }, { status: 502 });
    }

    return NextResponse.json({ result: parsed.data, fallback: false });
  } catch (error) {
    console.error("Treatment analysis failed:", error);
    return NextResponse.json({ result: fallbackAnalysis(), fallback: true, error: "Treatment analysis is temporarily unavailable." }, { status: 503 });
  }
}
