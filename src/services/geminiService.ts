export interface RemediationStep {
  step: string;
  description: string;
}

export interface AuditResult {
  agent_role: string;
  primary_impact: string;
  threat_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  iso_compliance_status: string;
  remediation_plan: RemediationStep[];
  detailed_analysis: string;
  signature?: string;
  unit_id?: string;
}

export async function analyzeEnvironmentalSite(imageUri: string, mimeType: string): Promise<AuditResult> {
  // Call our new backend API to keep the GEMINI_API_KEY secure on the server
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      imageBase64: imageUri.split(',')[1],
      mimeType,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to analyze environmental site via backend");
  }

  return await response.json();
}
