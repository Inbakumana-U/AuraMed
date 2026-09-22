import "server-only";

import { z } from "zod";

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string({ required_error: "NEXT_PUBLIC_SUPABASE_URL is required in .env.local." })
    .url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL."),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string({ required_error: "NEXT_PUBLIC_SUPABASE_ANON_KEY is required in .env.local." })
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY cannot be empty."),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string({ required_error: "SUPABASE_SERVICE_ROLE_KEY is required in .env.local." })
    .min(1, "SUPABASE_SERVICE_ROLE_KEY cannot be empty."),
  GROQ_API_KEY_SUMMARIZER: z
    .string({ required_error: "GROQ_API_KEY_SUMMARIZER is required in .env.local." })
    .min(1, "GROQ_API_KEY_SUMMARIZER cannot be empty."),
  GROQ_API_KEY_CLINICAL: z
    .string({ required_error: "GROQ_API_KEY_CLINICAL is required in .env.local." })
    .min(1, "GROQ_API_KEY_CLINICAL cannot be empty."),
});

const parsedEnvironment = environmentSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GROQ_API_KEY_SUMMARIZER: process.env.GROQ_API_KEY_SUMMARIZER,
  GROQ_API_KEY_CLINICAL: process.env.GROQ_API_KEY_CLINICAL,
});

if (!parsedEnvironment.success) {
  const issues = parsedEnvironment.error.issues
    .map((issue) => `- ${issue.message}`)
    .join("\n");

  throw new Error(`Invalid AuraMed environment configuration. Add the following values to .env.local:\n${issues}`);
}

/** Server-only environment. Do not import this module from Client Components. */
export const env = parsedEnvironment.data;
