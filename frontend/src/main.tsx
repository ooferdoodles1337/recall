import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Fonts: Source Serif 4 and Geist are declared directly in global.css (latin subset only).
// IBM Plex Sans and IBM Plex Mono are loaded per-weight from Fontsource.
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-700.css";

import { App } from "./app/App";
import "./styles/global.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
