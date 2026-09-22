'use client';

import React, { useState, useEffect, useTransition, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

interface CoverageBadge {
  type: 'CURRENT_COVERER' | 'CHAIN_DELEGATED' | 'DELEGATED_OUT';
  displayText: string;
  endsTimeStr: string;
  sbar_situation?: string;
}

interface Patient {
  id: string;
  full_name: string;
  mrn: string;
  dob: string;
  department: string;
  acuity_status: 'Critical' | 'Serious' | 'Stable';
  admission_notes?: string;
  attending_doctor_id?: string;
  coverageBadge?: CoverageBadge | null;
}

export default function ClinicianDashboard() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [activeUnderCareCount, setActiveUnderCareCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');
  const [sortBy, setSortBy] = useState<'date' | 'alphabetical'>('date');

  const [doctor, setDoctor] = useState<{ id: string; email: string; name: string; specialization: string } | null>(null);
  const [showDoctorModal, setShowDoctorModal] = useState(false);
  const [isAddPatientOpen, setIsAddPatientOpen] = useState(false);

  const [newPatient, setNewPatient] = useState({
    full_name: '',
    dob: '',
    gender: 'Female',
    blood_type: 'O+',
    department: 'Cardiology',
    acuity_status: 'Stable' as 'Critical' | 'Serious' | 'Stable',
    admission_notes: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  const supabase = useMemo(() => {
    return createBrowserClient(supabaseUrl, supabaseAnonKey);
  }, [supabaseUrl, supabaseAnonKey]);

  const getDoctorInitials = (fullName?: string) => {
    if (!fullName) return '';
    const cleaned = fullName.replace(/^(dr\.?|doctor)\s+/i, '').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const loadDashboard = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login');
      return;
    }

    const nowIso = new Date().toISOString();

    const [clinicianRes, primaryPatientsRes, activeDelegationsRes, allDoctorsRes] = await Promise.all([
      supabase.from('clinicians').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('patients').select('*').eq('attending_doctor_id', user.id).order('id', { ascending: false }),
      supabase
        .from('shift_coverage_delegations')
        .select('*')
        .eq('status', 'ACTIVE')
        .gte('ends_at', nowIso)
        .order('created_at', { ascending: true }),
      supabase.from('clinicians').select('id, full_name'),
    ]);

    const doctorMap = new Map<string, string>();
    (allDoctorsRes.data || []).forEach((d) => doctorMap.set(d.id, d.full_name));

    if (clinicianRes.data) {
      setDoctor({
        id: user.id,
        email: user.email || clinicianRes.data.email,
        name: clinicianRes.data.full_name || 'Dr. Sarah Connor',
        specialization: clinicianRes.data.role || 'Attending Physician',
      });
    }

    const allActiveDelegations = activeDelegationsRes.data || [];

    const delegationsByPatient = new Map<string, any[]>();
    allActiveDelegations.forEach((d) => {
      const existing = delegationsByPatient.get(d.patient_id) || [];
      existing.push(d);
      delegationsByPatient.set(d.patient_id, existing);
    });

    const patientIdsInvolved = new Set<string>();
    (primaryPatientsRes.data || []).forEach((p: any) => patientIdsInvolved.add(p.id));

    allActiveDelegations.forEach((d) => {
      if (d.covering_doctor_id === user.id || d.delegating_doctor_id === user.id) {
        patientIdsInvolved.add(d.patient_id);
      }
    });

    const missingIds = Array.from(patientIdsInvolved).filter(
      (id) => !(primaryPatientsRes.data || []).some((p: any) => p.id === id)
    );

    let extraPatients: any[] = [];
    if (missingIds.length > 0) {
      const { data: extras } = await supabase.from('patients').select('*').in('id', missingIds);
      if (extras) extraPatients = extras;
    }

    const combinedRaw = [...(primaryPatientsRes.data || []), ...extraPatients];

    const computedPatients: Patient[] = combinedRaw.map((p) => {
      const chain = delegationsByPatient.get(p.id) || [];
      let coverageBadge: CoverageBadge | null = null;

      if (chain.length > 0) {
        const latestDelegation = chain[chain.length - 1];
        const currentActiveDoctorId = latestDelegation.covering_doctor_id;
        const currentActiveDoctorName = doctorMap.get(currentActiveDoctorId) || 'On-Call Clinician';
        const endsTimeStr = new Date(latestDelegation.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        if (currentActiveDoctorId === user.id) {
          const immediatePredecessor = doctorMap.get(latestDelegation.delegating_doctor_id) || 'Physician';
          coverageBadge = {
            type: 'CURRENT_COVERER',
            displayText: `DELEGATED FROM ${immediatePredecessor}`,
            endsTimeStr,
            sbar_situation: latestDelegation.sbar_situation,
          };
        } else if (chain.some((d) => d.delegating_doctor_id === user.id)) {
          const myDelegation = chain.find((d) => d.delegating_doctor_id === user.id);
          const didIHandOffDirectlyToCurrent = myDelegation?.covering_doctor_id === currentActiveDoctorId;

          if (didIHandOffDirectlyToCurrent) {
            coverageBadge = {
              type: 'DELEGATED_OUT',
              displayText: `HANDED OFF → ${currentActiveDoctorName}`,
              endsTimeStr,
            };
          } else {
            const intermediateDoctorName = doctorMap.get(myDelegation?.covering_doctor_id) || 'Intermediate Clinician';
            coverageBadge = {
              type: 'CHAIN_DELEGATED',
              displayText: `HANDED OFF → ${currentActiveDoctorName} (via ${intermediateDoctorName})`,
              endsTimeStr,
            };
          }
        } else if (p.attending_doctor_id === user.id) {
          coverageBadge = {
            type: 'CHAIN_DELEGATED',
            displayText: `ACTIVE HANDLER: ${currentActiveDoctorName}`,
            endsTimeStr,
          };
        }
      }

      return {
        ...p,
        coverageBadge,
      };
    });

    setPatients(computedPatients);

    const activeCount = computedPatients.filter(
      (p) => !p.coverageBadge || p.coverageBadge.type === 'CURRENT_COVERER'
    ).length;
    setActiveUnderCareCount(activeCount);
    setLoading(false);
  };

  useEffect(() => {
    setMounted(true);
    loadDashboard();

    // DYNAMIC MULTI-TABLE REALTIME SYNC
    const dashboardChannel = supabase
      .channel('realtime_clinician_dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, () => {
        loadDashboard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_coverage_delegations' }, () => {
        loadDashboard();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(dashboardChannel);
    };
  }, [supabase]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    startTransition(() => {
      router.push('/login');
      router.refresh();
    });
  };

  const generateAdmissionId = () => {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const prefix = `${yy}${mm}${dd}`;
    const count = patients.filter((p) => p.id.startsWith(prefix)).length;
    return `${prefix}${String(count + 1).padStart(2, '0')}`;
  };

  const handleCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doctor?.id) return;
    setSubmitting(true);

    const generatedId = generateAdmissionId();
    const generatedMrn = `MRN-${Math.floor(10000 + Math.random() * 90000)}`;

    const optimisticRecord: Patient = {
      id: generatedId,
      full_name: newPatient.full_name,
      mrn: generatedMrn,
      dob: newPatient.dob,
      department: newPatient.department,
      acuity_status: newPatient.acuity_status,
      admission_notes: newPatient.admission_notes,
      attending_doctor_id: doctor.id,
      coverageBadge: null,
    };

    setPatients((prev) => [optimisticRecord, ...prev]);
    setActiveUnderCareCount((prev) => prev + 1);
    setIsAddPatientOpen(false);

    const { error: patientErr } = await supabase.from('patients').insert([
      {
        id: generatedId,
        hospital_id: 'a0000000-0000-0000-0000-000000000001',
        attending_doctor_id: doctor.id,
        full_name: newPatient.full_name,
        mrn: generatedMrn,
        dob: newPatient.dob,
        gender: newPatient.gender,
        blood_type: newPatient.blood_type,
        department: newPatient.department,
        acuity_status: newPatient.acuity_status,
        admission_notes: newPatient.admission_notes,
      },
    ]);

    if (!patientErr) {
      await supabase.from('vitals_records').insert([
        {
          patient_id: generatedId,
          heart_rate: 74,
          systolic_bp: 120,
          diastolic_bp: 80,
          respiratory_rate: 16,
          oxygen_saturation: 98,
          temperature: 37.0,
        },
      ]);
    } else {
      setPatients((prev) => prev.filter((p) => p.id !== generatedId));
      setActiveUnderCareCount((prev) => prev - 1);
      alert(`Admission failed: ${patientErr.message}`);
    }

    setNewPatient({
      full_name: '',
      dob: '',
      gender: 'Female',
      blood_type: 'O+',
      department: 'Cardiology',
      acuity_status: 'Stable',
      admission_notes: '',
    });
    setSubmitting(false);
  };

  if (!mounted) return null;

  const filteredPatients = patients
    .filter((p) => selectedDept === 'All' || p.department === selectedDept)
    .filter(
      (p) =>
        p.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.id.includes(searchQuery) ||
        p.mrn.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'alphabetical') return a.full_name.localeCompare(b.full_name);
      return b.id.localeCompare(a.id);
    });

  const initials = getDoctorInitials(doctor?.name);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Header */}
      <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-8 py-3.5 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white border border-emerald-200 flex items-center justify-center p-1.5 shadow-kwik-card overflow-hidden shrink-0">
              <img src="/auramed-logo.png" alt="AuraMed" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                AuraMed
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                  CLINICAL
                </span>
              </h1>
              <p className="text-[11px] sm:text-xs text-slate-500 font-medium hidden xs:block">Attending Care Roster</p>
            </div>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowDoctorModal(!showDoctorModal)}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-2xl bg-white border border-slate-200 hover:border-emerald-400 transition-all text-left shadow-xs"
            >
              <div className="w-8 h-8 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-xs font-extrabold text-emerald-800 tracking-wider shrink-0">
                {initials ? initials : <span className="w-4 h-4 rounded-md bg-emerald-200/70 animate-pulse" />}
              </div>
              <div className="hidden sm:block">
                <div className="text-xs font-bold text-slate-900">{doctor?.name || 'Attending Physician'}</div>
                <div className="text-[11px] text-emerald-600 font-semibold">{doctor?.specialization || 'Clinical Staff'}</div>
              </div>
            </button>

            {showDoctorModal && (
              <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-3xl shadow-xl p-5 z-50 animate-in fade-in zoom-in-95 duration-150">
                <div className="pb-3 border-b border-slate-100">
                  <div className="text-sm font-bold text-slate-900">{doctor?.name}</div>
                  <div className="text-xs text-slate-500 truncate">{doctor?.email}</div>
                </div>
                <div className="py-3 text-xs text-slate-600 space-y-1">
                  <div><strong>Specialization:</strong> {doctor?.specialization}</div>
                  <div><strong>Active Patients Under Care:</strong> {activeUnderCareCount}</div>
                </div>
                <button
                  onClick={handleSignOut}
                  className="w-full mt-2 py-2 text-xs font-bold bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 rounded-xl transition-colors"
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto p-4 sm:p-8">
        <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 mb-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative w-full sm:w-80">
              <input
                type="text"
                placeholder="Search name, ID, or MRN..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 shadow-kwik-card transition-all"
              />
              <svg className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            <div className="flex items-center justify-center bg-white border border-slate-200 rounded-2xl p-1 shadow-xs self-start sm:self-auto">
              <button
                onClick={() => setSortBy('date')}
                className={`px-3 py-1.5 text-xs rounded-xl font-bold transition-all ${
                  sortBy === 'date' ? 'bg-emerald-500 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Date
              </button>
              <button
                onClick={() => setSortBy('alphabetical')}
                className={`px-3 py-1.5 text-xs rounded-xl font-bold transition-all ${
                  sortBy === 'alphabetical' ? 'bg-emerald-500 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                A-Z
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-4">
            <div className="text-xs font-bold text-slate-500">
              Active Under Care: <span className="text-emerald-700 font-extrabold text-sm font-mono ml-1">{activeUnderCareCount}</span>
            </div>

            <button
              onClick={() => setIsAddPatientOpen(true)}
              className="px-4 sm:px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white text-xs font-extrabold rounded-2xl shadow-kwik-card transition-all flex items-center gap-1.5 shrink-0"
            >
              <span className="text-base leading-none">+</span> Admit
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 scrollbar-none">
          {['All', 'Cardiology', 'ICU', 'General'].map((dept) => (
            <button
              key={dept}
              onClick={() => setSelectedDept(dept)}
              className={`px-4 py-2 rounded-2xl text-xs font-bold border transition-all shrink-0 ${
                selectedDept === dept ? 'bg-slate-900 border-slate-900 text-white shadow-xs' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              {dept}
            </button>
          ))}
        </div>

        {/* Patient Cards Grid */}
        {loading ? (
          <div className="py-20 text-center">
            <div className="w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs text-slate-400">Loading patient directory...</p>
          </div>
        ) : filteredPatients.length === 0 ? (
          <div className="py-20 text-center bg-white border border-slate-200 rounded-3xl p-8 shadow-kwik-card">
            <h3 className="text-base font-bold text-slate-900">No Assigned Patients</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              You currently have no patients matching your criteria.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredPatients.map((p) => {
              const b = p.coverageBadge;
              const isReadOnly = b?.type === 'DELEGATED_OUT' || b?.type === 'CHAIN_DELEGATED';

              return (
                <Link
                  key={p.id}
                  href={`/dashboard/${p.id}`}
                  className={`group p-5 sm:p-6 bg-white border rounded-3xl transition-all shadow-kwik-card hover:scale-[1.01] flex flex-col justify-between ${
                    b?.type === 'CURRENT_COVERER'
                      ? 'border-amber-300 ring-2 ring-amber-400/20'
                      : isReadOnly
                      ? 'border-slate-200 bg-slate-50/70 opacity-85'
                      : 'border-slate-200/80 hover:border-emerald-400'
                  }`}
                >
                  <div>
                    <div className="flex justify-between items-start mb-3 gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          <h2 className="text-base font-extrabold text-slate-900 group-hover:text-emerald-600 transition-colors">
                            {p.full_name}
                          </h2>

                          {b?.type === 'CURRENT_COVERER' && (
                            <span className="text-[10px] font-extrabold bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-full border border-amber-300">
                              {b.displayText} (Until {b.endsTimeStr})
                            </span>
                          )}

                          {b?.type === 'DELEGATED_OUT' && (
                            <span className="text-[10px] font-extrabold bg-slate-200 text-slate-700 px-2.5 py-0.5 rounded-full border border-slate-300">
                              {b.displayText} (Until {b.endsTimeStr})
                            </span>
                          )}

                          {b?.type === 'CHAIN_DELEGATED' && (
                            <span className="text-[10px] font-extrabold bg-indigo-50 text-indigo-900 px-2.5 py-0.5 rounded-full border border-indigo-300">
                              {b.displayText} (Until {b.endsTimeStr})
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 font-medium">
                          <span className="font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg text-[11px] font-bold">
                            {p.id}
                          </span>
                          <span>•</span>
                          <span>{p.mrn}</span>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] sm:text-[11px] px-2.5 py-0.5 rounded-full font-bold border shrink-0 ${
                          p.acuity_status === 'Critical'
                            ? 'bg-rose-50 border-rose-200 text-rose-600'
                            : p.acuity_status === 'Serious'
                            ? 'bg-amber-50 border-amber-200 text-amber-600'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                        }`}
                      >
                        {p.acuity_status}
                      </span>
                    </div>

                    {b?.type === 'CURRENT_COVERER' && b.sbar_situation && (
                      <p className="text-xs text-amber-900 font-medium my-2 p-2.5 rounded-xl bg-amber-100/60 border border-amber-200 leading-relaxed">
                        <strong className="text-amber-950">Handoff Note:</strong> {b.sbar_situation}
                      </p>
                    )}

                    {p.admission_notes && (!b?.sbar_situation || b.type !== 'CURRENT_COVERER') && (
                      <p className="text-xs text-slate-600 line-clamp-2 my-2 p-3 rounded-2xl bg-slate-50 border border-slate-100 leading-relaxed">
                        {p.admission_notes}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-500 font-medium">
                      Unit: <strong className="text-slate-800">{p.department}</strong>
                    </span>
                    <span className="text-emerald-600 font-bold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      {isReadOnly ? 'View (Read-Only) →' : 'Inspect Dossier →'}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      {/* Admission Modal */}
      {isAddPatientOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900">Admit Patient to Care</h2>
              <button onClick={() => setIsAddPatientOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePatient} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Full Legal Name</label>
                <input
                  type="text"
                  required
                  value={newPatient.full_name}
                  onChange={(e) => setNewPatient({ ...newPatient, full_name: e.target.value })}
                  placeholder="e.g. Arthur Pendelton"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500 transition-all"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Date of Birth</label>
                  <input
                    type="date"
                    required
                    value={newPatient.dob}
                    onChange={(e) => setNewPatient({ ...newPatient, dob: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Blood Type</label>
                  <select
                    value={newPatient.blood_type}
                    onChange={(e) => setNewPatient({ ...newPatient, blood_type: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500 transition-all"
                  >
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Department</label>
                  <select
                    value={newPatient.department}
                    onChange={(e) => setNewPatient({ ...newPatient, department: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500 transition-all"
                  >
                    {['Cardiology', 'ICU', 'General'].map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Acuity Status</label>
                  <select
                    value={newPatient.acuity_status}
                    onChange={(e) => setNewPatient({ ...newPatient, acuity_status: e.target.value as any })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500 transition-all"
                  >
                    <option value="Stable">Stable</option>
                    <option value="Serious">Serious</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">Detailed Admission Report</label>
                <textarea
                  rows={3}
                  required
                  value={newPatient.admission_notes}
                  onChange={(e) => setNewPatient({ ...newPatient, admission_notes: e.target.value })}
                  placeholder="Document clinical diagnosis, symptoms, and orders..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500 transition-all resize-none"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddPatientOpen(false)}
                  className="px-4 py-2 text-slate-500 hover:text-slate-800 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-extrabold shadow-kwik-card disabled:opacity-50"
                >
                  {submitting ? 'Admitting...' : 'Register Patient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}