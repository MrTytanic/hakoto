
import { CircleAlert, CheckCircle2, X } from "lucide-react";
import "./Toast.css";

export type ToastData = {
  id: string;
  message: string;
  type: "success" | "error";
  undo?: () => Promise<void>;
  busy?: boolean;
};
export type UndoNotice = (message: string, undo: () => Promise<void>, discard?: () => Promise<void>) => void;

type ToastProps = {
  notifications: ToastData[];
  onDismiss: (id: string) => void;
  onUndo: (id: string) => void;
};

function Toast({ notifications, onDismiss, onUndo }: ToastProps) {
  return (
    <div className="toast-container" role="region" aria-label="Notifications">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`toast toast-${notification.type}`}
          role={notification.type === "error" ? "alert" : "status"}
        >
          {notification.type === "success"
            ? <CheckCircle2 size={19} />
            : <CircleAlert size={19} />}

          <span>{notification.message}</span>
          {notification.undo && <button type="button" className="toast-undo" disabled={notification.busy}
            onClick={() => onUndo(notification.id)}>{notification.busy ? "Undoing…" : "Undo"}</button>}

          <button
            type="button"
            aria-label="Dismiss notification"
            disabled={notification.busy}
            onClick={() => onDismiss(notification.id)}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default Toast;
