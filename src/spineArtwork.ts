import { invoke } from "@tauri-apps/api/core";
import { createSpinePaletteCache, sampleSpineColor, type SpinePalette } from "./spineColor";

const SAMPLE_EDGE = 24;
const MAX_ACTIVE = 4;
let active = 0;
const waiting: (() => void)[] = [];

async function readPalette(filename: string) {
  // The custom artwork protocol can display in an img but cannot always be sampled by Canvas.
  const response = await invoke<ArrayBuffer | number[]>("read_artwork_bytes", { filename });
  const bytes = Array.isArray(response) ? Uint8Array.from(response) : response;
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/webp" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = SAMPLE_EDGE / Math.max(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return sampleSpineColor(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const spinePalettes = createSpinePaletteCache(filename => new Promise<SpinePalette | null>((resolve, reject) => {
  const start = () => {
    active++;
    void readPalette(filename).then(resolve, reject).finally(() => {
      active--;
      waiting.shift()?.();
    });
  };
  if (active < MAX_ACTIVE) start();
  else waiting.push(start);
}));

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
