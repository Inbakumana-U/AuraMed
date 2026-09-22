import { Activity, HeartPulse, Thermometer, Wind } from "lucide-react";

type Vital = {
  label: string;
  value: string;
  unit: string;
  state: "normal" | "caution" | "attention";
  detail: string;
};

const iconByLabel = { "Heart rate": HeartPulse, "Blood pressure": Activity, "SpO₂": Wind, Temperature: Thermometer };
const styleByState = {
  normal: "border-emerald-300/20 bg-emerald-300/[0.045] shadow-[0_0_30px_rgb(52_211_153/0.09)] text-emerald-300",
  caution: "border-amber-300/25 bg-amber-300/[0.045] shadow-[0_0_30px_rgb(252_211_77/0.1)] text-amber-300",
  attention: "border-rose-400/25 bg-rose-400/[0.045] shadow-[0_0_30px_rgb(251_113_133/0.12)] text-rose-300",
};

export function VitalsCardGrid({ vitals }: { vitals: Vital[] }) {
  return (
    <section aria-labelledby="vitals-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="vitals-heading" className="text-base font-semibold">Latest vitals</h2>
        <span className="text-xs text-slate-400">Recorded today · 10:42</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {vitals.map((vital) => {
          const Icon = iconByLabel[vital.label as keyof typeof iconByLabel];
          return (
            <article key={vital.label} className={`rounded-2xl border p-4 backdrop-blur-md ${styleByState[vital.state]}`}>
              <div className="flex items-start justify-between"><Icon className="size-5" /><span className="mt-1 size-2 rounded-full bg-current shadow-[0_0_10px_currentColor]" /></div>
              <p className="mt-6 text-xs font-medium uppercase tracking-wider text-slate-400">{vital.label}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{vital.value}<span className="ml-1 text-sm font-medium text-slate-400">{vital.unit}</span></p>
              <p className="mt-2 text-xs text-slate-400">{vital.detail}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
