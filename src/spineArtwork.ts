import { invoke } from "@tauri-apps/api/core";
import { createSpinePaletteCache, sampleSpineColor, type SpinePalette } from "./spineColor";

const SAMPLE_EDGE = 24;
const MAX_ACTIVE = 4;
let active = 0;
type PaletteListener = (palette: SpinePalette | null) => void;
const waiting = new Map<string, Set<PaletteListener>>();
const sampling = new Map<string, Set<PaletteListener>>();

async function readPalette(filename: string) {
  // The custom artwork protocol can display in an img but cannot always be sampled by Canvas.
  const response = await invoke<ArrayBuffer | number[]>("read_artwork_bytes", { filename });
  const bytes = Array.isArray(response) ? Uint8Array.from(response) : response;
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
  const image = new Image();
  const canvas = document.createElement("canvas");
  try {
    image.src = url;
    await image.decode();
    const scale = SAMPLE_EDGE / Math.max(image.naturalWidth, image.naturalHeight);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return sampleSpineColor(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } finally {
    image.removeAttribute("src");
    canvas.width = canvas.height = 0;
    URL.revokeObjectURL(url);
  }
}

const spinePalettes = createSpinePaletteCache(readPalette);

function sampleWaitingSpines() {
  while (active < MAX_ACTIVE) {
    const next = waiting.entries().next();
    if (next.done) return;
    const [filename, listeners] = next.value;
    waiting.delete(filename);
    sampling.set(filename, listeners);
    active++;
    void spinePalettes.request(filename).then(palette => {
      sampling.delete(filename);
      active--;
      for (const listener of listeners) listener(palette);
      sampleWaitingSpines();
    });
  }
}

export function cachedSpinePalette(filename: string) {
  return spinePalettes.get(filename);
}

export function requestSpinePalette(filename: string, listener: PaletteListener) {
  const cached = cachedSpinePalette(filename);
  if (cached !== undefined) {
    listener(cached);
    return;
  }
  let listeners = sampling.get(filename) ?? waiting.get(filename);
  if (!listeners) {
    listeners = new Set();
    waiting.set(filename, listeners);
  }
  listeners.add(listener);
  sampleWaitingSpines();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) waiting.delete(filename);
  };
}

let observer: IntersectionObserver | undefined;
const onVisible = new WeakMap<Element, () => void>();

export function observeSpine(element: Element, load: () => void) {
  if (typeof IntersectionObserver === "undefined") {
    load();
    return;
  }
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const callback = onVisible.get(entry.target);
      onVisible.delete(entry.target);
      observer?.unobserve(entry.target);
      callback?.();
    }
  });
  onVisible.set(element, load);
  observer.observe(element);
  return () => {
    onVisible.delete(element);
    observer?.unobserve(element);
  };
}
