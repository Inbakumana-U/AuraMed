"use client";
import { ArrowDownUp, FlaskConical, LoaderCircle, Sparkles } from "lucide-react";

type Test = { test: string; date: string; value: string; range: string; status: "High" | "Borderline" | "Normal" };
const statusStyle = { High: "text-rose-200 bg-rose-400/10", Borderline: "text-amber-200 bg-amber-300/10", Normal: "text-emerald-200 bg-emerald-300/10" };

export function TestResultsTable({ tests, onAnalyze, isAnalyzing }: { tests: Test[]; onAnalyze: () => void; isAnalyzing: boolean }) {
  return (
    <section className="glass-card overflow-hidden" aria-labelledby="tests-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3"><div className="flex items-center gap-2"><FlaskConical className="size-5 text-clinical-teal" /><h2 id="tests-heading" className="font-semibold">Recent test results</h2></div><div className="flex items-center gap-3"><button onClick={onAnalyze} disabled={isAnalyzing} className="inline-flex items-center gap-1 rounded-lg border border-teal-300/20 bg-teal-300/10 px-2.5 py-1.5 text-xs font-medium text-teal-100 disabled:opacity-60">{isAnalyzing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{isAnalyzing ? "Analyzing…" : "Analyze next steps"}</button><button className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white"><ArrowDownUp className="size-3.5" /> Latest first</button></div></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-y border-white/10 bg-white/[0.025] text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 font-medium">Test</th><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Result</th><th className="px-4 py-3 font-medium">Reference</th><th className="px-5 py-3 font-medium">Status</th></tr></thead><tbody>{tests.map((test) => <tr key={test.test} className="border-b border-white/5 last:border-0"><td className="px-5 py-4 font-medium text-slate-100">{test.test}</td><td className="px-4 py-4 text-slate-400">{test.date}</td><td className="px-4 py-4 text-slate-200">{test.value}</td><td className="px-4 py-4 text-slate-400">{test.range}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs ${statusStyle[test.status]}`}>{test.status}</span></td></tr>)}</tbody></table></div>
    </section>
  );
}
