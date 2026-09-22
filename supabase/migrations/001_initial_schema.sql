-- AuraMed initial clinical schema. Apply through the Supabase CLI migration flow.
create extension if not exists "pgcrypto";

create type public.condition_status as enum ('active', 'managed', 'resolved');
create type public.treatment_category as enum ('past', 'present');
create type public.test_result_status as enum ('normal', 'abnormal', 'critical');

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A clinician identity is an authenticated Supabase user scoped to one clinic.
create table public.clinicians (
  id uuid primary key references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  full_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  full_name text not null,
  dob date not null,
  gender text,
  blood_type text,
  emergency_contact jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Explicit assignment prevents every clinician at a clinic from seeing every patient.
create table public.patient_clinicians (
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinician_id uuid not null references public.clinicians(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (patient_id, clinician_id)
);

create table public.medical_conditions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  condition_name text not null,
  status public.condition_status not null default 'active',
  diagnosed_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.treatment_history (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  treatment_name text not null,
  category public.treatment_category not null,
  start_date date,
  end_date date,
  dosage text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treatment_dates_valid check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.vitals_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  heart_rate smallint check (heart_rate is null or heart_rate > 0),
  systolic_bp smallint check (systolic_bp is null or systolic_bp > 0),
  diastolic_bp smallint check (diastolic_bp is null or diastolic_bp > 0),
  respiratory_rate smallint check (respiratory_rate is null or respiratory_rate > 0),
  oxygen_saturation numeric(5,2) check (oxygen_saturation is null or oxygen_saturation between 0 and 100),
  temperature numeric(4,1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.test_results (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  test_name text not null,
  category text,
  test_date date not null,
  result_value text,
  reference_range text,
  status public.test_result_status not null default 'normal',
  document_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.surgical_history (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  procedure_name text not null,
  surgery_date date,
  surgeon text,
  hospital text,
  complications text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  table_name text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  record_id uuid not null,
  old_data jsonb,
  new_data jsonb,
  occurred_at timestamptz not null default now()
);

create index patients_clinic_id_idx on public.patients(clinic_id);
create index patient_clinicians_clinician_id_idx on public.patient_clinicians(clinician_id);
create index medical_conditions_patient_id_idx on public.medical_conditions(patient_id);
create index treatment_history_patient_id_idx on public.treatment_history(patient_id);
create index vitals_records_patient_recorded_at_idx on public.vitals_records(patient_id, recorded_at desc);
create index test_results_patient_id_idx on public.test_results(patient_id);
create index surgical_history_patient_id_idx on public.surgical_history(patient_id);
create index audit_log_patient_occurred_at_idx on public.audit_log(patient_id, occurred_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function public.is_clinician_in_clinic(target_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.clinicians c
    where c.id = auth.uid() and c.clinic_id = target_clinic_id
  );
$$;

create function public.can_access_patient(target_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.patient_clinicians pc
    join public.clinicians c on c.id = pc.clinician_id
    join public.patients p on p.id = pc.patient_id
    where pc.patient_id = target_patient_id
      and c.id = auth.uid()
      and c.clinic_id = p.clinic_id
  );
$$;

create function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (actor_id, patient_id, table_name, action, record_id, old_data, new_data)
  values (
    auth.uid(),
    case when tg_table_name = 'patients' then (row_data->>'id')::uuid else (row_data->>'patient_id')::uuid end,
    tg_table_name,
    tg_op,
    (row_data->>'id')::uuid,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger clinics_set_updated_at before update on public.clinics for each row execute function public.set_updated_at();
create trigger clinicians_set_updated_at before update on public.clinicians for each row execute function public.set_updated_at();
create trigger patients_set_updated_at before update on public.patients for each row execute function public.set_updated_at();
create trigger medical_conditions_set_updated_at before update on public.medical_conditions for each row execute function public.set_updated_at();
create trigger treatment_history_set_updated_at before update on public.treatment_history for each row execute function public.set_updated_at();
create trigger vitals_records_set_updated_at before update on public.vitals_records for each row execute function public.set_updated_at();
create trigger test_results_set_updated_at before update on public.test_results for each row execute function public.set_updated_at();
create trigger surgical_history_set_updated_at before update on public.surgical_history for each row execute function public.set_updated_at();

create trigger patients_audit after insert or update or delete on public.patients for each row execute function public.write_audit_log();
create trigger medical_conditions_audit after insert or update or delete on public.medical_conditions for each row execute function public.write_audit_log();
create trigger treatment_history_audit after insert or update or delete on public.treatment_history for each row execute function public.write_audit_log();
create trigger vitals_records_audit after insert or update or delete on public.vitals_records for each row execute function public.write_audit_log();
create trigger test_results_audit after insert or update or delete on public.test_results for each row execute function public.write_audit_log();
create trigger surgical_history_audit after insert or update or delete on public.surgical_history for each row execute function public.write_audit_log();

alter table public.clinics enable row level security;
alter table public.clinicians enable row level security;
alter table public.patients enable row level security;
alter table public.patient_clinicians enable row level security;
alter table public.medical_conditions enable row level security;
alter table public.treatment_history enable row level security;
alter table public.vitals_records enable row level security;
alter table public.test_results enable row level security;
alter table public.surgical_history enable row level security;
alter table public.audit_log enable row level security;

-- Clinic and clinician provisioning is intentionally service-role only.
create policy "Clinicians can read their clinic" on public.clinics for select to authenticated using (public.is_clinician_in_clinic(id));
create policy "Clinicians can read their own profile" on public.clinicians for select to authenticated using (id = auth.uid());
create policy "Clinicians can read their patient assignments" on public.patient_clinicians for select to authenticated using (clinician_id = auth.uid());

create policy "Assigned clinicians can read patients" on public.patients for select to authenticated using (public.can_access_patient(id));
create policy "Clinicians can register clinic patients" on public.patients for insert to authenticated with check (public.is_clinician_in_clinic(clinic_id));
create policy "Assigned clinicians can update patients" on public.patients for update to authenticated using (public.can_access_patient(id)) with check (public.is_clinician_in_clinic(clinic_id));
create policy "Assigned clinicians can delete patients" on public.patients for delete to authenticated using (public.can_access_patient(id));

create policy "Assigned clinicians access medical conditions" on public.medical_conditions for all to authenticated using (public.can_access_patient(patient_id)) with check (public.can_access_patient(patient_id));
create policy "Assigned clinicians access treatment history" on public.treatment_history for all to authenticated using (public.can_access_patient(patient_id)) with check (public.can_access_patient(patient_id));
create policy "Assigned clinicians access vitals" on public.vitals_records for all to authenticated using (public.can_access_patient(patient_id)) with check (public.can_access_patient(patient_id));
create policy "Assigned clinicians access test results" on public.test_results for all to authenticated using (public.can_access_patient(patient_id)) with check (public.can_access_patient(patient_id));
create policy "Assigned clinicians access surgical history" on public.surgical_history for all to authenticated using (public.can_access_patient(patient_id)) with check (public.can_access_patient(patient_id));

-- Audit records are append-only and inaccessible through the browser by default.
revoke all on function public.write_audit_log() from public;
revoke all on function public.is_clinician_in_clinic(uuid) from public;
revoke all on function public.can_access_patient(uuid) from public;
grant execute on function public.is_clinician_in_clinic(uuid), public.can_access_patient(uuid) to authenticated;
