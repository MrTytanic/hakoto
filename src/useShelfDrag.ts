import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { slotKey, type ArrangementSource } from "./shelfArrangement";
import type { ShelfSlot } from "./types/Shelf";

type Point = { x: number; y: number };
type Drag = { source: ArrangementSource; target: ShelfSlot | null };
type Gesture = {
  pointerId: number;
  element: HTMLElement;
  origin: Point;
  point: Point;
  source: ArrangementSource;
  active: boolean;
  target: ShelfSlot | null;
};

function hitSlot(root: HTMLElement | null, point: Point): ShelfSlot | null {
  const slot = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>("[data-shelf-slot]");
  return slot && root?.contains(slot) ? { row: Number(slot.dataset.row), column: Number(slot.dataset.column) } : null;
}

function edgeSpeed(value: number, start: number, end: number) {
  if (value < start || value > end || start >= end) return 0;
  const edge = Math.min(42, (end - start) / 3);
  if (value < start + edge) return -Math.ceil(16 * (start + edge - value) / edge);
  if (value > end - edge) return Math.ceil(16 * (value - end + edge) / edge);
  return 0;
}

function scrollAtPointer(root: HTMLElement | null, point: Point) {
  const main = root?.closest("main");
  if (!main) return;
  const outer = main.getBoundingClientRect();
  const inner = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>(".shelf-scroll");
  if (inner && root?.contains(inner)) {
    const bounds = inner.getBoundingClientRect();
    const before = inner.scrollTop;
    inner.scrollLeft += edgeSpeed(point.x, Math.max(bounds.left, outer.left), Math.min(bounds.right, outer.right));
    inner.scrollTop += edgeSpeed(point.y, Math.max(bounds.top, outer.top), Math.min(bounds.bottom, outer.bottom));
    if (inner.scrollTop !== before) return;
  }
  if (point.x >= outer.left && point.x <= outer.right) {
    main.scrollTop += edgeSpeed(point.y, Math.max(0, outer.top), Math.min(window.innerHeight, outer.bottom));
  }
}

export function useShelfDrag(root: RefObject<HTMLDivElement | null>, {
  onStart, onDrop, onCancel
}: {
  onStart: () => void;
  onDrop: (source: ArrangementSource, target: ShelfSlot | null) => void;
  onCancel: () => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const release = useCallback((releaseCapture = true) => {
    const current = gesture.current;
    gesture.current = null;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    if (releaseCapture && current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    return current;
  }, []);

  const cancel = useCallback(() => {
    if (!release()?.active) return false;
    suppressClick.current = true;
    setDrag(null);
    onCancel();
    return true;
  }, [release, onCancel]);

  useEffect(() => {
    const blur = () => { cancel(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && cancel()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("blur", blur);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", escape, true);
      release();
    };
  }, [cancel, release]);

  function tick() {
    const current = gesture.current;
    if (!current?.active) return;
    const { point } = current;
    scrollAtPointer(root.current, point);
    const target = hitSlot(root.current, point);
    if ((target && slotKey(target)) !== (current.target && slotKey(current.target))) {
      current.target = target;
      setDrag({ source: current.source, target });
    }
    const preview = previewRef.current;
    if (preview) {
      const x = Math.max(6, Math.min(point.x + 15, window.innerWidth - preview.offsetWidth - 6));
      const y = Math.max(6, Math.min(point.y + 15, window.innerHeight - preview.offsetHeight - 6));
      preview.style.transform = `translate(${x}px, ${y}px)`;
      preview.style.visibility = "visible";
    }
    frame.current = requestAnimationFrame(tick);
  }

  function start(event: ReactPointerEvent<HTMLElement>, source: ArrangementSource) {
    if (gesture.current || !event.isPrimary || event.button !== 0) return;
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    gesture.current = { pointerId: event.pointerId, element, origin: point, point, source, active: false, target: null };
  }

  function onPointerMove(event: PointerEvent) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.point = { x: event.clientX, y: event.clientY };
    if (current.active) return;
    if (Math.hypot(current.point.x - current.origin.x, current.point.y - current.origin.y) < 6) return;
    current.active = true;
    onStart();
    setDrag({ source: current.source, target: null });
    frame.current = requestAnimationFrame(tick);
  }

  function onPointerUp(event: PointerEvent) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    const current = release(false);
    if (!current?.active) return;
    suppressClick.current = true;
    setDrag(null);
    onDrop(current.source, hitSlot(root.current, { x: event.clientX, y: event.clientY }));
  }

  function onPointerCancel(event: PointerEvent) {
    if (gesture.current?.pointerId === event.pointerId) cancel();
  }

  function onPointerOut(event: PointerEvent) {
    const current = gesture.current;
    if (current?.pointerId === event.pointerId && !event.relatedTarget &&
      !current.element.hasPointerCapture(event.pointerId)) cancel();
  }

  // Keep tracking within the window even if the browser releases capture mid-gesture.
  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("pointerout", onPointerOut);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("pointerout", onPointerOut);
    };
  });

  function onClickCapture(event: MouseEvent) {
    if (!gesture.current?.active && (!suppressClick.current || event.detail === 0)) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return {
    drag, previewRef, start, cancel,
    pointerHandlers: {
      onPointerDownCapture: () => { if (!gesture.current) suppressClick.current = false; }, onClickCapture
    }
  };
}
