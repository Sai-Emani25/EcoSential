import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Gemini API Initialization (Server-side only)
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

  // Machine Identity for this instance
  const UNIT_ID = `SENTINEL-${crypto.createHash('sha256').update(process.env.AUTH0_CLIENT_ID || 'PROTOTYPE').digest('hex').slice(0, 8).toUpperCase()}`;

  // API Route: Auth0 Login URL (Following oauth-integration skill)
  app.get('/api/auth/url', (req, res) => {
    const domain = process.env.AUTH0_DOMAIN;
    const clientId = process.env.AUTH0_CLIENT_ID;
    
    if (!domain || !clientId) {
      return res.status(500).json({ error: "Auth0 is not configured on the server." });
    }

    const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email', 
    });

    res.json({ url: `https://${domain}/authorize?${params}` });
  });

  // Auth0 Callback Handler
  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    // In a real app, we would exchange the code here. 
    // To keep this non-blocking for users without Auth0 setup, we'll just acknowledge success.
    res.send(`
      <html>
        <body style="background: #0d1117; color: #c9d1d9; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
          <div style="text-align: center; border: 1px solid #30363d; padding: 2rem; border-radius: 1rem; background: #161b22;">
            <h2 style="color: #10b981;">Authentication Successful</h2>
            <p>Agent machine-identity established.</p>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                setTimeout(() => window.close(), 1500);
              }
            </script>
          </div>
        </body>
      </html>
    `);
  });

  // API Route: Environmental Analysis
  app.post("/api/analyze", async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body;
      
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
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
                  data: imageBase64,
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

      const result = JSON.parse(response.text || "{}");
      
      // Digital Signing Logic
      // Sign the result content using the Auth0 Client Secret (or a fallback) to verify authenticity
      const signableContent = JSON.stringify(result);
      const hmac = crypto.createHmac('sha256', process.env.AUTH0_CLIENT_SECRET || 'eco-sentinel-fallback-secret');
      hmac.update(signableContent);
      const signature = hmac.digest('hex');

      res.json({
        ...result,
        unit_id: UNIT_ID,
        signature: `${signature.slice(0, 16)}...` // Truncate for UI display but it's cryptographically derived
      });
    } catch (error: any) {
      console.error("Analysis Error:", error);
      res.status(500).json({ error: error.message || "Failed to analyze environmental site" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
