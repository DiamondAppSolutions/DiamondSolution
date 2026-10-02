import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

// Checked here, before App (and transitively src/lib/supabase.ts) is even imported, so a
// missing config fails as a clear, visible on-page message — not a blank screen with nothing
// but a console error nobody but a developer would think to open. This bit the project once
// already (a Netlify deploy with no env vars set produced exactly that blank page), so it's
// fixed structurally rather than just in that one deployment.
const missing = [
  !import.meta.env.VITE_SUPABASE_URL && "VITE_SUPABASE_URL",
  !import.meta.env.VITE_SUPABASE_ANON_KEY && "VITE_SUPABASE_ANON_KEY",
].filter(Boolean) as string[];

if (missing.length > 0) {
  root.render(
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        background: "#f8f9fb",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          background: "white",
          border: "1px solid #fecaca",
          borderRadius: 16,
          padding: 24,
        }}
      >
        <h1
          style={{ color: "#be123c", fontSize: 18, fontWeight: 700, margin: 0 }}
        >
          Configuration missing
        </h1>
        <p style={{ color: "#334155", fontSize: 14, marginTop: 12 }}>
          This deployment is missing required environment variable
          {missing.length > 1 ? "s" : ""}: <strong>{missing.join(", ")}</strong>
          .
        </p>
        <p style={{ color: "#64748b", fontSize: 13, marginTop: 8 }}>
          Set {missing.length > 1 ? "them" : "it"} in your hosting provider's
          environment variables (Netlify: Site configuration → Environment
          variables), then trigger a new deploy — Vite bakes these in at build
          time, so adding the variable alone isn't enough.
        </p>
      </div>
    </div>,
  );
} else {
  import("./App.tsx").then(({ default: App }) => {
    root.render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    );
  });
}
