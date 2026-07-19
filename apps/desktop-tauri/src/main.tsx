import React from "react";
import { createRoot } from "react-dom/client";
import { DashboardApp } from "@agent-trace/dashboard-ui";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Desktop root element is missing.");

createRoot(root).render(
  <React.StrictMode>
    <DashboardApp apiBase="http://127.0.0.1:4319" routerMode="hash" initialPath="/runs" />
  </React.StrictMode>
);
