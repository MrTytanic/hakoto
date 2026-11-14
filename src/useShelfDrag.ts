import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { slotKey, type ArrangementSource } from "./shelfArrangement";
import type { ShelfSlot } from "./types/Shelf";

type Point = { x: number; y: number };
type DropTarget = ShelfSlot | "trash" | null;
type Drag = { source: ArrangementSource; target: DropTarget };
type Gesture = {
  pointerId: number;
  element: HTMLElement;
  origin: Point;
  point: Point;
  source: ArrangementSource;
  active: boolean;
  target: DropTarget;
  dirty: boolean;
};

function hitTarget(root: HTMLElement | null, trash: HTMLElement | null, hit: Element | null): DropTarget {
  if (hit && trash?.contains(hit)) return "trash";
  const slot = hit?.closest<HTMLElement>("[data-shelf-slot]");
  return slot && root?.contains(slot) ? { row: Number(slot.dataset.row), column: Number(slot.dataset.column) } : null;
}

function targetKey(target: DropTarget) {
  return target && target !== "trash" ? slotKey(target) : target;
}

function edgeSpeed(value: number, start: number, end: number) {
  if (value < start || value > end || start >= end) return 0;
  const edge = Math.min(42, (end - start) / 3);
  if (value < start + edge) return -Math.ceil(16 * (start + edge - value) / edge);
  if (value > end - edge) return Math.ceil(16 * (value - end + edge) / edge);
  return 0;
}

function scrollAtPointer(root: HTMLElement | null, point: Point, hit: Element | null) {
  const main = root?.closest("main");
  if (!main) return false;
  const outer = main.getBoundingClientRect();
  const inner = hit?.closest<HTMLElement>(".shelf-scroll");
  let scrolled = false;
  if (inner && root?.contains(inner)) {
    const bounds = inner.getBoundingClientRect();
    const dx = edgeSpeed(point.x, Math.max(bounds.left, outer.left), Math.min(bounds.right, outer.right));
    const dy = edgeSpeed(point.y, Math.max(bounds.top, outer.top), Math.min(bounds.bottom, outer.bottom));
    if (dx || dy) {
      const { scrollTop, scrollLeft } = inner;
      if (dx) inner.scrollLeft += dx;
      if (dy) inner.scrollTop += dy;
      if (inner.scrollTop !== scrollTop) return true;
      scrolled = inner.scrollLeft !== scrollLeft;
    }
  }
  if (point.x >= outer.left && point.x <= outer.right) {
    const dy = edgeSpeed(point.y, Math.max(0, outer.top), Math.min(window.innerHeight, outer.bottom));
    if (dy) {
      const before = main.scrollTop;
      main.scrollTop += dy;
      scrolled ||= main.scrollTop !== before;
    }
  }
  return scrolled;
}

export function useShelfDrag(root: RefObject<HTMLDivElement | null>, {
  onStart, onDrop, onCancel
}: {
  onStart: () => void;
  onDrop: (source: ArrangementSource, target: DropTarget) => void;
  onCancel: () => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLDivElement>(null);

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

  const tick = useCallback(function updatePreview() {
    frame.current = undefined;
    const current = gesture.current;
    if (!current?.active || !current.dirty) return;
    const { point } = current;
    let hit = document.elementFromPoint(point.x, point.y);
    const overTrash = hit && trashRef.current?.contains(hit);
    const scrolled = !overTrash && scrollAtPointer(root.current, point, hit);
    if (scrolled) hit = document.elementFromPoint(point.x, point.y);
    const target = hitTarget(root.current, current.source.slot ? trashRef.current : null, hit);
    if (targetKey(target) !== targetKey(current.target)) {
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
    current.dirty = Boolean(scrolled);
    if (current.dirty) frame.current = requestAnimationFrame(updatePreview);
  }, [root]);

  const scheduleFrame = useCallback(() => {
    const current = gesture.current;
    if (!current?.active) return;
    current.dirty = true;
    if (frame.current === undefined) frame.current = requestAnimationFrame(tick);
  }, [tick]);

  const dragging = drag !== null;
  useLayoutEffect(() => {
    if (dragging) scheduleFrame();
  }, [dragging, scheduleFrame]);

  const start = useCallback((event: ReactPointerEvent<HTMLElement>, source: ArrangementSource, element = event.currentTarget) => {
    if (gesture.current || !event.isPrimary || event.button !== 0) return;
    element.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    gesture.current = {
      pointerId: event.pointerId, element, origin: point, point, source,
      active: false, target: null, dirty: false
    };
  }, []);

  const onPointerMove = useEffectEvent((event: PointerEvent) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.point = { x: event.clientX, y: event.clientY };
    if (!current.active) {
      if (Math.hypot(current.point.x - current.origin.x, current.point.y - current.origin.y) < 6) return;
      current.active = true;
      onStart();
      setDrag({ source: current.source, target: null });
    }
    scheduleFrame();
  });

  const onPointerUp = useEffectEvent((event: PointerEvent) => {
    if (gesture.current?.pointerId !== event.pointerId) return;
    const current = release(false);
    if (!current?.active) return;
    suppressClick.current = true;
    setDrag(null);
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    onDrop(current.source, hitTarget(root.current, current.source.slot ? trashRef.current : null, hit));
  });

  const onPointerCancel = useEffectEvent((event: PointerEvent) => {
    if (gesture.current?.pointerId === event.pointerId) cancel();
  });

  const onPointerOut = useEffectEvent((event: PointerEvent) => {
    const current = gesture.current;
    if (current?.pointerId === event.pointerId && !event.relatedTarget &&
      !current.element.hasPointerCapture(event.pointerId)) cancel();
  });

  // Keep tracking within the window even if the browser releases capture mid-gesture.
  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("pointerout", onPointerOut);
    window.addEventListener("scroll", scheduleFrame, true);
    window.addEventListener("resize", scheduleFrame);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("scroll", scheduleFrame, true);
      window.removeEventListener("resize", scheduleFrame);
    };
  }, [scheduleFrame]);

  function onClickCapture(event: MouseEvent) {
    if (!gesture.current?.active && (!suppressClick.current || event.detail === 0)) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return {
    drag, previewRef, trashRef, start, cancel,
    pointerHandlers: {
      onPointerDownCapture: () => { if (!gesture.current) suppressClick.current = false; }, onClickCapture
    }
  };
}
