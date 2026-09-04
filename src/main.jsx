import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { migrateLegacyKeys } from "./lib/legacyKeys.js";
import "./index.css";

// Before anything reads storage: carry any saved work across from the app's
// previous key prefix. See lib/legacyKeys.js — it is idempotent and
// non-destructive, so running it on every boot costs nothing.
migrateLegacyKeys();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
