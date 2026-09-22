export const mockPatient = {
  id: "AM-10482",
  fullName: "Eleanor Whitmore",
  age: 62,
  bloodType: "O+",
  status: "Active monitoring",
  conditions: [
    { name: "Hypertension", status: "active" as const, diagnosed: "2018" },
    { name: "Type 2 diabetes", status: "managed" as const, diagnosed: "2020" },
    { name: "Community-acquired pneumonia", status: "resolved" as const, diagnosed: "2023" },
  ],
  vitals: [
    { label: "Heart rate", value: "78", unit: "bpm", state: "normal" as const, detail: "Resting range" },
    { label: "Blood pressure", value: "138/86", unit: "mmHg", state: "caution" as const, detail: "Elevated systolic" },
    { label: "SpO₂", value: "97", unit: "%", state: "normal" as const, detail: "Room air" },
    { label: "Temperature", value: "37.8", unit: "°C", state: "attention" as const, detail: "Above baseline" },
  ],
  treatments: [
    { name: "Lisinopril", category: "ongoing" as const, date: "Mar 2018 — present", dose: "10 mg oral daily", note: "Blood-pressure management" },
    { name: "Metformin", category: "ongoing" as const, date: "Jan 2020 — present", dose: "500 mg oral twice daily", note: "Glycemic management" },
    { name: "Amoxicillin / clavulanate", category: "past" as const, date: "Nov 2023 — Nov 2023", dose: "Completed", note: "Pneumonia treatment course" },
  ],
  tests: [
    { test: "HbA1c", date: "18 Jun 2024", value: "7.2%", range: "4.0–5.6%", status: "High" },
    { test: "LDL cholesterol", date: "18 Jun 2024", value: "104 mg/dL", range: "< 100 mg/dL", status: "Borderline" },
    { test: "eGFR", date: "18 Jun 2024", value: "82 mL/min", range: "> 60 mL/min", status: "Normal" },
    { test: "Potassium", date: "18 Jun 2024", value: "4.3 mmol/L", range: "3.5–5.1 mmol/L", status: "Normal" },
  ],
  surgeries: [
    { procedure: "Laparoscopic cholecystectomy", date: "14 Aug 2016", surgeon: "Dr. Miriam Shah", hospital: "St. Anne's Medical Center", notes: "Uncomplicated recovery; no documented complications." },
    { procedure: "Right cataract extraction", date: "03 May 2021", surgeon: "Dr. R. Chen", hospital: "VisionCare Surgical Center", notes: "Intraocular lens placed; routine postoperative course." },
  ],
};
