"use client";

import { useCallback, useState } from "react";

import { mockPatient } from "@/lib/mock-patient";

type Summary = {
  overview: string;
  key_events: { date: string; event: string; significance: string }[];
  active_regimen: { treatment: string; dosage: string | null; purpose: string }[];
  notable_trends: string[];
};

type Analysis = {
  clinical_assessment: string;
  vital_risk_flags: { flag: string; severity: "low" | "moderate" | "high" | "urgent"; rationale: string }[];
  recommended_pathways: { pathway: string; rationale: string; urgency: "routine" | "soon" | "urgent" }[];
  contraindications_warnings: string[];
  recommended_followup_tests: { test: string; purpose: string; timeframe: string }[];
};

async function postAgent<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  // Agent routes return a schema-safe fallback result during provider outages.
  // Preserve it so clinicians still receive the explicit degraded-mode notice.
  if (!data?.result) throw new Error(data?.error || "The AI service is unavailable.");
  return data.result as T;
}

export function usePatientAi() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateSummary = useCallback(async (start: string, end: string) => {
    setSummaryLoading(true); setError(null);
    try {
      const result = await postAgent<Summary>("/api/agents/summarize", {
        patient: { full_name: mockPatient.fullName }, date_range: { start, end },
        conditions: mockPatient.conditions.map(({ name, status, diagnosed }) => ({ name, status, date: diagnosed })),
        surgical_history: mockPatient.surgeries.map(({ procedure, date, notes }) => ({ name: procedure, date, details: notes })),
        treatments: mockPatient.treatments.map(({ name, category, date, dose, note }) => ({ name, category: category === "ongoing" ? "present" : "past", date, dosage: dose, details: note })),
      });
      setSummary(result);
      return result;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not generate a history summary."); return null; }
    finally { setSummaryLoading(false); }
  }, []);

  const analyzeTreatment = useCallback(async () => {
    setAnalysisLoading(true); setError(null);
    try {
      const result = await postAgent<Analysis>("/api/agents/treatment-analysis", {
        latest_vitals: { recorded_at: "2024-06-18T10:42:00Z", heart_rate: 78, systolic_bp: 138, diastolic_bp: 86, oxygen_saturation: 97, temperature: 37.8 },
        recent_lab_results: mockPatient.tests.map(({ test, date, value, range, status }) => ({ name: test, date, result_value: value, reference_range: range, status })),
        current_treatments: mockPatient.treatments.filter((treatment) => treatment.category === "ongoing").map(({ name, dose, note }) => ({ name, dosage: dose, details: note })),
        active_conditions: mockPatient.conditions.filter((condition) => condition.status !== "resolved").map(({ name, diagnosed }) => ({ name, date: diagnosed })),
      });
      setAnalysis(result);
      return result;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not analyze treatment options."); return null; }
    finally { setAnalysisLoading(false); }
  }, []);

  return { summary, analysis, summaryLoading, analysisLoading, error, generateSummary, analyzeTreatment };
}
