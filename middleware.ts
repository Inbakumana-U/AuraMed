import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === '/login';
  const isAdminRoute = pathname.startsWith('/admin');

  // 1. Not logged in -> send to /login
  if (!user && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // 2. Only run the DB lookup if hitting /login or /admin (bypass for /dashboard to keep it fast)
  if (user && (isLoginPage || isAdminRoute)) {
    const { data: adminRecord } = await supabase
      .from('hospital_admins')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (isLoginPage) {
      return NextResponse.redirect(
        new URL(adminRecord ? '/admin' : '/dashboard', request.url)
      );
    }

    if (isAdminRoute && !adminRecord) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return response;
}

export const config = {
  // Exclude static assets, images, and API routes from middleware overhead
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};