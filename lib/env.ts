import "server-only";
import { z } from "zod";

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url()
    .default(process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .default(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .default(process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role-key"),
  GROQ_API_KEY_SUMMARIZER: z
    .string()
    .default(process.env.GROQ_API_KEY_SUMMARIZER || process.env.GROQ_API_KEY || "placeholder-key"),
  GROQ_API_KEY_CLINICAL: z
    .string()
    .default(process.env.GROQ_API_KEY_CLINICAL || process.env.GROQ_API_KEY || "placeholder-key"),
});

const parsed = environmentSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GROQ_API_KEY_SUMMARIZER: process.env.GROQ_API_KEY_SUMMARIZER || process.env.GROQ_API_KEY,
  GROQ_API_KEY_CLINICAL: process.env.GROQ_API_KEY_CLINICAL || process.env.GROQ_API_KEY,
});

export const env = parsed.success
  ? parsed.data
  : {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
      GROQ_API_KEY_SUMMARIZER: process.env.GROQ_API_KEY || "",
      GROQ_API_KEY_CLINICAL: process.env.GROQ_API_KEY || "",
    };