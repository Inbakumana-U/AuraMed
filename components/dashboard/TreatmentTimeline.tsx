import { Pill, Repeat2 } from "lucide-react";

type Treatment = { name: string; category: "past" | "ongoing"; date: string; dose: string; note: string };

export function TreatmentTimeline({ treatments }: { treatments: Treatment[] }) {
  return (
    <section className="glass-card p-5" aria-labelledby="treatment-heading">
      <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Pill className="size-5 text-clinical-indigo" /><h2 id="treatment-heading" className="font-semibold">Treatment timeline</h2></div><Repeat2 className="size-4 text-slate-500" /></div>
      <ol className="mt-5 border-l border-white/10 pl-5">
        {treatments.map((treatment) => (
          <li key={treatment.name} className="relative pb-6 last:pb-0"><span className={`absolute -left-[25px] top-1 size-3 rounded-full border-2 border-clinical-slate ${treatment.category === "ongoing" ? "bg-clinical-teal shadow-[0_0_12px_rgb(45_212_191/0.8)]" : "bg-slate-500"}`} />
            <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{treatment.name}</p><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${treatment.category === "ongoing" ? "bg-teal-300/10 text-teal-200" : "bg-white/5 text-slate-400"}`}>{treatment.category}</span></div>
            <p className="mt-1 text-xs text-slate-400">{treatment.date} · {treatment.dose}</p><p className="mt-1 text-xs text-slate-500">{treatment.note}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
