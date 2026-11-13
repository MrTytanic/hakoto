import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { applyBackupSettings, type BackupSettings } from "./settings";

type PendingBackupSettings = { restoreId: string; settings: BackupSettings; previousLocation: string };

async function start() {
  let restoreNotice: { message: string; type: "success" | "error" } | undefined;
  try {
    const pending = await invoke<PendingBackupSettings | null>("pending_backup_settings");
    if (pending) {
      try {
        applyBackupSettings(pending.restoreId, pending.settings);
        await invoke("finish_backup_settings", { token: pending.restoreId });
        restoreNotice = { message: `Backup restored. Previous collection: ${pending.previousLocation}`, type: "success" };
      } catch (error) {
        restoreNotice = {
          message: `The collection was restored, but restoring preferences could not be finalized. ${String(error)} Previous collection: ${pending.previousLocation}`,
          type: "error"
        };
      }
    }
  } catch (error) {
    console.error("Could not check for restored preferences:", error);
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode><App restoreNotice={restoreNotice} /></React.StrictMode>
  );
}

void start();
