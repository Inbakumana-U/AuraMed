"use client";

import { useState } from "react";
import { CalendarDays, FileText, Sparkles } from "lucide-react";
import { AiPanel } from "@/components/dashboard/AiPanel";
import { ConditionsPanel } from "@/components/dashboard/ConditionsPanel";
import { SurgicalHistoryCard } from "@/components/dashboard/SurgicalHistoryCard";
import { TestResultsTable } from "@/components/dashboard/TestResultsTable";
import { TreatmentTimeline } from "@/components/dashboard/TreatmentTimeline";
import { VitalsCardGrid } from "@/components/dashboard/VitalsCardGrid";
import { usePatientAi } from "@/hooks/usePatientAi";
import { mockPatient } from "@/lib/mock-patient";

export function PatientDashboard({ patientId = mockPatient.id }: { patientId?: string }) {
  const [startDate, setStartDate] = useState("2023-01-01");
  const [endDate, setEndDate] = useState("2024-06-18");
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<"summary" | "analysis">("summary");
  const ai = usePatientAi();
  async function showSummary() { setTab("summary"); setPanelOpen(true); await ai.generateSummary(startDate, endDate); }
  async function showAnalysis() { setTab("analysis"); setPanelOpen(true); await ai.analyzeTreatment(); }
  return <><main className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8"><header className="glass-card p-5 sm:p-6"><div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center"><div className="flex items-center gap-4"><div className="flex size-14 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10 text-xl font-semibold text-teal-100">EW</div><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{mockPatient.fullName}</h1><span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-2.5 py-1 text-xs font-medium text-teal-100">{mockPatient.status}</span></div><p className="mt-1 text-sm text-slate-400">{mockPatient.age} years · Blood type {mockPatient.bloodType} · Patient ID {patientId}</p></div></div><div className="flex items-center gap-2 text-sm text-slate-400"><span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgb(74_222_128/0.8)]" /> Record synced just now</div></div></header>
    <section className="screen-only glass-card mt-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap items-center gap-2"><CalendarDays className="ml-2 size-4 text-slate-400" /><input aria-label="History start date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-xs text-slate-200" /><span className="text-xs text-slate-500">to</span><input aria-label="History end date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-xs text-slate-200" /></div><button onClick={showSummary} disabled={ai.summaryLoading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-300 to-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-70"><Sparkles className={`size-4 ${ai.summaryLoading ? "animate-spin" : ""}`} />{ai.summaryLoading ? "Generating…" : "Generate AI summary"}</button></section>
    <div className="mt-6"><VitalsCardGrid vitals={mockPatient.vitals} /></div><div className="mt-6 grid gap-6 xl:grid-cols-[0.88fr_1.12fr]"><div className="space-y-6"><ConditionsPanel conditions={mockPatient.conditions} /><TreatmentTimeline treatments={mockPatient.treatments} /></div><div className="space-y-6"><TestResultsTable tests={mockPatient.tests} onAnalyze={showAnalysis} isAnalyzing={ai.analysisLoading} /><SurgicalHistoryCard surgeries={mockPatient.surgeries} /></div></div><div className="mt-5 flex items-center gap-2 text-xs text-slate-500"><FileText className="size-3.5" /> Demo patient data only — verify all clinical information in the source record.</div></main>
    <AiPanel open={panelOpen} onClose={() => setPanelOpen(false)} tab={tab} onTab={setTab} summary={ai.summary} analysis={ai.analysis} summaryLoading={ai.summaryLoading} analysisLoading={ai.analysisLoading} error={ai.error} onGenerateSummary={showSummary} onAnalyze={showAnalysis} onPrint={() => window.print()} /><PrintableReport patientId={patientId} summary={ai.summary} analysis={ai.analysis} /></>;
}

function PrintableReport({ patientId, summary, analysis }: { patientId: string; summary: ReturnType<typeof usePatientAi>["summary"]; analysis: ReturnType<typeof usePatientAi>["analysis"] }) { return <article className="print-report hidden"><h1>AuraMed Clinical Report</h1><p><strong>Patient:</strong> {mockPatient.fullName} · {mockPatient.age} years · {mockPatient.bloodType} · ID {patientId}</p><p><strong>Generated:</strong> {new Date().toLocaleString()}</p>{summary && <><h2>Comprehensive History Summary</h2><p>{summary.overview}</p><h3>Notable trends</h3><ul>{summary.notable_trends.map((trend) => <li key={trend}>{trend}</li>)}</ul></>}{analysis && <><h2>Treatment Analysis & Next Steps</h2><p>{analysis.clinical_assessment}</p><h3>Clinical warnings</h3><ul>{analysis.contraindications_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></>}<p><em>Clinical decision support only. Requires review by a qualified clinician.</em></p></article>; }
