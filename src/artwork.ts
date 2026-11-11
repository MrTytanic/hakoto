import { convertFileSrc } from "@tauri-apps/api/core";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 500;
const MAX_WEBP_BYTES = 1024 * 1024;
let webpEncoder: ReturnType<typeof import("@jsquash/webp/codec/enc/webp_enc.js").default> | undefined;
const signatures: Record<string, (header: Uint8Array) => boolean> = {
  "image/png": header => [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => header[i] === byte),
  "image/jpeg": header => header[0] === 255 && header[1] === 216 && header[2] === 255,
  "image/webp": header =>
    String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...header.slice(8, 12)) === "WEBP",
};

export type ArtworkChange = { kind: "remove" } | { kind: "replace"; bytes: number[] };

export function artworkUrl(filename: string | null) {
  return filename && /^[a-f0-9]{32}\.webp$/.test(filename) ? convertFileSrc(filename, "artwork") : null;
}

export function checkArtworkFile(file: File, label = "Artwork") {
  if (!Object.prototype.hasOwnProperty.call(signatures, file.type)) {
    throw new Error("Please select a PNG, JPG, or WebP image.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${label} must be 5 MB or smaller.`);
  }
}

export async function encodeArtwork(file: File, label = "Artwork") {
  checkArtworkFile(file, label);
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!signatures[file.type](header)) {
    throw new Error("The selected file does not match its image format.");
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error(`The selected ${label.toLowerCase()} could not be opened.`);
    }

    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error();
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const webp = await new Promise<Blob | null>(resolve => {
        canvas.toBlob(resolve, "image/webp", 0.8);
      });
      const bytes: Uint8Array | null = webp?.type === "image/webp"
        ? new Uint8Array(await webp.arrayBuffer())
        : await encodeWebpFallback(context, canvas.width, canvas.height);
      if (!bytes?.length || bytes.length > MAX_WEBP_BYTES) throw new Error();
      return Array.from(bytes);
    } catch {
      throw new Error(`${label} could not be converted to WebP.`);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function encodeWebpFallback(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  // Older WebKitGTK builds return PNG. Bundle just the portable WASM encoder.
  const [{ default: createEncoder }, { defaultOptions }] = await Promise.all([
    import("@jsquash/webp/codec/enc/webp_enc.js"),
    import("@jsquash/webp/meta.js"),
  ]);
  webpEncoder ??= createEncoder();
  const encoder = await webpEncoder;
  return encoder.encode(context.getImageData(0, 0, width, height).data, width, height, {
    ...defaultOptions,
    quality: 80,
  });
}
