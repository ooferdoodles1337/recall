import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Geist Mono is loaded via @font-face in global.css
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
