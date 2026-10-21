import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/connected.css";
import "./styles/marketplace.css";
import "./styles/package.css";
import "./styles/setup.css";
const root = document.getElementById("root");
if (!root) throw new Error("Missing root element.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
