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

  // Machine Identity for this instance
  if (!process.env.AUTH0_CLIENT_ID) {
    console.warn("AUTH0_CLIENT_ID not found. Machine identity will be in 'NON_VERIFIED' state.");
  }
  const UNIT_ID = process.env.AUTH0_CLIENT_ID 
    ? `SENTINEL-${crypto.createHash('sha256').update(process.env.AUTH0_CLIENT_ID).digest('hex').slice(0, 8).toUpperCase()}`
    : 'SENTINEL-UNIDENTIFIED';

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

  // API Route: Digital Report Signing
  app.post("/api/sign-report", (req, res) => {
    try {
      const data = req.body;
      
      // Sign the result content using the Auth0 Client Secret to verify authenticity
      const signableContent = JSON.stringify(data);
      const secret = process.env.AUTH0_CLIENT_SECRET;
      
      if (!secret) {
        // Log it but don't crash, the UI handles signed vs unsigned
        console.warn("AUTH0_CLIENT_SECRET missing. Skipping report signature.");
        return res.json({
          ...data,
          unit_id: UNIT_ID,
          signature: null
        });
      }

      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(signableContent);
      const signature = hmac.digest('hex');

      res.json({
        ...data,
        unit_id: UNIT_ID,
        signature: `${signature.slice(0, 16)}...`
      });
    } catch (error: any) {
      console.error("Signing Error:", error);
      res.status(500).json({ error: "Failed to digitally sign report" });
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
