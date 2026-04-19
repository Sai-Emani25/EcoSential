import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
}

export async function analyzeEnvironmentalSite(imageUri: string, mimeType: string): Promise<AuditResult> {
  const model = "gemini-3-flash-preview";

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        parts: [
          {
            text: `Act as a Lead Environmental Consultant. Analyze this image for violations of ISO 14001 standards. 
            Identify the primary ecological impact and generate a 3-step remediation plan.
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
          detailed_analysis: { type: Type.STRING }
        },
        required: ["agent_role", "primary_impact", "threat_level", "remediation_plan", "detailed_analysis"]
      }
    }
  });

  return JSON.parse(response.text || "{}");
}
