import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { full_name, email, password, role } = body;

    if (!full_name || !email || !password) {
      return NextResponse.json(
        { error: 'Doctor name, email, and password are required' },
        { status: 400 }
      );
    }

    const cleanName = full_name.trim();
    const cleanEmail = email.trim().toLowerCase();

    // 1. Create the Auth account with verified email & display name metadata
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: cleanEmail,
      password: password.trim(),
      email_confirm: true,
      user_metadata: {
        full_name: cleanName,
        name: cleanName,
      },
    });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || 'Failed to initialize staff authentication record' },
        { status: 400 }
      );
    }

    // 2. Generate sequential Staff ID: DOC-YYMM-1xx
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `DOC-${yy}${mm}-`;

    const { data: existingStaff } = await supabaseAdmin
      .from('clinicians')
      .select('staff_id')
      .like('staff_id', `${prefix}%`);

    const count = existingStaff ? existingStaff.length : 0;
    const staffId = `${prefix}${String(101 + count)}`;

    // 3. Register doctor in clinicians directory
    const { data: clinicianData, error: clinicianError } = await supabaseAdmin
      .from('clinicians')
      .insert([
        {
          id: authData.user.id,
          hospital_id: 'a0000000-0000-0000-0000-000000000001',
          full_name: cleanName,
          email: cleanEmail,
          role: role || 'Attending Physician',
          staff_id: staffId,
          is_active: true,
        },
      ])
      .select()
      .single();

    if (clinicianError) {
      // Rollback auth user on table error
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json({ error: clinicianError.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        success: true,
        doctor: clinicianData,
        temporary_password: password,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}