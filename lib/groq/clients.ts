import "server-only";

import Groq from "groq-sdk";

import { env } from "@/lib/env";

/** Isolated client for longitudinal-record synthesis workloads. */
export const groqSummarizer = new Groq({
  apiKey: env.GROQ_API_KEY_SUMMARIZER,
});

/** Isolated client for treatment decision-support workloads. */
export const groqClinical = new Groq({
  apiKey: env.GROQ_API_KEY_CLINICAL,
});
