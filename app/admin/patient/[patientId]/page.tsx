'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

interface Patient {
  id: string;
  full_name: string;
  mrn: string;
  dob: string;
  gender: string;
  blood_type: string;
  department: string;
  acuity_status: string;
  admission_notes?: string;
  attending_doctor_id?: string;
}

interface Doctor {
  id: string;
  full_name: string;
  role: string;
  staff_id: string;
  email: string;
}

interface ActiveDelegation {
  id: string;
  delegating_doctor_id: string;
  covering_doctor_id: string;
  delegating_name: string;
  covering_name: string;
  starts_at: string;
  ends_at: string;
  sbar_situation: string;
  sbar_recommendation: string;
}

interface Vitals {
  heart_rate: number | string;
  systolic_bp: number | string;
  diastolic_bp: number | string;
  respiratory_rate: number | string;
  oxygen_saturation: number | string;
  temperature: number | string;
}

export default function AdminPatientDetailPage() {
  const { patientId } = useParams() as { patientId: string };
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [vitals, setVitals] = useState<Vitals>({
    heart_rate: '--',
    systolic_bp: '--',
    diastolic_bp: '--',
    respiratory_rate: '--',
    oxygen_saturation: '--',
    temperature: '--',
  });
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [activeDelegation, setActiveDelegation] = useState<ActiveDelegation | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [reassignRationale, setReassignRationale] = useState('Administrative service redistribution');
  const [reassigning, setReassigning] = useState(false);

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  const supabase = useMemo(() => {
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  }, [supabaseUrl, supabaseAnonKey]);

  const loadData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }

    const nowIso = new Date().toISOString();

    const [pRes, vRes, docRes, delRes] = await Promise.all([
      supabase.from('patients').select('*').eq('id', patientId).single(),
      supabase.from('vitals_records').select('*').eq('patient_id', patientId).order('recorded_at', { ascending: false }).limit(1),
      supabase.from('clinicians').select('id, full_name, role, staff_id, email').order('full_name', { ascending: true }),
      supabase
        .from('shift_coverage_delegations')
        .select('*')
        .eq('patient_id', patientId)
        .eq('status', 'ACTIVE')
        .gte('ends_at', nowIso)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const docMap = new Map<string, string>();
    (docRes.data || []).forEach((d) => docMap.set(d.id, d.full_name));

    if (pRes.data) {
      setPatient(pRes.data as Patient);
      setSelectedDoctorId(pRes.data.attending_doctor_id || '');
    }

    if (vRes.data?.[0]) setVitals(vRes.data[0]);
    if (docRes.data) setDoctors(docRes.data as Doctor[]);

    if (delRes.data) {
      const d = delRes.data;
      setActiveDelegation({
        ...d,
        delegating_name: docMap.get(d.delegating_doctor_id) || 'Primary Attending',
        covering_name: docMap.get(d.covering_doctor_id) || 'On-Call Clinician',
      });
    } else {
      setActiveDelegation(null);
    }

    setLoading(false);
  };

  useEffect(() => {
    setMounted(true);
    loadData();

    // Realtime listeners so changes in doctor handoffs or vitals update instantly
    const channel = supabase
      .channel(`admin_patient_sync_${patientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients', filter: `id=eq.${patientId}` }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_coverage_delegations', filter: `patient_id=eq.${patientId}` }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vitals_records', filter: `patient_id=eq.${patientId}` }, () => loadData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [patientId, supabase]);

  const handleReassignDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoctorId || !patient) return;
    setReassigning(true);

    try {
      const newDoc = doctors.find((d) => d.id === selectedDoctorId);

      // 1. Update permanent attending doctor on patient
      const { error: pErr } = await supabase
        .from('patients')
        .update({ attending_doctor_id: selectedDoctorId })
        .eq('id', patient.id);

      if (pErr) throw pErr;

      // 2. Terminate any previous temporary handoff so the new doctor has immediate custody
      await supabase
        .from('shift_coverage_delegations')
        .update({ status: 'SUPERSEDED_BY_ADMIN' })
        .eq('patient_id', patient.id)
        .eq('status', 'ACTIVE');

      // 3. Stamp to Medico-Legal Audit Trail
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('medico_legal_audit_logs').insert([
        {
          actor_id: user?.id || 'a0000000-0000-0000-0000-000000000001',
          actor_email: user?.email || 'Hospital Administration',
          actor_role: 'ADMIN',
          action_type: 'PATIENT_REASSIGNED',
          resource_type: 'PATIENT_DOSSIER',
          resource_id: patient.id,
          patient_mrn: patient.mrn,
          patient_name: patient.full_name,
          state_delta: {
            event: 'ADMIN_PERMANENT_DOCTOR_REASSIGNMENT',
            previous_doctor_id: patient.attending_doctor_id,
            new_doctor_id: selectedDoctorId,
            new_doctor_name: newDoc?.full_name,
            rationale: reassignRationale,
          },
        },
      ]);

      alert(`Patient successfully reassigned to ${newDoc?.full_name || 'selected physician'}.`);
      await loadData();
    } catch (err: any) {
      alert(`Reassignment failed: ${err.message}`);
    }
    setReassigning(false);
  };

  if (!mounted || loading || !patient) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  const permanentDoctor = doctors.find((d) => d.id === patient.attending_doctor_id);
  const currentActiveDoctorName = activeDelegation ? activeDelegation.covering_name : (permanentDoctor?.full_name || 'Unassigned');
  const isCurrentlyHandedOff = Boolean(activeDelegation);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-30 px-4 sm:px-8 py-3.5 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/admin" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white border border-emerald-200 flex items-center justify-center p-1.5 shadow-kwik-card overflow-hidden shrink-0">
              <img src="/auramed-logo.png" alt="AuraMed" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                AuraMed
                <span className="text-[10px] font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-300">
                  ADMIN DOSSIER
                </span>
              </h1>
              <p className="text-[11px] sm:text-xs text-slate-500 font-medium hidden xs:block">Central Inpatient Oversight</p>
            </div>
          </Link>

          <Link
            href="/admin"
            className="px-3.5 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            ← Back to Command Center
          </Link>
        </div>
      </header>

      {/* Main Body */}
      <main className="max-w-7xl mx-auto p-4 sm:p-8 space-y-6">
        {/* Top Patient Summary Banner */}
        <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-kwik-card flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-extrabold text-slate-900">{patient.full_name}</h1>
              <span className="text-xs px-3 py-0.5 rounded-full font-bold bg-slate-100 text-slate-700 border border-slate-200">
                {patient.department}
              </span>
              <span className={`text-xs px-3 py-0.5 rounded-full font-bold border ${
                patient.acuity_status === 'Critical'
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : patient.acuity_status === 'Serious'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {patient.acuity_status}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-2">
              <span>ID: <strong className="font-mono text-emerald-700">{patient.id}</strong></span>
              <span>•</span>
              <span>MRN: {patient.mrn}</span>
              <span>•</span>
              <span>DOB: {patient.dob}</span>
              <span>•</span>
              <span>Blood: {patient.blood_type}</span>
            </div>
          </div>

          {/* Dynamic Live Doctor Status Badge */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-1">
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Current Active Clinician</div>
            <div className="text-sm font-extrabold text-emerald-800 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              {currentActiveDoctorName}
            </div>
            {isCurrentlyHandedOff && (
              <div className="text-[10px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                Temporary Handoff (Attending: {permanentDoctor?.full_name || 'Unassigned'})
              </div>
            )}
          </div>
        </div>

        {/* 2-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Left 2 Columns: Clinical telemetry & notes */}
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs">
                <span className="text-[10px] font-bold uppercase text-slate-400">Heart Rate</span>
                <div className="text-xl font-extrabold text-slate-900 mt-1">{vitals.heart_rate} <span className="text-xs font-normal text-slate-400">bpm</span></div>
              </div>
              <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs">
                <span className="text-[10px] font-bold uppercase text-slate-400">BP</span>
                <div className="text-xl font-extrabold text-slate-900 mt-1">{vitals.systolic_bp}/{vitals.diastolic_bp}</div>
              </div>
              <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs">
                <span className="text-[10px] font-bold uppercase text-slate-400">SpO2</span>
                <div className="text-xl font-extrabold text-slate-900 mt-1">{vitals.oxygen_saturation}%</div>
              </div>
              <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs">
                <span className="text-[10px] font-bold uppercase text-slate-400">Temp</span>
                <div className="text-xl font-extrabold text-slate-900 mt-1">{vitals.temperature}°C</div>
              </div>
            </div>

            <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-kwik-card">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 mb-2">Admission & Triage Summary</h2>
              <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                {patient.admission_notes || 'No specific admission notes documented.'}
              </p>
            </div>

            {activeDelegation && (
              <div className="p-5 bg-amber-50/80 border-2 border-amber-300 rounded-3xl shadow-xs">
                <div className="flex justify-between items-center pb-2 border-b border-amber-200 text-xs">
                  <span className="font-extrabold text-amber-950 uppercase tracking-wider">Active SBAR Shift Handoff Note</span>
                  <span className="font-bold text-amber-900">Until {new Date(activeDelegation.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="text-xs text-amber-950 mt-2 space-y-1">
                  <div><strong>Delegating Physician:</strong> {activeDelegation.delegating_name}</div>
                  <div><strong>Covering Physician:</strong> {activeDelegation.covering_name}</div>
                  <div><strong>Situation:</strong> {activeDelegation.sbar_situation}</div>
                  <div><strong>Orders:</strong> {activeDelegation.sbar_recommendation}</div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Fixed Sidebar for Doctor Re-assignment (Never shifts position) */}
          <div className="lg:col-span-1">
            <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-kwik-card sticky top-24">
              <div className="pb-3 border-b border-slate-100 mb-4">
                <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5">
                  <span>🩺</span> Attending Physician Assignment
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Clinical custody & legal authority</p>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 text-xs space-y-2 mb-4">
                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">Permanent Attending</span>
                  <strong className="text-slate-900 text-sm">{permanentDoctor?.full_name || 'Unassigned'}</strong>
                  <div className="text-[10px] text-slate-500">{permanentDoctor?.staff_id} • {permanentDoctor?.role}</div>
                </div>

                <div className="pt-2 border-t border-slate-200/60">
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">Live On-Call Handler</span>
                  <strong className="text-emerald-700 text-sm">{currentActiveDoctorName}</strong>
                </div>
              </div>

              <form onSubmit={handleReassignDoctor} className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Re-assign Attending Doctor</label>
                  <select
                    required
                    value={selectedDoctorId}
                    onChange={(e) => setSelectedDoctorId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Select Doctor</option>
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.full_name} ({d.role}) - {d.staff_id}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Administrative Rationale</label>
                  <input
                    type="text"
                    required
                    value={reassignRationale}
                    onChange={(e) => setReassignRationale(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={reassigning || selectedDoctorId === patient.attending_doctor_id}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5"
                >
                  {reassigning ? 'Reassigning...' : 'Update Attending Physician'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}