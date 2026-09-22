"use client";

import { createBrowserClient } from "@supabase/ssr";

function requiredPublicEnvironment(value: string | undefined, name: string) {

  if (!value) {
    throw new Error(`${name} is required. Add it to .env.local before starting AuraMed.`);
  }

  return value;
}

/** Browser client. This module intentionally has no access to server-only credentials. */
export function createClient() {
  return createBrowserClient(
    requiredPublicEnvironment(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL"),
    requiredPublicEnvironment(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}
