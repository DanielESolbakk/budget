import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { installRendererBudgetApi } from "./browserPreviewApi.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found in document.");
}

const isBrowserPreview = installRendererBudgetApi(window);

createRoot(container).render(
  <React.StrictMode>
    <App isBrowserPreview={isBrowserPreview} />
  </React.StrictMode>
);
