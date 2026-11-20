import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { TitleBar } from "./components/TitleBar";
import {
  applyAccessibility,
  loadAccessibility,
} from "./lib/accessibility";
import { applyTheme, loadTheme } from "./lib/theme";
import "./styles.css";

applyTheme(loadTheme());
applyAccessibility(loadAccessibility());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TitleBar />
    <div className="app-frame">
      <App />
    </div>
  </StrictMode>,
);
