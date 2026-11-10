type Rgb = readonly [number, number, number];

export type SpinePalette = { color: Rgb; text: "#000" | "#fff" };

export function relativeLuminance([red, green, blue]: Rgb) {
  function linear(channel: number) {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

export function contrastingText(color: Rgb): SpinePalette["text"] {
  const luminance = relativeLuminance(color) + 0.05;
  return luminance / 0.05 >= 1.05 / luminance ? "#000" : "#fff";
}

function average(red: number, green: number, blue: number, weight: number): Rgb {
  const channels = [red / weight, green / weight, blue / weight] as const;
  const lightness = (Math.min(...channels) + Math.max(...channels)) / 2;
  function usable(channel: number) {
    // Keep extreme monochrome covers distinguishable from the shelf surface.
    if (lightness < 36) return Math.round(channel + (255 - channel) * (36 - lightness) / (255 - lightness));
    if (lightness > 224) return Math.round(channel * 224 / lightness);
    return Math.round(channel);
  }
  return [usable(channels[0]), usable(channels[1]), usable(channels[2])];
}

export function sampleSpineColor(pixels: ArrayLike<number>): SpinePalette | null {
  const hues = Array.from({ length: 12 }, () => ({ red: 0, green: 0, blue: 0, weight: 0 }));
  const neutral = { red: 0, green: 0, blue: 0, weight: 0 };
  let coloredCoverage = 0;

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const opacity = pixels[i + 3] / 255;
    if (opacity < 0.35) continue;
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    neutral.red += red * opacity;
    neutral.green += green * opacity;
    neutral.blue += blue * opacity;
    neutral.weight += opacity;

    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    const chroma = high - low;
    if (chroma < 24) continue;
    coloredCoverage += opacity;

    const hue = high === red ? (green - blue) / chroma : high === green ? 2 + (blue - red) / chroma : 4 + (red - green) / chroma;
    const bucket = hues[(Math.round(hue * 2) + 12) % 12];
    const midtone = 1 - Math.abs((high + low) / 255 - 1);
    const weight = opacity * chroma * (0.35 + 0.65 * midtone);
    bucket.red += red * weight;
    bucket.green += green * weight;
    bucket.blue += blue * weight;
    bucket.weight += weight;
  }

  if (neutral.weight === 0) return null;
  // Pick a supported hue family before averaging, so complementary colors don't cancel out.
  const winner = hues.reduce((best, bucket) => bucket.weight > best.weight ? bucket : best);
  const sample = coloredCoverage >= neutral.weight * 0.05 ? winner : neutral;
  const color = average(sample.red, sample.green, sample.blue, sample.weight);
  return { color, text: contrastingText(color) };
}

export function createSpinePaletteCache(load: (filename: string) => Promise<SpinePalette | null>, capacity = 4096) {
  const palettes = new Map<string, SpinePalette | null>();
  const pending = new Map<string, Promise<SpinePalette | null>>();
  return {
    get(filename: string) { return palettes.get(filename); },
    request(filename: string) {
      const cached = palettes.get(filename);
      if (cached !== undefined) return Promise.resolve(cached);
      const inFlight = pending.get(filename);
      if (inFlight) return inFlight;

      const result = load(filename).catch(() => null).then(palette => {
        pending.delete(filename);
        palettes.set(filename, palette);
        const oldest = palettes.keys().next().value;
        if (palettes.size > capacity && oldest !== undefined) palettes.delete(oldest);
        return palette;
      });
      pending.set(filename, result);
      return result;
    }
  };
}
