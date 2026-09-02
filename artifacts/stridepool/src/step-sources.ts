export type StepSourceId = "demo" | "manual" | "csv_import" | "apple_health" | "health_connect";

export type NormalizedWebSample = {
  sourceSampleId: string;
  recordDate: string;
  steps: number;
  startTime: string;
  endTime: string;
  recordedAt: string;
  rawPayload: Record<string, unknown>;
};

export const STEP_SOURCE_CATALOG = [
  { id: "demo" as const, label: "Demo steps", kind: "web", available: true },
  { id: "manual" as const, label: "Manual daily total", kind: "web", available: true },
  { id: "csv_import" as const, label: "CSV import", kind: "web", available: true },
  { id: "apple_health" as const, label: "Apple Health", kind: "native-companion", available: false },
  { id: "health_connect" as const, label: "Android Health Connect", kind: "native-companion", available: false },
] as const;

export function parseStepCsv(text: string, fileName: string, lastModified: number): NormalizedWebSample[] {
  return text.trim().split(/\r?\n/).slice(1).flatMap((line, index) => {
    const [recordDate, rawSteps] = line.split(",").map((cell) => cell.trim());
    const steps = Number(rawSteps);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate) || !Number.isInteger(steps) || steps < 0) return [];
    return [{
      sourceSampleId: `csv-${lastModified}-${recordDate}-${index}`,
      recordDate,
      steps,
      startTime: `${recordDate}T00:00:00.000Z`,
      endTime: `${recordDate}T23:59:59.999Z`,
      recordedAt: new Date().toISOString(),
      rawPayload: { import: "csv", fileName },
    }];
  });
}