
import { CircleAlert, CheckCircle2, X } from "lucide-react";
import "./Toast.css";

export type ToastData = {
  id: string;
  message: string;
  type: "success" | "error";
};

type ToastProps = {
  notifications: ToastData[];
  onDismiss: (id: string) => void;
};

function Toast({ notifications, onDismiss }: ToastProps) {
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

          <button
            type="button"
            aria-label="Dismiss notification"
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