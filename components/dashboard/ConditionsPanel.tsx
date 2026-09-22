import { CheckCircle2, CircleAlert, Stethoscope } from "lucide-react";

type Condition = { name: string; status: "active" | "managed" | "resolved"; diagnosed: string };
const statusStyle = { active: "bg-rose-400/10 text-rose-200 ring-rose-300/20", managed: "bg-teal-300/10 text-teal-200 ring-teal-300/20", resolved: "bg-slate-300/10 text-slate-300 ring-white/10" };

export function ConditionsPanel({ conditions }: { conditions: Condition[] }) {
  return (
    <section className="glass-card p-5" aria-labelledby="conditions-heading">
      <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Stethoscope className="size-5 text-clinical-teal" /><h2 id="conditions-heading" className="font-semibold">Medical conditions</h2></div><span className="text-xs text-slate-400">{conditions.length} recorded</span></div>
      <div className="mt-5 space-y-3">
        {conditions.map((condition) => (
          <div key={condition.name} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/10 p-3">
            {condition.status === "resolved" ? <CheckCircle2 className="size-4 text-slate-400" /> : <CircleAlert className="size-4 text-clinical-teal" />}
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{condition.name}</p><p className="text-xs text-slate-500">Since {condition.diagnosed}</p></div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium capitalize ring-1 ${statusStyle[condition.status]}`}>{condition.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
