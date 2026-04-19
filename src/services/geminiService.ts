import { GoogleGenAI, Type } from "@google/genai";

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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function analyzeEnvironmentalSite(imageUri: string, mimeType: string): Promise<AuditResult> {
  const model = "gemini-3-flash-preview";

  const geminiResponse = await ai.models.generateContent({
    model,
    contents: [
      {
        parts: [
          {
            text: `Act as a Lead Environmental Consultant. Analyze this image for violations of ISO 14001 standards. 
            Identify the primary ecological impact and generate a 3-step remediation plan.
            Important: The 'detailed_analysis' field MUST be formatted with professional Markdown (including headers, lists, and bold text) to provide a rich, readable report.
            Provide the output in a structured JSON format following the schema provided.`
          },
          {
            inlineData: {
              data: imageUri.split(',')[1],
              mimeType
            }
          }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          agent_role: { type: Type.STRING },
          primary_impact: { type: Type.STRING },
          threat_level: { type: Type.STRING, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
          iso_compliance_status: { type: Type.STRING },
          remediation_plan: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                step: { type: Type.STRING },
                description: { type: Type.STRING }
              },
              required: ["step", "description"]
            }
          },
          detailed_analysis: { 
            type: Type.STRING,
            description: "Detailed environmental findings formatted in Markdown."
          }
        },
        required: ["agent_role", "primary_impact", "threat_level", "remediation_plan", "detailed_analysis"]
      }
    }
  });

  const result = JSON.parse(geminiResponse.text || "{}");

  // Step 2: Call backend to "sign" the report with the Auth0 Machine Identity
  const signResponse = await fetch("/api/sign-report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(result),
  });

  if (!signResponse.ok) {
    // If signing fails (e.g. Auth0 secret missing), still return the result but without signature
    console.warn("Backend report signing failed. Returning unsigned report.");
    return result;
  }

  return await signResponse.json();
}
