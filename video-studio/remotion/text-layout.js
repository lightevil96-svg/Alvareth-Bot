import { measureText } from "@remotion/layout-utils";

const FONT_FAMILY = "Inter, Arial, sans-serif";

export function normalizeDisplayText(value) {
  return String(value == null ? "" : value)
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .replace(/Dibuat\s*oleh/giu, match => match[0] === "D" ? "Dibuat oleh" : "dibuat oleh")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function fallbackTextWidth(text, fontSize) {
  const units = Array.from(text).reduce((sum, character) => {
    if (/\s/u.test(character)) return sum + 0.32;
    if (/[ilI.,:;'!|]/u.test(character)) return sum + 0.28;
    if (/[MW@#%&]/u.test(character)) return sum + 0.82;
    if (/[A-Z0-9]/u.test(character)) return sum + 0.62;
    return sum + 0.54;
  }, 0);
  return units * fontSize;
}

function measuredWidth(value, fontSize, fontWeight, letterSpacing) {
  const text = String(value || "");
  if (!text) return 0;
  if (typeof document === "undefined") {
    return fallbackTextWidth(text, fontSize) + Math.max(0, Array.from(text).length - 1) * letterSpacing;
  }
  return measureText({
    text,
    fontFamily: FONT_FAMILY,
    fontSize,
    fontWeight,
    letterSpacing: String(letterSpacing) + "px"
  }).width;
}

function splitLongWord(word, maxWidth, fontSize, fontWeight, letterSpacing) {
  const chunks = [];
  let current = "";
  for (const character of Array.from(word)) {
    const candidate = current + character;
    if (current && measuredWidth(candidate, fontSize, fontWeight, letterSpacing) > maxWidth) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapAtSize(value, maxWidth, fontSize, fontWeight, letterSpacing) {
  const paragraphs = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/u).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      if (measuredWidth(word, fontSize, fontWeight, letterSpacing) > maxWidth) {
        if (line) {
          lines.push(line);
          line = "";
        }
        const chunks = splitLongWord(word, maxWidth, fontSize, fontWeight, letterSpacing);
        lines.push(...chunks.slice(0, -1));
        line = chunks.at(-1) || "";
        continue;
      }
      const candidate = line ? line + " " + word : word;
      if (line && measuredWidth(candidate, fontSize, fontWeight, letterSpacing) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

export function fitTextBlock(value, maxWidth, options = {}) {
  const text = normalizeDisplayText(value);
  const width = Math.max(80, Number(maxWidth) || 80);
  const maxFontSize = Math.max(12, Number(options.maxFontSize) || 88);
  const minFontSize = Math.max(10, Math.min(maxFontSize, Number(options.minFontSize) || 28));
  const maxLines = Math.max(1, Math.floor(Number(options.maxLines) || 4));
  const fontWeight = options.fontWeight || 850;
  const letterSpacing = Number.isFinite(Number(options.letterSpacing)) ? Number(options.letterSpacing) : 0;
  let selected = null;

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 2) {
    const lines = wrapAtSize(text, width, fontSize, fontWeight, letterSpacing);
    if (lines.length <= maxLines) {
      selected = { fontSize, lines };
      break;
    }
  }

  if (!selected) {
    selected = {
      fontSize: minFontSize,
      lines: wrapAtSize(text, width, minFontSize, fontWeight, letterSpacing)
    };
  }

  return {
    text: selected.lines.join("\n"),
    lines: selected.lines,
    fontSize: selected.fontSize,
    lineCount: selected.lines.length,
    fits: selected.lines.length <= maxLines
  };
}
