import { useLayoutEffect, useRef, type ComponentPropsWithoutRef, type RefObject } from "react";
import "./Modal.css";

type ModalProps = Omit<ComponentPropsWithoutRef<"dialog">, "open" | "onClose" | "onCancel"> & {
  onDismiss: () => void;
  dismissOnBackdrop?: boolean;
  fallbackFocus?: RefObject<HTMLElement | null>;
};

export default function Modal({ className, onDismiss, dismissOnBackdrop, fallbackFocus, children, ...attributes }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const busy = attributes["aria-busy"];

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-initial-focus]")?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (fallbackFocus) requestAnimationFrame(() => {
        if (document.activeElement === document.body && !document.querySelector("dialog[open]")) {
          fallbackFocus.current?.focus();
        }
      });
    };
  }, [fallbackFocus]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const focused = document.activeElement;
    if (!busy || (dialog.contains(focused) && !focused?.matches(":disabled"))) return;
    const title = document.getElementById(dialog.getAttribute("aria-labelledby") ?? "");
    if (title && dialog.contains(title)) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
  }, [busy]);

  return (
    <dialog {...attributes} className={`app-modal${className ? ` ${className}` : ""}`} ref={dialogRef} aria-modal="true"
      onCancel={event => {
        event.preventDefault();
        onDismiss();
      }}
      onPointerDown={event => {
        pressedBackdrop.current = false;
        if (!dismissOnBackdrop || event.target !== event.currentTarget || event.button !== 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        pressedBackdrop.current = event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom;
      }}
      onClick={event => {
        if (pressedBackdrop.current && event.target === event.currentTarget) onDismiss();
        pressedBackdrop.current = false;
      }}
      onKeyDown={event => {
        if (event.key === "Escape") event.stopPropagation();
        if (event.key !== "Tab" || event.defaultPrevented) return;
        const dialog = event.currentTarget;
        const focusable = [...dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], summary, [tabindex]")]
          .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!first || !focusable.includes(active as HTMLElement) || active === (event.shiftKey ? first : last)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}>
      {children}
    </dialog>
  );
}
