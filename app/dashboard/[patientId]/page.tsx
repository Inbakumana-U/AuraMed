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
  acuity_status: 'Critical' | 'Serious' | 'Stable';
  admission_notes?: string;
  attending_doctor_id?: string;
}

interface Vitals {
  heart_rate: number | string;
  systolic_bp: number | string;
  diastolic_bp: number | string;
  respiratory_rate: number | string;
  oxygen_saturation: number | string;
  temperature: number | string;
}

interface TestResult {
  id?: string;
  test_name: string;
  category: string;
  test_date: string;
  result_value: string;
  reference_range: string;
  status: 'normal' | 'abnormal' | 'critical';
  source_system?: string;
}

interface Condition {
  id?: string;
  condition_name: string;
  diagnosed_date?: string;
  notes?: string;
}

interface PeerDoctor {
  id: string;
  full_name: string;
  role: string;
  staff_id: string;
}

interface DelegationRecord {
  id: string;
  delegating_doctor_id: string;
  covering_doctor_id: string;
  delegating_name: string;
  covering_name: string;
  starts_at: string;
  ends_at: string;
  sbar_situation: string;
  sbar_background?: string;
  sbar_assessment: string;
  sbar_recommendation: string;
  created_at: string;
}

interface AiSynthesisRecord {
  id: string;
  patient_id: string;
  status: 'DRAFT_UNVERIFIED' | 'PHYSICIAN_VERIFIED' | 'REJECTED';
  executive_summary: string;
  critical_alerts: string[];
  recommended_actions: string[];
  physician_notes?: string;
  verified_by_name?: string;
  verified_by_staff_id?: string;
  verified_at?: string;
  digital_signature_hash?: string;
}

export default function ClinicianPatientDetailPage() {
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
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [tests, setTests] = useState<TestResult[]>([]);
  const [peerDoctors, setPeerDoctors] = useState<PeerDoctor[]>([]);
  const [delegationChain, setDelegationChain] = useState<DelegationRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // User session
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<{ id: string; email: string; name: string; specialization: string; staff_id: string } | null>(null);
  const [showDoctorModal, setShowDoctorModal] = useState(false);

  // AI Summary States
  const [synthesis, setSynthesis] = useState<AiSynthesisRecord | null>(null);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [editableSummary, setEditableSummary] = useState('');
  const [physicianOverrideNotes, setPhysicianOverrideNotes] = useState('');

  // Shift Handoff Modal
  const [isHandoffOpen, setIsHandoffOpen] = useState(false);
  const [handoffSubmitting, setHandoffSubmitting] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffData, setHandoffData] = useState({
    covering_doctor_id: '',
    shift_hours: '12',
    sbar_situation: '',
    sbar_background: '',
    sbar_assessment: '',
    sbar_recommendation: '',
  });

  // Add Lab Result Modal
  const [isAddTestOpen, setIsAddTestOpen] = useState(false);
  const [newTest, setNewTest] = useState({
    test_name: '',
    category: 'Hematology',
    result_value: '',
    reference_range: '',
    status: 'normal' as 'normal' | 'abnormal' | 'critical',
  });
  const [submittingTest, setSubmittingTest] = useState(false);

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

  // Helper to normalize and compute test result statuses
  const resolveLabStatus = (testName: string, resultVal: string, recordedStatus?: string): 'normal' | 'abnormal' | 'critical' => {
    const num = parseFloat(resultVal.replace(/[^0-9.]/g, ''));
    const lowerName = testName.toLowerCase();

    if (lowerName.includes('troponin')) {
      if (!isNaN(num) && num > 0.014) return 'critical';
    }
    if (lowerName.includes('bnp') || lowerName.includes('natriuretic')) {
      if (!isNaN(num) && num > 100) return 'abnormal';
    }
    if (lowerName.includes('creatinine')) {
      if (!isNaN(num) && num > 1.3) return 'abnormal';
    }

    if (recordedStatus) {
      const s = recordedStatus.toLowerCase();
      if (s === 'critical' || s === 'abnormal' || s === 'normal') return s;
    }

    return 'normal';
  };

  const loadPatientData = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login');
      return;
    }
    setCurrentUserId(user.id);

    const nowIso = new Date().toISOString();

    const [clinicianRes, pRes, vRes, cRes, teRes, docRes, delegationsRes, synthRes] = await Promise.all([
      supabase.from('clinicians').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('patients').select('*').eq('id', patientId).single(),
      supabase.from('vitals_records').select('*').eq('patient_id', patientId).order('recorded_at', { ascending: false }).limit(1),
      supabase.from('medical_conditions').select('*').eq('patient_id', patientId),
      supabase.from('test_results').select('*').eq('patient_id', patientId).order('test_date', { ascending: false }),
      supabase.from('clinicians').select('id, full_name, role, staff_id'),
      supabase
        .from('shift_coverage_delegations')
        .select('*')
        .eq('patient_id', patientId)
        .eq('status', 'ACTIVE')
        .gte('ends_at', nowIso)
        .order('created_at', { ascending: true }),
      supabase
        .from('ai_clinical_syntheses')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const doctorMap = new Map<string, string>();
    (docRes.data || []).forEach((d) => doctorMap.set(d.id, d.full_name));

    if (clinicianRes.data) {
      setDoctor({
        id: user.id,
        email: user.email || clinicianRes.data.email,
        name: clinicianRes.data.full_name || 'Dr. Sarah Connor',
        specialization: clinicianRes.data.role || 'Attending Physician',
        staff_id: clinicianRes.data.staff_id || 'STAFF-AUTH',
      });
    }

    if (pRes.data) {
      setPatient(pRes.data as Patient);
      if (vRes.data?.[0]) setVitals(vRes.data[0]);
      if (cRes.data) setConditions(cRes.data as Condition[]);

      let currentTests: TestResult[] = [];
      if (teRes.data) {
        currentTests = (teRes.data as TestResult[]).map((t) => ({
          ...t,
          status: resolveLabStatus(t.test_name, t.result_value, t.status),
        }));
        setTests(currentTests);
      }

      // Check for critical flags to auto-populate SBAR situation
      const criticalLabs = currentTests.filter((t) => t.status === 'critical');
      let baseSituation = `Handing off coverage for ${pRes.data.full_name} (${pRes.data.mrn}) in ${pRes.data.department}. Current Acuity: ${pRes.data.acuity_status}.`;
      if (criticalLabs.length > 0) {
        const labSummary = criticalLabs.map((l) => `${l.test_name} at ${l.result_value}`).join(', ');
        baseSituation += ` ALERT: Critical diagnostic findings present (${labSummary}).`;
      }

      setHandoffData((prev) => ({
        ...prev,
        sbar_situation: prev.sbar_situation || baseSituation,
        sbar_background: prev.sbar_background || pRes.data.admission_notes || '',
        sbar_assessment: prev.sbar_assessment || (criticalLabs.length > 0 ? 'Requires immediate cardiac telemetry evaluation.' : ''),
      }));

      const chain: DelegationRecord[] = (delegationsRes.data || []).map((d) => ({
        ...d,
        delegating_name: doctorMap.get(d.delegating_doctor_id) || 'Physician',
        covering_name: doctorMap.get(d.covering_doctor_id) || 'On-Call Clinician',
      }));
      setDelegationChain(chain);

      if (synthRes.data) {
        setSynthesis(synthRes.data as AiSynthesisRecord);
        setEditableSummary(synthRes.data.executive_summary || '');
        setPhysicianOverrideNotes(synthRes.data.physician_notes || '');
      }
    }

    if (docRes.data) {
      setPeerDoctors(docRes.data.filter((d) => d.id !== user.id) as PeerDoctor[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    setMounted(true);
    loadPatientData();

    const dossierChannel = supabase
      .channel(`realtime_dossier_sync_${patientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vitals_records', filter: `patient_id=eq.${patientId}` }, (payload) => {
        if (payload.new) setVitals(payload.new as Vitals);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'test_results', filter: `patient_id=eq.${patientId}` }, () => {
        loadPatientData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_coverage_delegations', filter: `patient_id=eq.${patientId}` }, () => {
        loadPatientData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_clinical_syntheses', filter: `patient_id=eq.${patientId}` }, () => {
        loadPatientData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients', filter: `id=eq.${patientId}` }, () => {
        loadPatientData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(dossierChannel);
    };
  }, [patientId, supabase]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  // RESILIENT HANDOFF DISPATCH
  const handleInitiateHandoff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patient) return;
    setHandoffSubmitting(true);
    setHandoffError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setHandoffError('Authentication session expired. Please refresh or re-login.');
      setHandoffSubmitting(false);
      return;
    }

    if (!handoffData.covering_doctor_id) {
      setHandoffError('Please select an on-call covering physician from the list.');
      setHandoffSubmitting(false);
      return;
    }

    if (!handoffData.sbar_recommendation || handoffData.sbar_recommendation.trim().length < 10) {
      setHandoffError('Please enter detailed orders or clinical recommendations (min 10 characters).');
      setHandoffSubmitting(false);
      return;
    }

    const payload = {
      patient_id: patient.id,
      patient_name: patient.full_name,
      patient_mrn: patient.mrn,
      delegating_doctor_id: user.id,
      delegating_doctor_name: doctor?.name || user.email || 'Attending Physician',
      ...handoffData,
    };

    try {
      const res = await fetch('/api/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Server rejected handoff request');

      setIsHandoffOpen(false);
      alert(`Shift coverage for ${patient.full_name} successfully delegated!`);
      await loadPatientData();
    } catch (apiErr: any) {
      console.warn('API route handoff error, attempting direct client fallback:', apiErr);

      try {
        const startsAt = new Date();
        const hoursNum = Number(handoffData.shift_hours) || 12;
        const endsAt = new Date(startsAt.getTime() + hoursNum * 60 * 60 * 1000);

        const { data: directInsert, error: directErr } = await supabase
          .from('shift_coverage_delegations')
          .insert([
            {
              patient_id: patient.id,
              delegating_doctor_id: user.id,
              covering_doctor_id: handoffData.covering_doctor_id,
              starts_at: startsAt.toISOString(),
              ends_at: endsAt.toISOString(),
              status: 'ACTIVE',
              sbar_situation: handoffData.sbar_situation,
              sbar_background: handoffData.sbar_background || '',
              sbar_assessment: handoffData.sbar_assessment || '',
              sbar_recommendation: handoffData.sbar_recommendation,
            },
          ])
          .select()
          .single();

        if (directErr) throw new Error(directErr.message);

        await supabase.from('medico_legal_audit_logs').insert([
          {
            actor_id: user.id,
            actor_email: doctor?.name || user.email,
            actor_role: 'CLINICIAN',
            action_type: 'PATIENT_REASSIGNED',
            resource_type: 'SHIFT_HANDOFF_DELEGATION',
            resource_id: directInsert?.id || patient.id,
            patient_mrn: patient.mrn,
            patient_name: patient.full_name,
            state_delta: {
              event: 'SHIFT_COVERAGE_DELEGATED_CLIENT_DIRECT',
              patient_id: patient.id,
              covering_doctor_id: handoffData.covering_doctor_id,
              sbar: handoffData,
            },
          },
        ]);

        setIsHandoffOpen(false);
        alert(`Shift coverage for ${patient.full_name} successfully delegated.`);
        await loadPatientData();
      } catch (fallbackErr: any) {
        console.error('All handoff attempts failed:', fallbackErr);
        setHandoffError(`Handoff Failed: ${fallbackErr.message || apiErr.message}`);
      }
    }

    setHandoffSubmitting(false);
  };

  const handleOpenAndSummarize = async () => {
    setIsSummaryOpen(true);
    setSummaryError(null);

    if (!synthesis || !synthesis.executive_summary || synthesis.executive_summary.trim() === '') {
      setGeneratingSummary(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();

        fetch('/api/audit/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actor_id: user?.id,
            actor_email: user?.email,
            actor_role: 'CLINICIAN',
            action_type: 'AI_SUMMARY_ACCESSED',
            resource_type: 'GROQ_AI_SYNTHESIS',
            resource_id: patientId,
            patient_mrn: patient?.mrn,
            patient_name: patient?.full_name,
            state_delta: { model: 'llama-3.1-8b-instant' },
          }),
        }).catch((e) => console.warn('AI audit failed:', e));

        const res = await fetch('/api/agents/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patient, vitals, conditions, tests }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to synthesize medical record');

        setSynthesis(json);
        setEditableSummary(json.executive_summary || '');
      } catch (err: any) {
        console.error('Failed to generate summary:', err);
        setSummaryError(err.message || 'Unable to contact clinical reasoning engine.');
      }
      setGeneratingSummary(false);
    } else {
      setEditableSummary(synthesis.executive_summary);
    }
  };

  const handleVerifySynthesis = async () => {
    if (!synthesis?.id || !patient || !doctor) return;
    if (physicianOverrideNotes.trim().length < 10) {
      alert('Verification Error: You must enter at least 10 characters of verification notes before signing.');
      return;
    }

    setIsVerifying(true);
    try {
      const res = await fetch('/api/agents/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          synthesis_id: synthesis.id,
          patient_id: patient.id,
          patient_name: patient.full_name,
          patient_mrn: patient.mrn,
          executive_summary: editableSummary,
          critical_alerts: synthesis.critical_alerts,
          recommended_actions: synthesis.recommended_actions,
          physician_notes: physicianOverrideNotes,
          signer_id: doctor.id,
          signer_name: doctor.name,
          signer_staff_id: doctor.staff_id,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Verification failed');

      setSynthesis(json.synthesis);
      alert('Clinical Synthesis verified and stamped into medical record.');
    } catch (err: any) {
      alert(`Signature Error: ${err.message}`);
    }
    setIsVerifying(false);
  };

  const handleAddDiagnosticReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly) {
      alert('Action Restricted: You do not hold active attending authority.');
      return;
    }

    setSubmittingTest(true);
    const today = new Date().toISOString().split('T')[0];
    const computedStatus = resolveLabStatus(newTest.test_name, newTest.result_value, newTest.status);

    const { data: inserted, error } = await supabase.from('test_results').insert([
      {
        patient_id: patientId,
        test_name: newTest.test_name,
        category: newTest.category,
        test_date: today,
        result_value: newTest.result_value,
        reference_range: newTest.reference_range,
        status: computedStatus,
        source_system: 'CLINICIAN_ENTRY',
      },
    ]).select().single();

    if (!error && inserted) {
      setTests((prev) => [inserted as TestResult, ...prev]);
      setIsAddTestOpen(false);
      setNewTest({ test_name: '', category: 'Hematology', result_value: '', reference_range: '', status: 'normal' });
    } else if (error) {
      alert(`Failed to log lab: ${error.message}`);
    }
    setSubmittingTest(false);
  };

  if (!mounted || loading || !patient) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  const initials = getDoctorInitials(doctor?.name);

  // Custody Logic
  const hasChain = delegationChain.length > 0;
  const latestDelegation = hasChain ? delegationChain[delegationChain.length - 1] : null;
  const currentActiveCovererId = latestDelegation?.covering_doctor_id || patient.attending_doctor_id;
  const isCurrentActiveCoverer = currentActiveCovererId === currentUserId;

  const onwardDelegationByMe = delegationChain.find((d) => d.delegating_doctor_id === currentUserId);
  const incomingDelegationToMe = delegationChain.find((d) => d.covering_doctor_id === currentUserId);

  const isReadOnly = hasChain && !isCurrentActiveCoverer;
  const canDelegate = !hasChain || isCurrentActiveCoverer;

  // Detect any critical labs across the patient record
  const criticalLabItems = tests.filter((t) => t.status === 'critical');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Header */}
      <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-8 py-3.5 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-2xl bg-white border border-emerald-200 flex items-center justify-center p-1.5 shadow-kwik-card overflow-hidden shrink-0 group-hover:scale-105 transition-transform">
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
          </Link>

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
                  <div><strong>Staff License:</strong> <span className="font-mono text-emerald-700 font-bold">{doctor?.staff_id}</span></div>
                  <div><strong>Specialization:</strong> {doctor?.specialization}</div>
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

      {/* Main Workspace */}
      <main className="max-w-7xl mx-auto p-4 sm:p-8">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between pb-4 sm:pb-6 border-b border-slate-200 gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:text-emerald-700 hover:border-emerald-300 transition-all shadow-kwik-card"
          >
            ← Back to Directory
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            {canDelegate && (
              <button
                onClick={() => {
                  setHandoffError(null);
                  setIsHandoffOpen(true);
                }}
                className="flex-1 sm:flex-initial px-3.5 sm:px-4 py-2.5 bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white text-xs font-extrabold rounded-2xl shadow-kwik-card transition-all flex items-center justify-center gap-1.5"
              >
                <span>🔄</span> Shift Handoff / Delegate
              </button>
            )}

            <button
              onClick={handleOpenAndSummarize}
              className={`flex-1 sm:flex-initial px-3.5 sm:px-4 py-2.5 active:scale-[0.98] text-white text-xs font-extrabold rounded-2xl shadow-kwik-card transition-all flex items-center justify-center gap-1.5 ${
                synthesis?.status === 'PHYSICIAN_VERIFIED' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-900 hover:bg-slate-800'
              }`}
            >
              <span>{synthesis?.status === 'PHYSICIAN_VERIFIED' ? '🛡️' : '✨'}</span>
              {synthesis?.status === 'PHYSICIAN_VERIFIED' ? 'Verified AI Record' : 'AI Clinical Synthesis'}
            </button>
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* CRITICAL LAB ESCALATION BANNER                                 */}
        {/* ------------------------------------------------------------- */}
        {criticalLabItems.length > 0 && (
          <div className="mt-5 p-4 rounded-2xl bg-rose-50 border-l-4 border-rose-600 border border-rose-200 shadow-kwik-card flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-start sm:items-center gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <div className="text-xs font-extrabold text-rose-950 uppercase tracking-wider">
                  Critical Lab Panic Threshold Detected
                </div>
                <div className="text-xs text-rose-800 mt-0.5">
                  {criticalLabItems.map((c) => `${c.test_name}: ${c.result_value} (Ref: ${c.reference_range})`).join(' • ')}
                </div>
              </div>
            </div>
            <span className="self-start sm:self-auto text-[10px] font-extrabold uppercase px-2.5 py-1 bg-rose-600 text-white rounded-full tracking-wider animate-pulse">
              STAT Review Required
            </span>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* CASE 1: DOCTOR B VIEW (Stacked Boxes)                         */}
        {/* ------------------------------------------------------------- */}
        {incomingDelegationToMe && onwardDelegationByMe && (
          <div className="mt-5 space-y-4">
            <div className="p-5 sm:p-6 rounded-3xl bg-amber-50/90 border-2 border-amber-300 shadow-kwik-card">
              <div className="flex justify-between items-center pb-2.5 border-b border-amber-200">
                <span className="text-xs font-extrabold uppercase text-amber-950">
                  Incoming Shift Briefing from {incomingDelegationToMe.delegating_name}
                </span>
                <span className="text-[11px] font-bold text-amber-900">
                  {new Date(incomingDelegationToMe.starts_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-xs">
                <div className="p-3 bg-white rounded-2xl border border-amber-200">
                  <strong className="text-amber-800 block mb-0.5">Situation (S):</strong>
                  {incomingDelegationToMe.sbar_situation}
                </div>
                <div className="p-3 bg-white rounded-2xl border border-amber-200">
                  <strong className="text-amber-800 block mb-0.5">Background (B):</strong>
                  {incomingDelegationToMe.sbar_background || 'None'}
                </div>
                <div className="p-3 bg-white rounded-2xl border border-amber-200">
                  <strong className="text-amber-800 block mb-0.5">Assessment (A):</strong>
                  {incomingDelegationToMe.sbar_assessment}
                </div>
                <div className="p-3 bg-amber-100/70 rounded-2xl border border-amber-300">
                  <strong className="text-amber-950 block mb-0.5">Orders (R):</strong>
                  {incomingDelegationToMe.sbar_recommendation}
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-3xl bg-sky-50 border-2 border-sky-300 shadow-kwik-card text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-sky-200 font-extrabold text-sky-950">
                <span>Re-Delegated Onward to {onwardDelegationByMe.covering_name}</span>
                <span>Active Until {new Date(onwardDelegationByMe.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="mt-2 text-sky-900">
                Orders: <em>{onwardDelegationByMe.sbar_recommendation}</em>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* CASE 2: DOCTOR C VIEW (Current Active Handler)                */}
        {/* ------------------------------------------------------------- */}
        {incomingDelegationToMe && !onwardDelegationByMe && (
          <div className="mt-5 p-5 sm:p-6 rounded-3xl bg-amber-50/90 border-2 border-amber-300 shadow-kwik-card">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 pb-3 border-b border-amber-200">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                <h2 className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-amber-950">
                  Active Shift Handoff Briefing (from {incomingDelegationToMe.delegating_name})
                </h2>
              </div>
              <div className="text-[11px] sm:text-xs font-bold text-amber-900 bg-amber-100 px-3 py-1 rounded-full border border-amber-300 self-start sm:self-auto">
                Authority Active Until: {new Date(incomingDelegationToMe.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>

            <div className="text-xs text-amber-950 mt-3.5">
              <div className="mb-3">
                <span className="text-amber-800 font-semibold">Immediate Delegator:</span>{' '}
                <strong className="text-slate-900 text-sm">{incomingDelegationToMe.delegating_name}</strong>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                <div className="p-3.5 bg-white rounded-2xl border border-amber-200 shadow-xs">
                  <span className="block text-[11px] font-extrabold uppercase tracking-wider text-amber-800 mb-1">
                    Situation (S)
                  </span>
                  <p className="text-slate-800 leading-relaxed font-medium">
                    {incomingDelegationToMe.sbar_situation || 'No specific situation recorded.'}
                  </p>
                </div>

                <div className="p-3.5 bg-white rounded-2xl border border-amber-200 shadow-xs">
                  <span className="block text-[11px] font-extrabold uppercase tracking-wider text-amber-800 mb-1">
                    Background (B)
                  </span>
                  <p className="text-slate-800 leading-relaxed font-medium">
                    {incomingDelegationToMe.sbar_background || 'No prior background documented.'}
                  </p>
                </div>

                <div className="p-3.5 bg-white rounded-2xl border border-amber-200 shadow-xs">
                  <span className="block text-[11px] font-extrabold uppercase tracking-wider text-amber-800 mb-1">
                    Assessment (A)
                  </span>
                  <p className="text-slate-800 leading-relaxed font-medium">
                    {incomingDelegationToMe.sbar_assessment || 'No clinical assessment noted.'}
                  </p>
                </div>

                <div className="p-3.5 bg-amber-100/70 rounded-2xl border-2 border-amber-400 shadow-xs">
                  <span className="block text-[11px] font-extrabold uppercase tracking-wider text-amber-900 mb-1">
                    Orders &amp; Recommendations (R)
                  </span>
                  <p className="text-amber-950 leading-relaxed font-bold">
                    {incomingDelegationToMe.sbar_recommendation || 'No specific orders left.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------- */}
        {/* CASE 3: DOCTOR A VIEW (Custody Tracker)                       */}
        {/* ------------------------------------------------------------- */}
        {latestDelegation && (!incomingDelegationToMe || incomingDelegationToMe.delegating_doctor_id !== currentUserId) && currentActiveCovererId !== currentUserId && (
          <div className="mt-5 p-4 sm:p-5 rounded-3xl bg-slate-100 border border-slate-300 shadow-xs text-xs text-slate-800">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 pb-2 border-b border-slate-200">
              <span className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                Active Clinical Custody Tracker
              </span>
              <div className="font-bold text-slate-700 bg-white px-2.5 py-0.5 rounded-lg border border-slate-200">
                Coverage Active Until: {new Date(latestDelegation.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>

            <div className="mt-3 space-y-1.5">
              <div>
                <strong>Current On-Call Handler:</strong>{' '}
                <span className="text-emerald-700 font-extrabold text-sm">{latestDelegation.covering_name}</span>
                {latestDelegation.delegating_name !== doctor?.name && (
                  <span className="text-slate-500 text-[11px] ml-1.5 font-medium">
                    (Transferred onward by {latestDelegation.delegating_name})
                  </span>
                )}
              </div>

              {onwardDelegationByMe && (
                <div className="text-slate-600">
                  You originally delegated this patient to <strong>{onwardDelegationByMe.covering_name}</strong>.
                </div>
              )}

              <div className="p-3 bg-white rounded-2xl border border-slate-200 mt-2 space-y-1">
                <div className="text-[11px] font-bold text-slate-700 uppercase">Current Active Orders:</div>
                <div className="text-slate-800 font-semibold">{latestDelegation.sbar_recommendation}</div>
              </div>
            </div>
          </div>
        )}

        {/* Patient Dossier Header Banner */}
        <div className="my-5 sm:my-6 p-5 sm:p-8 bg-white border border-slate-200/90 rounded-3xl shadow-kwik-card flex flex-wrap justify-between items-center gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">{patient.full_name}</h1>
              <span
                className={`text-[10px] sm:text-[11px] px-3 py-0.5 rounded-full font-bold border ${
                  patient.acuity_status === 'Critical'
                    ? 'bg-rose-50 border-rose-200 text-rose-600'
                    : patient.acuity_status === 'Serious'
                    ? 'bg-amber-50 border-amber-200 text-amber-600'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                }`}
              >
                {patient.acuity_status} ({patient.department})
              </span>

              {synthesis && (
                <span
                  className={`text-[10px] sm:text-[11px] px-3 py-0.5 rounded-full font-bold border flex items-center gap-1 ${
                    synthesis.status === 'PHYSICIAN_VERIFIED'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      : 'bg-amber-50 text-amber-800 border-amber-300'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${synthesis.status === 'PHYSICIAN_VERIFIED' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                  {synthesis.status === 'PHYSICIAN_VERIFIED' ? 'AI Record: Verified' : 'AI Record: Draft / Unverified'}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-slate-500 font-medium mt-2">
              <span>
                Admission ID:{' '}
                <strong className="font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-lg font-bold">
                  {patient.id}
                </strong>
              </span>
              <span>•</span>
              <span>MRN: {patient.mrn}</span>
              <span>•</span>
              <span>DOB: {patient.dob}</span>
              <span>•</span>
              <span>Blood: {patient.blood_type}</span>
            </div>

            {patient.admission_notes && (
              <p className="text-xs text-slate-600 mt-3 p-3 rounded-2xl bg-slate-50 border border-slate-100 leading-relaxed max-w-3xl">
                <strong className="text-slate-800">Triage Summary:</strong> {patient.admission_notes}
              </p>
            )}
          </div>
        </div>

        {/* Telemetry Numbers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <div className="p-4 sm:p-5 bg-white border border-slate-200/90 rounded-2xl shadow-kwik-card">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">Heart Rate</span>
            <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
              {vitals.heart_rate} <span className="text-xs font-normal text-slate-400">bpm</span>
            </div>
          </div>

          <div className="p-4 sm:p-5 bg-white border border-slate-200/90 rounded-2xl shadow-kwik-card">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">Blood Pressure</span>
            <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
              {vitals.systolic_bp}/{vitals.diastolic_bp} <span className="text-[10px] sm:text-xs font-normal text-slate-400">mmHg</span>
            </div>
          </div>

          <div className="p-4 sm:p-5 bg-white border border-slate-200/90 rounded-2xl shadow-kwik-card">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">O2 Saturation</span>
            <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
              {vitals.oxygen_saturation}%
            </div>
          </div>

          <div className="p-4 sm:p-5 bg-white border border-slate-200/90 rounded-2xl shadow-kwik-card">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400">Temperature</span>
            <div className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1">
              {vitals.temperature}°C
            </div>
          </div>
        </div>

        {/* Labs & Conditions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
          <div className="p-5 sm:p-6 bg-white border border-slate-200/90 rounded-3xl shadow-kwik-card">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">Diagnostic Lab Reports</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">Analyzer feeds &amp; clinical entries</p>
              </div>

              {!isReadOnly ? (
                <button
                  onClick={() => setIsAddTestOpen(true)}
                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors"
                >
                  <span>+</span> Add
                </button>
              ) : (
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">Read Only</span>
              )}
            </div>

            <ul className="space-y-2.5 text-xs max-h-[50vh] overflow-y-auto pr-1">
              {tests && tests.length > 0 ? (
                tests.map((t, i) => (
                  <li key={t.id || i} className="flex justify-between items-center p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                    <div>
                      <div className="font-bold text-slate-900 flex items-center gap-2">
                        {t.test_name}
                        {t.source_system && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                            {t.source_system}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Ref: {t.reference_range || 'Standard'} • {t.test_date}
                      </div>
                    </div>
                    <div className="font-mono font-bold text-slate-800 text-right shrink-0">
                      <div>{t.result_value}</div>
                      <span
                        className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-sans font-bold ${
                          t.status === 'critical'
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : t.status === 'abnormal'
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}
                      >
                        {t.status}
                      </span>
                    </div>
                  </li>
                ))
              ) : (
                <li className="text-slate-400 italic p-4 text-center">No diagnostic laboratory records logged.</li>
              )}
            </ul>
          </div>

          <div className="p-5 sm:p-6 bg-white border border-slate-200/90 rounded-3xl shadow-kwik-card">
            <div className="mb-4">
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">Active Medical Conditions</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">Chronic diagnoses and inpatient problems</p>
            </div>

            <ul className="space-y-2.5 text-xs max-h-[50vh] overflow-y-auto pr-1">
              {conditions && conditions.length > 0 ? (
                conditions.map((c, i) => (
                  <li key={c.id || i} className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
                    <div className="font-bold text-slate-900">{c.condition_name}</div>
                    <div className="text-slate-500 mt-1">
                      {c.notes || 'Documented at admission'} {c.diagnosed_date && `(${c.diagnosed_date})`}
                    </div>
                  </li>
                ))
              ) : (
                <li className="text-slate-400 italic p-4 text-center">No active clinical conditions documented.</li>
              )}
            </ul>
          </div>
        </div>
      </main>

      {/* SBAR Shift Handoff Modal */}
      {isHandoffOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 w-full max-w-xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-4">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">Shift Handoff (SBAR Protocol)</h2>
                <p className="text-xs text-slate-500">
                  Transferring clinical coverage for <strong>{patient.full_name}</strong> ({patient.mrn})
                </p>
              </div>
              <button onClick={() => setIsHandoffOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            {handoffError && (
              <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs font-semibold">
                ⚠️ {handoffError}
              </div>
            )}

            <form onSubmit={handleInitiateHandoff} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">On-Call Covering Clinician</label>
                  <select
                    required
                    value={handoffData.covering_doctor_id}
                    onChange={(e) => setHandoffData({ ...handoffData, covering_doctor_id: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Select Clinician</option>
                    {peerDoctors.map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name} ({p.role}) - {p.staff_id}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Shift Duration Window</label>
                  <select
                    value={handoffData.shift_hours}
                    onChange={(e) => setHandoffData({ ...handoffData, shift_hours: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="8">8 Hours (Day/Night Shift)</option>
                    <option value="12">12 Hours (Standard Rotational)</option>
                    <option value="24">24 Hours (Weekend Coverage)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Situation (S)</label>
                <input
                  type="text"
                  required
                  value={handoffData.sbar_situation}
                  onChange={(e) => setHandoffData({ ...handoffData, sbar_situation: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 text-slate-800"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Background (B)</label>
                <input
                  type="text"
                  value={handoffData.sbar_background}
                  onChange={(e) => setHandoffData({ ...handoffData, sbar_background: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 text-slate-800"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Assessment (A)</label>
                <input
                  type="text"
                  required
                  placeholder="Current stability, critical risks..."
                  value={handoffData.sbar_assessment}
                  onChange={(e) => setHandoffData({ ...handoffData, sbar_assessment: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 text-slate-800"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-slate-700 font-bold">Recommendation &amp; Orders (R) <span className="text-red-500">*</span></label>
                  <span className="text-[10px] text-slate-400">Quick-Fill Presets:</span>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    'Routine Vitals Q4H; monitor output',
                    'Serial Cardiac Enzymes Q6H & 12-lead ECG',
                    'NPO post-midnight; prepare IV hydration',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setHandoffData({ ...handoffData, sbar_recommendation: preset })}
                      className="px-2 py-0.5 text-[10px] rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>

                <textarea
                  rows={2}
                  required
                  placeholder="Escalation thresholds, titration instructions..."
                  value={handoffData.sbar_recommendation}
                  onChange={(e) => setHandoffData({ ...handoffData, sbar_recommendation: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 text-slate-800 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsHandoffOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-800 font-bold">
                  Cancel
                </button>
                <button type="submit" disabled={handoffSubmitting} className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-extrabold shadow-kwik-card disabled:opacity-50">
                  {handoffSubmitting ? 'Transferring Authority...' : 'Execute Handoff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Diagnostic Lab Modal */}
      {isAddTestOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-sm font-extrabold text-slate-900">Record Diagnostic Lab Result</h2>
              <button onClick={() => setIsAddTestOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">✕</button>
            </div>

            <form onSubmit={handleAddDiagnosticReport} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Test Name</label>
                <input
                  type="text"
                  required
                  value={newTest.test_name}
                  onChange={(e) => setNewTest({ ...newTest, test_name: e.target.value })}
                  placeholder="e.g. Troponin I, BNP, Serum Creatinine"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Result Value</label>
                  <input
                    type="text"
                    required
                    value={newTest.result_value}
                    onChange={(e) => setNewTest({ ...newTest, result_value: e.target.value })}
                    placeholder="e.g. 0.08 ng/mL"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-bold mb-1">Reference Range</label>
                  <input
                    type="text"
                    required
                    value={newTest.reference_range}
                    onChange={(e) => setNewTest({ ...newTest, reference_range: e.target.value })}
                    placeholder="e.g. < 0.014 ng/mL"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Status Override (Optional)</label>
                <select
                  value={newTest.status}
                  onChange={(e) => setNewTest({ ...newTest, status: e.target.value as any })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500"
                >
                  <option value="normal">Normal</option>
                  <option value="abnormal">Abnormal / Elevated</option>
                  <option value="critical">Critical (Panic Value)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button type="button" onClick={() => setIsAddTestOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-800 font-bold">
                  Cancel
                </button>
                <button type="submit" disabled={submittingTest} className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-extrabold shadow-kwik-card disabled:opacity-50">
                  {submittingTest ? 'Saving...' : 'Save Result'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Synthesis Modal */}
      {isSummaryOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 w-full max-w-3xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex justify-between items-start pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-bold ${
                  synthesis?.status === 'PHYSICIAN_VERIFIED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}>
                  {synthesis?.status === 'PHYSICIAN_VERIFIED' ? '🛡️' : '⚠️'}
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    Clinical Intelligence Synthesis
                    <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${
                      synthesis?.status === 'PHYSICIAN_VERIFIED'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : 'bg-amber-50 text-amber-900 border-amber-300'
                    }`}>
                      {synthesis?.status === 'PHYSICIAN_VERIFIED' ? 'VERIFIED MEDICAL RECORD' : 'DRAFT / UNVERIFIED'}
                    </span>
                  </h2>
                  <p className="text-[11px] text-slate-500">Model: llama-3.1-8b-instant • Groq LPUs</p>
                </div>
              </div>
              <button onClick={() => setIsSummaryOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">✕</button>
            </div>

            {generatingSummary ? (
              <div className="py-14 text-center space-y-3">
                <div className="inline-block w-8 h-8 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                <p className="text-xs text-emerald-700 font-bold animate-pulse">
                  Synthesizing telemetry, conditions, and lab values...
                </p>
              </div>
            ) : summaryError ? (
              <div className="py-8 text-center space-y-3">
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs font-medium">
                  {summaryError}
                </div>
                <button
                  onClick={handleOpenAndSummarize}
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold"
                >
                  Retry Synthesis
                </button>
              </div>
            ) : synthesis ? (
              <div className="mt-4 space-y-4 max-h-[70vh] overflow-y-auto pr-1 text-xs">
                {synthesis.status === 'DRAFT_UNVERIFIED' && (
                  <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 space-y-1">
                    <div className="font-extrabold flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-amber-900">
                      <span>⚠️</span> Closed-Loop Safety Protocol Active
                    </div>
                    <p className="text-[11px] leading-relaxed text-amber-900">
                      This machine-generated draft has not been verified. Review, correct any inaccuracies, and enter sign-off notes below to stamp your digital signature onto this record.
                    </p>
                  </div>
                )}

                {synthesis.status === 'PHYSICIAN_VERIFIED' && (
                  <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-950 space-y-1">
                    <div className="font-extrabold flex items-center gap-1.5 text-xs text-emerald-900">
                      <span>✓</span> Digitally Verified &amp; Signed into Medical Record
                    </div>
                    <div className="text-[11px] text-emerald-800 space-y-0.5">
                      <div><strong>Signing Physician:</strong> {synthesis.verified_by_name} ({synthesis.verified_by_staff_id})</div>
                      <div><strong>Timestamp:</strong> {synthesis.verified_at}</div>
                      <div className="font-mono text-[10px] truncate text-emerald-700">
                        <strong>SHA-256 Hash:</strong> {synthesis.digital_signature_hash}
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <h3 className="font-extrabold text-slate-800 uppercase tracking-wider text-[11px]">
                      Executive Clinical Synthesis
                    </h3>
                    {synthesis.status === 'DRAFT_UNVERIFIED' && (
                      <span className="text-[10px] text-slate-400 italic">Editable: Modify or redact inaccuracies</span>
                    )}
                  </div>

                  {synthesis.status === 'DRAFT_UNVERIFIED' ? (
                    <textarea
                      rows={4}
                      value={editableSummary}
                      onChange={(e) => setEditableSummary(e.target.value)}
                      placeholder="Generating clinical narrative..."
                      className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-emerald-500 leading-relaxed text-slate-800 text-xs resize-none"
                    />
                  ) : (
                    <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 text-slate-800 leading-relaxed font-medium">
                      {synthesis.executive_summary}
                    </div>
                  )}
                </div>

                {synthesis.critical_alerts && synthesis.critical_alerts.length > 0 && (
                  <div>
                    <h3 className="font-extrabold text-rose-700 uppercase tracking-wider mb-1.5 text-[11px]">
                      Urgent Physiological Flags
                    </h3>
                    <ul className="space-y-1.5">
                      {synthesis.critical_alerts.map((alert: string, idx: number) => (
                        <li key={idx} className="text-rose-900 bg-rose-50 border border-rose-200 p-2.5 rounded-xl font-medium">
                          • {alert}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {synthesis.recommended_actions && synthesis.recommended_actions.length > 0 && (
                  <div>
                    <h3 className="font-extrabold text-slate-700 uppercase tracking-wider mb-1.5 text-[11px]">
                      AI Proposed Clinical Orders
                    </h3>
                    <ul className="space-y-1.5">
                      {synthesis.recommended_actions.map((action: string, idx: number) => (
                        <li key={idx} className="text-slate-800 bg-slate-50 border border-slate-200 p-2.5 rounded-xl">
                          {idx + 1}. {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <h3 className="font-extrabold text-slate-800 uppercase tracking-wider text-[11px]">
                      Attending Physician Verification Notes <span className="text-red-500">* (Min 10 chars)</span>
                    </h3>
                    {synthesis.status === 'DRAFT_UNVERIFIED' && (
                      <span className="text-[10px] text-slate-400">
                        {physicianOverrideNotes.trim().length}/10 chars
                      </span>
                    )}
                  </div>

                  {synthesis.status === 'DRAFT_UNVERIFIED' ? (
                    <div>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {[
                          'Reviewed & Verified clinical accuracy',
                          'Adjusted telemetry & cardiac enzyme protocol',
                          'Titrate beta-blockers per bedside telemetry',
                        ].map((chip) => (
                          <button
                            key={chip}
                            type="button"
                            onClick={() => setPhysicianOverrideNotes(chip)}
                            className="px-2 py-0.5 text-[10px] rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                          >
                            + {chip}
                          </button>
                        ))}
                      </div>

                      <input
                        type="text"
                        placeholder="e.g. Verified cardiac enzymes. Agree with medication titration; telemetry monitor Q2H."
                        value={physicianOverrideNotes}
                        onChange={(e) => setPhysicianOverrideNotes(e.target.value)}
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 text-slate-800 text-xs"
                      />
                    </div>
                  ) : (
                    <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-slate-700">
                      {synthesis.physician_notes || 'Accepted as generated without additional notes.'}
                    </div>
                  )}
                </div>

                {synthesis.status === 'DRAFT_UNVERIFIED' && !isReadOnly && (
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">
                      Signing Doctor: <strong>{doctor?.name} ({doctor?.staff_id})</strong>
                    </span>

                    <button
                      onClick={handleVerifySynthesis}
                      disabled={isVerifying || physicianOverrideNotes.trim().length < 10}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-extrabold rounded-2xl shadow-kwik-card flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-xs"
                    >
                      <span>🛡️</span> {isVerifying ? 'Signing Record...' : 'Accept & Sign Off'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-rose-600 font-bold">
                Synthesis currently unavailable.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}