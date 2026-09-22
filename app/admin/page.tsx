'use client';

import React, { useState, useEffect, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

interface Unit {
  id: string;
  name: string;
  floor_number: number;
  total_capacity: number;
  target_dwell_minutes: number;
}

interface Bed {
  id: string;
  unit_id: string;
  room_number: string;
  status: 'VACANT' | 'OCCUPIED' | 'DIRTY_TURNOVER' | 'BLOCKED';
  current_patient_id: string | null;
  occupied_at: string | null;
}

interface Doctor {
  id: string;
  staff_id: string;
  full_name: string;
  role: string;
  email: string;
  is_active: boolean;
}

interface Patient {
  id: string;
  full_name: string;
  mrn: string;
  department: string;
  acuity_status: string;
  attending_doctor_id?: string;
  current_active_doctor_id?: string;
  current_active_doctor_name?: string;
  is_delegated?: boolean;
  delegated_to_name?: string;
  delegation_expires_at?: string;
}

interface IntegrationLog {
  id: string;
  received_at: string;
  source_system: string;
  protocol: string;
  message_type: string;
  patient_mrn: string;
  status: string;
}

interface AuditLog {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  actor_role: string;
  action_type: string;
  resource_type: string;
  resource_id: string;
  patient_mrn: string;
  patient_name: string;
  ip_address: string;
  user_agent: string;
  state_delta: any;
}

export default function AdminDashboard() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<'capacity' | 'doctors' | 'patients' | 'integrations' | 'audit'>('capacity');

  // Bed & Capacity Management States
  const [units, setUnits] = useState<Unit[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<string>('ALL');
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [transferPayload, setTransferPayload] = useState({
    patient_id: '',
    from_unit: 'ED',
    to_unit: 'ICU',
    target_bed_id: '',
    clinical_rationale: 'Boarding mitigation and ward acuity escalation.',
  });

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [integrationLogs, setIntegrationLogs] = useState<IntegrationLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [selectedAuditRecord, setSelectedAuditRecord] = useState<AuditLog | null>(null);
  const [auditSearch, setAuditSearch] = useState('');

  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<string | null>(null);

  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [isDoctorModalOpen, setIsDoctorModalOpen] = useState(false);
  const [newDoctor, setNewDoctor] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'Attending Cardiologist',
  });
  const [creatingDoctor, setCreatingDoctor] = useState(false);
  const [doctorError, setDoctorError] = useState<string | null>(null);

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const supabase = createBrowserClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');

  const loadData = async () => {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }

    const { data: adminRecord } = await supabase
      .from('hospital_admins')
      .select('id')
      .eq('id', user.id)
      .single();

    if (!adminRecord) {
      router.push('/dashboard');
      return;
    }

    const nowIso = new Date().toISOString();

    const [uRes, bRes, docRes, patRes, activeDelegationsRes, logRes, auditRes] = await Promise.all([
      supabase.from('hospital_units').select('*').order('floor_number', { ascending: true }),
      supabase.from('beds').select('*').order('id', { ascending: true }),
      supabase.from('clinicians').select('*').order('staff_id', { ascending: true }),
      supabase.from('patients').select('*').order('id', { ascending: false }),
      supabase
        .from('shift_coverage_delegations')
        .select('*')
        .eq('status', 'ACTIVE')
        .gte('ends_at', nowIso)
        .order('created_at', { ascending: true }),
      supabase.from('ehr_integration_logs').select('*').order('received_at', { ascending: false }).limit(15),
      supabase.from('medico_legal_audit_logs').select('*').order('timestamp', { ascending: false }).limit(50),
    ]);

    const doctorMap = new Map<string, string>();
    (docRes.data || []).forEach((d) => doctorMap.set(d.id, d.full_name));

    // Resolve live rotational doctor custody matching clinician dashboard
    const delegationsByPatient = new Map<string, any[]>();
    (activeDelegationsRes.data || []).forEach((d) => {
      const list = delegationsByPatient.get(d.patient_id) || [];
      list.push(d);
      delegationsByPatient.set(d.patient_id, list);
    });

    const enrichedPatients: Patient[] = (patRes.data || []).map((p: any) => {
      const chain = delegationsByPatient.get(p.id) || [];
      let activeDocId = p.attending_doctor_id;
      let isDelegated = false;
      let delegatedToName = '';
      let delegationExpiresAt = '';

      if (chain.length > 0) {
        const activeDelegation = chain[chain.length - 1];
        activeDocId = activeDelegation.covering_doctor_id;
        isDelegated = activeDelegation.covering_doctor_id !== p.attending_doctor_id;
        delegatedToName = doctorMap.get(activeDelegation.covering_doctor_id) || 'Covering Clinician';
        if (activeDelegation.ends_at) {
          delegationExpiresAt = new Date(activeDelegation.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      }

      return {
        ...p,
        current_active_doctor_id: activeDocId,
        current_active_doctor_name: doctorMap.get(activeDocId) || 'Unassigned Clinician',
        is_delegated: isDelegated,
        delegated_to_name: delegatedToName,
        delegation_expires_at: delegationExpiresAt,
      };
    });

    if (uRes.data) setUnits(uRes.data as Unit[]);
    if (bRes.data) setBeds(bRes.data as Bed[]);
    if (docRes.data) setDoctors(docRes.data as Doctor[]);
    setPatients(enrichedPatients);
    if (logRes.data) setIntegrationLogs(logRes.data as IntegrationLog[]);
    if (auditRes.data) setAuditLogs(auditRes.data as AuditLog[]);

    setLoading(false);
  };

  useEffect(() => {
    setMounted(true);
    loadData();

    const adminChannel = supabase
      .channel('realtime_admin_command_center')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'beds' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shift_coverage_delegations' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'medico_legal_audit_logs' }, () => loadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, () => loadData())
      .subscribe();

    return () => {
      supabase.removeChannel(adminChannel);
    };
  }, []);

  const calculateDwell = (occupiedAt: string | null) => {
    if (!occupiedAt) return '--';
    const mins = Math.floor((new Date().getTime() - new Date(occupiedAt).getTime()) / 60000);
    const hrs = Math.floor(mins / 60);
    const remainder = mins % 60;
    return `${hrs}h ${remainder}m`;
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferring(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const res = await fetch('/api/admin/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...transferPayload,
          admin_id: user?.id,
          admin_email: user?.email,
          admin_name: user?.user_metadata?.full_name || user?.user_metadata?.name || 'Hospital Administrator',
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Transfer failed');

      setIsTransferModalOpen(false);
      alert('Patient transferred and bed reassigned successfully.');
      await loadData();
    } catch (err: any) {
      alert(`Transfer Error: ${err.message}`);
    }
    setTransferring(false);
  };

  const handleQuickBedClean = async (bedId: string) => {
    await supabase.from('beds').update({ status: 'VACANT', current_patient_id: null, occupied_at: null }).eq('id', bedId);
    setBeds((prev) => prev.map((b) => (b.id === bedId ? { ...b, status: 'VACANT', current_patient_id: null, occupied_at: null } : b)));
  };

  const handleSimulateBeckmanCoulter = async () => {
    setSimulating(true);
    setSimulationResult(null);
    const targetPatient = patients[0] || { mrn: 'MRN-84920', full_name: 'Eleanor Vance' };

    const hl7Payload = [
      `MSH|^~\\&|BECKMAN_AU5800|LAB_AUTOMATION|AuraMed|CENTRAL_HOSPITAL|${new Date().toISOString()}||ORU^R01|MSG-${Date.now()}|P|2.5`,
      `PID|1||${targetPatient.mrn}^^^HOSPITAL^MR||${targetPatient.full_name.replace(' ', '^')}||19750101|F`,
      `OBR|1||SPEC-${Math.floor(100000 + Math.random() * 900000)}|LAB_CHEM^Comprehensive Metabolic Panel|||${new Date().toISOString()}`,
      `OBX|1|NM|49563-0^High-Sensitivity Cardiac Troponin I^LN||${(0.04 + Math.random() * 0.15).toFixed(3)}|ng/mL|<0.014|C|||F`,
      `OBX|2|NM|2160-0^Serum Creatinine^LN||${(1.1 + Math.random() * 1.2).toFixed(1)}|mg/dL|0.6-1.2|H|||F`,
    ].join('\r');

    try {
      const res = await fetch('/api/integrations/hl7-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: hl7Payload,
      });
      const text = await res.text();
      setSimulationResult(text);
      await loadData();
    } catch (err: any) {
      setSimulationResult(`Simulation error: ${err.message}`);
    }
    setSimulating(false);
  };

  const handleSimulateEpicFHIR = async () => {
    setSimulating(true);
    setSimulationResult(null);
    const targetPatient = patients[0] || { mrn: 'MRN-84920' };

    const fhirObservation = {
      resourceType: 'Observation',
      id: `epic-obs-${Date.now()}`,
      status: 'final',
      code: {
        coding: [{ system: 'http://loinc.org', code: '30934-4', display: 'B-Type Natriuretic Peptide (BNP)' }],
        text: 'B-Type Natriuretic Peptide',
      },
      subject: { reference: `Patient/${targetPatient.mrn}` },
      effectiveDateTime: new Date().toISOString(),
      valueQuantity: { value: Math.floor(450 + Math.random() * 500), unit: 'pg/mL' },
      referenceRange: [{ text: '< 100 pg/mL' }],
    };

    try {
      const res = await fetch('/api/fhir/r4/Observation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fhirObservation),
      });
      const json = await res.json();
      setSimulationResult(JSON.stringify(json, null, 2));
      await loadData();
    } catch (err: any) {
      setSimulationResult(`Simulation error: ${err.message}`);
    }
    setSimulating(false);
  };

  const handleDeletePatient = async (patientId: string) => {
    if (!confirm(`Permanently discharge Patient ${patientId}? This action will be immutably recorded in the Medico-Legal Vault.`)) return;

    await supabase.from('beds').update({ status: 'DIRTY_TURNOVER', current_patient_id: null, occupied_at: null }).eq('current_patient_id', patientId);

    const { error } = await supabase.from('patients').delete().eq('id', patientId);
    if (!error) {
      setPatients((prev) => prev.filter((p) => p.id !== patientId));
      await loadData();
    }
  };

  const handleCreateDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingDoctor(true);
    setDoctorError(null);

    try {
      const res = await fetch('/api/admin/doctors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDoctor),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create doctor');

      await loadData();
      setIsDoctorModalOpen(false);
      setNewDoctor({ full_name: '', email: '', password: '', role: 'Attending Cardiologist' });
    } catch (err: any) {
      setDoctorError(err.message);
    }
    setCreatingDoctor(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    startTransition(() => {
      router.push('/login');
      router.refresh();
    });
  };

  const totalBedsCount = beds.length || 1;
  const occupiedBedsCount = beds.filter((b) => b.status === 'OCCUPIED').length;
  const turnoverBedsCount = beds.filter((b) => b.status === 'DIRTY_TURNOVER').length;
  const globalOccupancyRate = Math.round((occupiedBedsCount / totalBedsCount) * 100);

  const edBoardingCount = beds.filter((b) => {
    if (b.unit_id === 'ED' && b.status === 'OCCUPIED' && b.occupied_at) {
      const mins = (new Date().getTime() - new Date(b.occupied_at).getTime()) / 60000;
      return mins > 240;
    }
    return false;
  }).length;

  const filteredBeds = selectedUnit === 'ALL' ? beds : beds.filter((b) => b.unit_id === selectedUnit);

  const filteredAuditLogs = auditLogs.filter(
    (log) =>
      log.patient_mrn?.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.patient_name?.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.actor_email?.toLowerCase().includes(auditSearch.toLowerCase()) ||
      log.action_type.toLowerCase().includes(auditSearch.toLowerCase())
  );

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-30 px-4 sm:px-8 py-3.5 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white border border-emerald-200 flex items-center justify-center p-1.5 shadow-kwik-card overflow-hidden shrink-0">
              <img src="/auramed-logo.png" alt="AuraMed" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                AuraMed
                <span className="text-[10px] font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-300">
                  COMMAND CENTER
                </span>
              </h1>
              <p className="text-[11px] sm:text-xs text-slate-500 font-medium hidden xs:block">Hospital Operations Authority</p>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            className="px-3.5 py-1.5 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl hover:bg-rose-100 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-4 mb-6 gap-3">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden shrink-0">
            <button
              onClick={() => setActiveTab('capacity')}
              className={`px-3.5 sm:px-4 py-2 text-xs font-extrabold rounded-2xl transition-all flex items-center gap-1.5 shrink-0 ${
                activeTab === 'capacity' ? 'bg-emerald-500 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span>🏥</span> Floor Map &amp; Capacity
            </button>
            <button
              onClick={() => setActiveTab('doctors')}
              className={`px-3.5 sm:px-4 py-2 text-xs font-extrabold rounded-2xl transition-all shrink-0 ${
                activeTab === 'doctors' ? 'bg-emerald-500 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Staff ({doctors.length})
            </button>
            <button
              onClick={() => setActiveTab('patients')}
              className={`px-3.5 sm:px-4 py-2 text-xs font-extrabold rounded-2xl transition-all shrink-0 ${
                activeTab === 'patients' ? 'bg-emerald-500 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Patients ({patients.length})
            </button>
            <button
              onClick={() => setActiveTab('integrations')}
              className={`px-3.5 sm:px-4 py-2 text-xs font-extrabold rounded-2xl transition-all flex items-center gap-1.5 shrink-0 ${
                activeTab === 'integrations' ? 'bg-emerald-500 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              EHR Bridge
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`px-3.5 sm:px-4 py-2 text-xs font-extrabold rounded-2xl transition-all flex items-center gap-1.5 shrink-0 ${
                activeTab === 'audit' ? 'bg-emerald-500 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span>⚖️</span> Audit Vault
            </button>
          </div>

          {activeTab === 'capacity' && (
            <button
              onClick={() => setIsTransferModalOpen(true)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold rounded-2xl flex items-center justify-center gap-1.5 shadow-kwik-card self-start sm:self-auto"
            >
              <span>⇄</span> Initiate Unit Transfer
            </button>
          )}

          {activeTab === 'doctors' && (
            <button
              onClick={() => setIsDoctorModalOpen(true)}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-extrabold rounded-2xl flex items-center justify-center gap-1.5 shadow-kwik-card self-start sm:self-auto"
            >
              <span>+</span> Issue Doctor Credentials
            </button>
          )}
        </div>

        {activeTab === 'capacity' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 bg-white border border-slate-200/90 rounded-2xl shadow-kwik-card">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Occupancy</span>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">
                  {globalOccupancyRate}%
                </div>
                <div className="w-full bg-slate-100 h-2 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full ${globalOccupancyRate > 85 ? 'bg-rose-500' : globalOccupancyRate > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${globalOccupancyRate}%` }}
                  />
                </div>
              </div>

              <div className="p-5 bg-white border border-slate-200/90 rounded-2xl shadow-kwik-card">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">ED Boarding Crisis</span>
                <div className="text-2xl font-extrabold text-slate-900 mt-1 flex items-center gap-2">
                  {edBoardingCount}
                  {edBoardingCount > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 animate-pulse">
                      Dwell &gt; 4h
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">Awaiting inpatient ward bed</div>
              </div>

              <div className="p-5 bg-white border border-slate-200/90 rounded-2xl shadow-kwik-card">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Turnover Queue</span>
                <div className="text-2xl font-extrabold text-slate-900 mt-1">
                  {turnoverBedsCount} <span className="text-xs font-normal text-slate-400">Beds</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">Pending sanitization &amp; prep</div>
              </div>

              <div className="p-5 bg-white border border-slate-200/90 rounded-2xl shadow-kwik-card">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Available Beds</span>
                <div className="text-2xl font-extrabold text-emerald-700 mt-1">
                  {beds.filter((b) => b.status === 'VACANT').length}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">Ready for placement</div>
              </div>
            </div>

            <div className="p-6 bg-white border border-slate-200 rounded-3xl shadow-kwik-card">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center pb-4 mb-4 border-b border-slate-100 gap-2">
                <div>
                  <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900">
                    Hospital Floor Map &amp; Spatial Layout
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">Filter spatial layout by hospital division</p>
                </div>

                <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  <button
                    onClick={() => setSelectedUnit('ALL')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all ${
                      selectedUnit === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    All Units
                  </button>
                  {units.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => setSelectedUnit(u.id)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all shrink-0 ${
                        selectedUnit === u.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {u.id} (Floor {u.floor_number})
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredBeds.map((bed) => {
                  const assignedPatient = patients.find((p) => p.id === bed.current_patient_id);
                  const isEdBoarding =
                    bed.unit_id === 'ED' &&
                    bed.status === 'OCCUPIED' &&
                    bed.occupied_at &&
                    (new Date().getTime() - new Date(bed.occupied_at).getTime()) / 60000 > 240;

                  return (
                    <div
                      key={bed.id}
                      className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                        bed.status === 'OCCUPIED'
                          ? isEdBoarding
                            ? 'bg-rose-50/70 border-rose-300 ring-2 ring-rose-400/20'
                            : 'bg-slate-50/70 border-slate-200'
                          : bed.status === 'VACANT'
                          ? 'bg-emerald-50/40 border-emerald-200'
                          : bed.status === 'DIRTY_TURNOVER'
                          ? 'bg-amber-50/40 border-amber-200'
                          : 'bg-slate-100 border-slate-300'
                      }`}
                    >
                      <div>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="font-extrabold text-xs text-slate-900 flex items-center gap-1.5">
                              {bed.id}
                              <span className="text-[10px] text-slate-500 font-medium">({bed.room_number})</span>
                            </div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              Unit: {bed.unit_id}
                            </span>
                          </div>

                          <span
                            className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${
                              bed.status === 'OCCUPIED'
                                ? isEdBoarding
                                  ? 'bg-rose-100 text-rose-800 border-rose-300'
                                  : 'bg-slate-200 text-slate-700 border-slate-300'
                                : bed.status === 'VACANT'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                : bed.status === 'DIRTY_TURNOVER'
                                ? 'bg-amber-100 text-amber-800 border-amber-300'
                                : 'bg-slate-200 text-slate-600 border-slate-300'
                            }`}
                          >
                            {bed.status === 'DIRTY_TURNOVER' ? 'Turnover' : bed.status}
                          </span>
                        </div>

                        {bed.status === 'OCCUPIED' && assignedPatient && (
                          <div className="my-2 p-2.5 bg-white rounded-xl border border-slate-200/80 text-xs">
                            <div className="font-extrabold text-slate-900 truncate">{assignedPatient.full_name}</div>
                            <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <span className="font-mono text-emerald-700 font-bold">{assignedPatient.id}</span>
                              <span>•</span>
                              <span>{assignedPatient.acuity_status}</span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1">
                              Dwell: <strong className="text-slate-700">{calculateDwell(bed.occupied_at)}</strong>
                            </div>
                            <div className="text-[10px] text-emerald-700 font-medium mt-0.5 truncate">
                              Attending: {assignedPatient.current_active_doctor_name}
                            </div>
                          </div>
                        )}

                        {bed.status === 'VACANT' && (
                          <div className="py-4 text-center text-xs text-emerald-700 font-bold">
                            ✓ Ready for Admission
                          </div>
                        )}

                        {bed.status === 'DIRTY_TURNOVER' && (
                          <div className="py-2 text-center text-[11px] text-amber-800">
                            Sanitization in progress
                          </div>
                        )}
                      </div>

                      <div className="pt-2 border-t border-slate-200/60 flex justify-between items-center text-xs">
                        {bed.status === 'DIRTY_TURNOVER' ? (
                          <button
                            onClick={() => handleQuickBedClean(bed.id)}
                            className="w-full py-1 text-[11px] font-bold bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg transition-colors"
                          >
                            Mark Cleaned &amp; Vacant
                          </button>
                        ) : bed.status === 'OCCUPIED' && assignedPatient ? (
                          <button
                            onClick={() => {
                              setTransferPayload({
                                patient_id: assignedPatient.id,
                                from_unit: bed.unit_id,
                                to_unit: bed.unit_id === 'ED' ? 'ICU' : 'SDU',
                                target_bed_id: '',
                                clinical_rationale: 'Boarding transfer & acuity step reassignment.',
                              });
                              setIsTransferModalOpen(true);
                            }}
                            className="text-emerald-700 font-bold text-[11px] hover:underline"
                          >
                            Transfer Ward →
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400">Available</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: STAFF DIRECTORY */}
        {activeTab === 'doctors' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {doctors.map((doc) => {
              const activeBedsideCount = patients.filter((p) => p.current_active_doctor_id === doc.id).length;
              const delegatedOutCount = patients.filter(
                (p) => p.attending_doctor_id === doc.id && p.current_active_doctor_id !== doc.id
              ).length;

              return (
                <div
                  key={doc.id}
                  onClick={() => setSelectedDoctor(doc)}
                  className="p-5 sm:p-6 bg-white border border-slate-200/80 hover:border-emerald-400 rounded-3xl shadow-kwik-card hover:scale-[1.01] cursor-pointer transition-all flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h2 className="text-base font-extrabold text-slate-900 group-hover:text-emerald-600 transition-colors">
                          {doc.full_name}
                        </h2>
                        <span className="text-xs text-emerald-700 font-mono font-bold">
                          {doc.staff_id || 'DOC-STAFF'}
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold">
                        Authorized
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 space-y-1 mt-3">
                      <div><strong>Role:</strong> {doc.role}</div>
                      <div className="truncate"><strong>Email:</strong> {doc.email || 'Auth Registered'}</div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">
                        Bedside: <strong className="text-slate-900 font-bold">{activeBedsideCount}</strong>
                      </span>
                      {delegatedOutCount > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                          {delegatedOutCount} Delegated
                        </span>
                      )}
                    </div>
                    <span className="text-emerald-600 font-bold flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      Inspect Roster →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 3: PATIENTS DIRECTORY */}
        {activeTab === 'patients' && (
          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-kwik-card">
            <div className="p-4 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 flex justify-between">
              <span>Patient Information &amp; Acuity</span>
              <span className="hidden sm:inline">Administrative Operations</span>
            </div>
            <div className="divide-y divide-slate-100">
              {patients.map((p) => (
                <div key={p.id} className="p-4 sm:p-5 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-slate-900">{p.full_name}</span>
                      <span className="font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg text-xs font-bold">
                        {p.id}
                      </span>
                      <span className="text-xs text-slate-400">({p.mrn})</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Department: <strong>{p.department}</strong> • Acuity: <strong>{p.acuity_status}</strong> • Active Clinician: <strong className="text-emerald-700">{p.current_active_doctor_name}</strong>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <Link
                      href={`/admin/patient/${p.id}`}
                      className="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-colors"
                    >
                      Dossier View →
                    </Link>
                    <button
                      onClick={() => handleDeletePatient(p.id)}
                      className="px-3 py-1.5 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl hover:bg-rose-100 transition-colors"
                    >
                      Discharge
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: EHR BRIDGE */}
        {activeTab === 'integrations' && (
          <div className="space-y-6">
            <div className="p-5 sm:p-6 bg-white border border-slate-200 rounded-3xl shadow-kwik-card">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                    <span>⚡</span> Integration Test Workbench
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Simulate real-time ingestion from Beckman Coulter analyzers and Epic SMART on FHIR endpoints.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={handleSimulateBeckmanCoulter}
                    disabled={simulating}
                    className="flex-1 sm:flex-initial px-3.5 sm:px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-extrabold rounded-2xl shadow-kwik-card flex items-center justify-center gap-1.5 disabled:opacity-50 transition-all"
                  >
                    <span>🧪</span> Ingest Beckman HL7
                  </button>

                  <button
                    onClick={handleSimulateEpicFHIR}
                    disabled={simulating}
                    className="flex-1 sm:flex-initial px-3.5 sm:px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold rounded-2xl shadow-xs flex items-center justify-center gap-1.5 disabled:opacity-50 transition-all"
                  >
                    <span>🔗</span> Ingest Epic FHIR R4
                  </button>
                </div>
              </div>

              {simulationResult && (
                <div className="mt-4 p-3.5 rounded-2xl bg-slate-900 text-emerald-400 font-mono text-xs overflow-x-auto">
                  <div className="text-slate-400 text-[10px] uppercase font-bold mb-1">// Gateway Response:</div>
                  <pre>{simulationResult}</pre>
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-kwik-card">
              <div className="p-4 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 flex justify-between items-center">
                <span>Integration Stream Audit</span>
                <span className="text-[11px] text-emerald-600 font-bold">Port 2575: Listening</span>
              </div>

              <div className="divide-y divide-slate-100">
                {integrationLogs.map((log) => (
                  <div key={log.id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-900">{log.source_system}</span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700">{log.protocol}</span>
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700">{log.message_type}</span>
                        <span className="text-xs text-slate-400">MRN: {log.patient_mrn || 'N/A'}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1">
                        {new Date(log.received_at).toLocaleTimeString()} • {new Date(log.received_at).toLocaleDateString()}
                      </div>
                    </div>

                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 self-start sm:self-auto">
                      {log.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: IMMUTABLE AUDIT VAULT */}
        {activeTab === 'audit' && (
          <div className="space-y-5">
            <div className="p-5 sm:p-6 bg-white border border-slate-200 rounded-3xl shadow-kwik-card flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
                  <span>⚖️</span> Immutable Medico-Legal Vault
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Append-only, microsecond tamper-proof logs capturing every mutation, reassignment, and PHI read.
                </p>
              </div>

              <div className="w-full sm:w-80">
                <input
                  type="text"
                  placeholder="Filter by MRN, Action, or Actor..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-kwik-card overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="p-3.5 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 grid grid-cols-12 gap-2">
                  <span className="col-span-3">Timestamp (Local ms)</span>
                  <span className="col-span-3">Actor &amp; Role</span>
                  <span className="col-span-3">Action &amp; Resource</span>
                  <span className="col-span-2">Patient Subject</span>
                  <span className="col-span-1 text-right">Delta</span>
                </div>

                <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
                  {filteredAuditLogs.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400">
                      No matching audit records in the vault.
                    </div>
                  ) : (
                    filteredAuditLogs.map((item) => {
                      const dateObj = new Date(item.timestamp);
                      const formattedMs = `${dateObj.toLocaleTimeString('en-GB')}.${String(dateObj.getMilliseconds()).padStart(3, '0')}`;
                      return (
                        <div key={item.id} className="p-3.5 text-xs grid grid-cols-12 gap-2 items-center hover:bg-slate-50/70 transition-colors">
                          <div className="col-span-3">
                            <div className="font-mono font-bold text-slate-800">{formattedMs}</div>
                            <div className="text-[10px] text-slate-400">{dateObj.toLocaleDateString()}</div>
                          </div>

                          <div className="col-span-3">
                            <div className="font-bold text-slate-900 truncate">
                              {item.actor_email || (item.actor_role === 'ADMIN' ? 'Hospital Administrator' : 'Clinical Staff')}
                            </div>
                            <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <span
                                className={`px-1.5 py-0.5 rounded font-extrabold text-[9px] uppercase ${
                                  item.actor_role === 'ADMIN'
                                    ? 'bg-slate-900 text-white'
                                    : 'bg-emerald-100 text-emerald-800'
                                }`}
                              >
                                {item.actor_role}
                              </span>
                              <span className="truncate">• {item.ip_address}</span>
                            </div>
                          </div>

                          <div className="col-span-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                item.action_type === 'WARD_TRANSFERRED'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : item.action_type === 'RECORD_DELETED'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : item.action_type === 'PATIENT_REASSIGNED'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : item.action_type === 'AI_SUMMARY_ACCESSED'
                                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              }`}
                            >
                              {item.action_type}
                            </span>
                            <div className="text-[10px] text-slate-400 mt-1 font-mono">{item.resource_type}</div>
                          </div>

                          <div className="col-span-2">
                            <div className="font-bold text-slate-800 truncate">{item.patient_name || 'N/A'}</div>
                            <div className="font-mono text-[10px] text-slate-500">{item.patient_mrn || 'No MRN'}</div>
                          </div>

                          <div className="col-span-1 text-right">
                            {item.state_delta ? (
                              <button
                                onClick={() => setSelectedAuditRecord(item)}
                                className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold font-mono transition-colors"
                              >
                                JSON
                              </button>
                            ) : (
                              <span className="text-slate-300 text-[10px]">-</span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: DEPARTMENT TRANSFER WORKFLOW */}
      {isTransferModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 w-full max-w-lg shadow-2xl my-8 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">Patient Department Transfer</h2>
                <p className="text-xs text-slate-500">Boarding mitigation and ward reallocation workflow</p>
              </div>
              <button onClick={() => setIsTransferModalOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <form onSubmit={handleExecuteTransfer} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Select Patient</label>
                <select
                  required
                  value={transferPayload.patient_id}
                  onChange={(e) => setTransferPayload({ ...transferPayload, patient_id: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800"
                >
                  <option value="">Choose Patient</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} ({p.id} • {p.mrn}) — Current Unit: {p.department}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">From Unit</label>
                  <select
                    value={transferPayload.from_unit}
                    onChange={(e) => setTransferPayload({ ...transferPayload, from_unit: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800"
                  >
                    <option value="ED">ED (Emergency)</option>
                    <option value="ICU">ICU (Intensive Care)</option>
                    <option value="SDU">SDU (Step-Down)</option>
                    <option value="GEN">GEN (General Ward)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">Target Unit</label>
                  <select
                    value={transferPayload.to_unit}
                    onChange={(e) => setTransferPayload({ ...transferPayload, to_unit: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800"
                  >
                    <option value="ICU">ICU (Level 3 Intensive)</option>
                    <option value="SDU">SDU (Step-Down)</option>
                    <option value="GEN">GEN (General Ward)</option>
                    <option value="ED">ED (Triage / Return)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Allocate Specific Target Bed (Optional)</label>
                <select
                  value={transferPayload.target_bed_id}
                  onChange={(e) => setTransferPayload({ ...transferPayload, target_bed_id: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800"
                >
                  <option value="">Auto-Assign on Ward Arrival</option>
                  {beds
                    .filter((b) => b.unit_id === transferPayload.to_unit && b.status === 'VACANT')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.id} ({b.room_number}) — Ready
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Clinical Transfer Rationale</label>
                <textarea
                  rows={2}
                  required
                  value={transferPayload.clinical_rationale}
                  onChange={(e) => setTransferPayload({ ...transferPayload, clinical_rationale: e.target.value })}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTransferModalOpen(false)}
                  className="px-4 py-2 text-slate-500 hover:text-slate-800 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferring}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-extrabold shadow-kwik-card disabled:opacity-50"
                >
                  {transferring ? 'Executing Transfer...' : 'Complete Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DOCTOR INSPECTION ROSTER */}
      {selectedDoctor && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-7 w-full max-w-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex justify-between items-start pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">{selectedDoctor.full_name}</h2>
                <div className="flex items-center gap-2 mt-1 text-xs">
                  <span className="font-mono text-emerald-600 font-bold">{selectedDoctor.staff_id || 'DOC-STAFF'}</span>
                  <span className="text-slate-400">•</span>
                  <span className="text-slate-500 truncate">{selectedDoctor.email}</span>
                </div>
              </div>
              <button onClick={() => setSelectedDoctor(null)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">
                ✕
              </button>
            </div>

            <div className="my-3 p-3 rounded-2xl bg-slate-50 border border-slate-100 text-xs space-y-1">
              <div><strong className="text-slate-700">Role:</strong> {selectedDoctor.role}</div>
              <div className="truncate"><strong className="text-slate-700">ID:</strong> <span className="font-mono text-slate-500">{selectedDoctor.id}</span></div>
            </div>

            <div className="mt-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Active Bedside Custody ({patients.filter((p) => p.current_active_doctor_id === selectedDoctor.id).length})
                </h3>
              </div>

              <div className="space-y-2.5 max-h-[45vh] overflow-y-auto pr-1">
                {patients.filter((p) => p.current_active_doctor_id === selectedDoctor.id || p.attending_doctor_id === selectedDoctor.id).length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-2xl">
                    No patients currently assigned or cross-covered.
                  </div>
                ) : (
                  patients
                    .filter((p) => p.current_active_doctor_id === selectedDoctor.id || p.attending_doctor_id === selectedDoctor.id)
                    .map((p) => {
                      const isCoveringForOther = p.current_active_doctor_id === selectedDoctor.id && p.attending_doctor_id !== selectedDoctor.id;
                      const isDelegatedAway = p.attending_doctor_id === selectedDoctor.id && p.current_active_doctor_id !== selectedDoctor.id;

                      return (
                        <div key={p.id} className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-extrabold text-sm text-slate-900">{p.full_name}</span>
                              {isDelegatedAway ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                  Delegated to {p.current_active_doctor_name} {p.delegation_expires_at ? `(until ${p.delegation_expires_at})` : ''}
                                </span>
                              ) : isCoveringForOther ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                  Cross-Covering
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Direct Custody
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-xs text-emerald-600 font-bold">{p.id} ({p.mrn})</div>
                            <div className="text-[11px] text-slate-600 mt-0.5">
                              Unit: {p.department} • Acuity: {p.acuity_status}
                            </div>
                          </div>

                          <Link
                            href={`/admin/patient/${p.id}`}
                            className="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-colors shrink-0"
                          >
                            Dossier →
                          </Link>
                        </div>
                      );
                    })
                )}
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 flex justify-end">
              <button onClick={() => setSelectedDoctor(null)} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: JSON AUDIT STATE DELTA */}
      {selectedAuditRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-7 w-full max-w-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Legal Audit State Delta</h3>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">{selectedAuditRecord.id}</p>
              </div>
              <button onClick={() => setSelectedAuditRecord(null)} className="text-slate-400 hover:text-slate-600 text-lg font-bold">
                ✕
              </button>
            </div>

            <div className="my-3 p-3 bg-slate-50 rounded-2xl text-xs space-y-1">
              <div><strong>Recorded At:</strong> {selectedAuditRecord.timestamp}</div>
              <div><strong>Action:</strong> {selectedAuditRecord.action_type}</div>
              <div><strong>Actor:</strong> {selectedAuditRecord.actor_email} ({selectedAuditRecord.actor_role})</div>
              <div><strong>IP / Client:</strong> {selectedAuditRecord.ip_address}</div>
            </div>

            <div className="mt-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1 block">State Delta:</span>
              <pre className="p-3.5 rounded-2xl bg-slate-950 text-emerald-400 font-mono text-xs max-h-60 overflow-y-auto overflow-x-auto">
                {JSON.stringify(selectedAuditRecord.state_delta, null, 2)}
              </pre>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setSelectedAuditRecord(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ISSUE DOCTOR CREDENTIALS */}
      {isDoctorModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 w-full max-w-md shadow-2xl my-8">
            <h2 className="text-base font-extrabold text-slate-900 mb-1">Issue Doctor Credentials</h2>
            <p className="text-xs text-slate-500 mb-3">Creates login and assigns sequential staff ID.</p>

            {doctorError && (
              <div className="mb-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-xs font-medium">
                {doctorError}
              </div>
            )}

            <form onSubmit={handleCreateDoctor} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">Doctor Full Name</label>
                <input
                  type="text"
                  required
                  value={newDoctor.full_name}
                  onChange={(e) => setNewDoctor({ ...newDoctor, full_name: e.target.value })}
                  placeholder="e.g. Dr. Arthur Pendelton"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Hospital Email</label>
                <input
                  type="email"
                  required
                  value={newDoctor.email}
                  onChange={(e) => setNewDoctor({ ...newDoctor, email: e.target.value })}
                  placeholder="dr.pendelton@auramed.hospital"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Temporary Password</label>
                <input
                  type="password"
                  required
                  value={newDoctor.password}
                  onChange={(e) => setNewDoctor({ ...newDoctor, password: e.target.value })}
                  placeholder="Min 6 characters"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">Clinical Specialty</label>
                <select
                  value={newDoctor.role}
                  onChange={(e) => setNewDoctor({ ...newDoctor, role: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800"
                >
                  <option value="Attending Cardiologist">Attending Cardiologist</option>
                  <option value="Critical Care Specialist (ICU)">Critical Care Specialist (ICU)</option>
                  <option value="General Inpatient Physician">General Inpatient Physician</option>
                  <option value="Attending Neurologist">Attending Neurologist</option>
                  <option value="Trauma & Emergency Surgeon">Trauma & Emergency Surgeon</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button type="button" onClick={() => setIsDoctorModalOpen(false)} className="px-4 py-2 text-slate-500 hover:text-slate-800 font-bold">
                  Cancel
                </button>
                <button type="submit" disabled={creatingDoctor} className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-extrabold shadow-kwik-card disabled:opacity-50">
                  {creatingDoctor ? 'Issuing...' : 'Create Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}