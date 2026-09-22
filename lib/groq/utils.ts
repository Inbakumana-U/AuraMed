import { z } from "zod";

export const clinicalRecordSchema = z.object({
  name: z.string().min(1).max(200),
  date: z.string().max(40).optional(),
  details: z.string().max(4_000).optional(),
});

/** Handles JSON-only model output, including a fenced JSON object if one slips through. */
export function parseModelJson(content: string | null | undefined): unknown {
  if (!content) throw new Error("The AI provider returned an empty response.");

  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(normalized);
  } catch {
    throw new Error("The AI provider returned invalid JSON.");
  }
}

export function validationMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`).join("; ");
}
