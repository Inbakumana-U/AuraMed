import { Building2, Scissors } from "lucide-react";

type Surgery = { procedure: string; date: string; surgeon: string; hospital: string; notes: string };
export function SurgicalHistoryCard({ surgeries }: { surgeries: Surgery[] }) {
  return <section className="glass-card p-5" aria-labelledby="surgery-heading"><div className="flex items-center gap-2"><Scissors className="size-5 text-clinical-indigo" /><h2 id="surgery-heading" className="font-semibold">Surgical history</h2></div><div className="mt-5 grid gap-3">{surgeries.map((surgery) => <article key={surgery.procedure} className="neumorphic-inset p-4"><div className="flex justify-between gap-3"><h3 className="text-sm font-medium">{surgery.procedure}</h3><time className="shrink-0 text-xs text-slate-500">{surgery.date}</time></div><p className="mt-2 text-xs text-slate-400">{surgery.surgeon}</p><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Building2 className="size-3" />{surgery.hospital}</p><p className="mt-3 border-t border-white/5 pt-3 text-xs leading-relaxed text-slate-400">{surgery.notes}</p></article>)}</div></section>;
}
