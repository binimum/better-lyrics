import { TRANSLATE_IN_ROMAJI, TRANSLATE_LYRICS_URL, TRANSLATION_ERROR_LOG } from "@constants";
import { log } from "@utils";

interface TranslationResult {
  originalLanguage: string;
  translatedText: string;
}

interface TranslationCache {
  romanization: Map<string, string>;
  translation: Map<string, TranslationResult>;
}

const cache: TranslationCache = {
  romanization: new Map(),
  translation: new Map(),
};

interface BatchRequest {
  lines: string[];
  targetLanguage?: string; // For translations
  sourceLanguage?: string; // For romanizations
  signal?: AbortSignal;
}

interface BatchTranslationResponse {
  results: (TranslationResult | null)[];
  detectedLanguage: string;
}

interface BatchRomanizationResponse {
  results: (string | null)[];
  detectedLanguage: string;
}

const LINE_SEPARATOR = "\n\n";

/**
 * Translates a batch of lyric lines in a single request.
 */
export async function translateBatch(request: BatchRequest): Promise<BatchTranslationResponse> {
  const { lines, targetLanguage, signal } = request;
  if (!targetLanguage || lines.length === 0) {
    return { results: lines.map(() => null), detectedLanguage: "" };
  }

  const results: (TranslationResult | null)[] = new Array(lines.length).fill(null);
  const toTranslate: { index: number; text: string }[] = [];

  // Check cache first
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "♪") return;

    const cacheKey = `${targetLanguage}_${trimmed}`;
    if (cache.translation.has(cacheKey)) {
      results[index] = cache.translation.get(cacheKey)!;
    } else {
      toTranslate.push({ index, text: trimmed });
    }
  });

  if (toTranslate.length === 0) {
    return { results, detectedLanguage: results.find(r => r !== null)?.originalLanguage || "" };
  }

  let detectedLanguage = "";

  try {
    // Batch by joining with double newlines
    const combinedText = toTranslate.map(item => item.text).join(LINE_SEPARATOR);
    const url = TRANSLATE_LYRICS_URL(targetLanguage, combinedText);

    const response = await fetch(url, { cache: "force-cache", signal });
    const data = await response.json();

    detectedLanguage = data[2] || "";
    let fullTranslatedText = "";
    data[0].forEach((part: string[]) => {
      fullTranslatedText += part[0];
    });

    const translatedLines = fullTranslatedText.split(LINE_SEPARATOR);

    toTranslate.forEach((item, i) => {
      const translatedText = translatedLines[i]?.trim();
      if (translatedText && translatedText.toLowerCase() !== item.text.toLowerCase()) {
        const result = { originalLanguage: detectedLanguage, translatedText };
        cache.translation.set(`${targetLanguage}_${item.text}`, result);
        results[item.index] = result;
      }
    });
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      log(TRANSLATION_ERROR_LOG, error);
    }
  }

  return { results, detectedLanguage };
}

/**
 * Romanizes a batch of lyric lines in a single request.
 */
export async function romanizeBatch(request: BatchRequest): Promise<BatchRomanizationResponse> {
  const { lines, sourceLanguage, signal } = request;
  if (lines.length === 0) {
    return { results: lines.map(() => null), detectedLanguage: "" };
  }

  const results: (string | null)[] = new Array(lines.length).fill(null);
  const toRomanize: { index: number; text: string }[] = [];

  // Check cache first
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "♪") return;

    if (cache.romanization.has(trimmed)) {
      results[index] = cache.romanization.get(trimmed)!;
    } else {
      toRomanize.push({ index, text: trimmed });
    }
  });

  if (toRomanize.length === 0) {
    return { results, detectedLanguage: sourceLanguage || "auto" };
  }

  let detectedLanguage = sourceLanguage || "auto";

  try {
    const combinedText = toRomanize.map(item => item.text).join(LINE_SEPARATOR);
    const lang = sourceLanguage || "auto";
    const url = TRANSLATE_IN_ROMAJI(lang, combinedText);

    const response = await fetch(url, { cache: "force-cache", signal });
    const data = await response.json();

    detectedLanguage = data[2] || detectedLanguage;

    let fullRomanizedText = "";
    for (const part of data[0]) {
      if (part[3]) {
        fullRomanizedText += part[3];
      }
    }

    const romanizedLines = fullRomanizedText.split(LINE_SEPARATOR);

    toRomanize.forEach((item, i) => {
      const romanizedText = romanizedLines[i]?.trim();
      if (romanizedText && romanizedText.toLowerCase() !== item.text.toLowerCase()) {
        cache.romanization.set(item.text, romanizedText);
        results[item.index] = romanizedText;
      }
    });
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      log(TRANSLATION_ERROR_LOG, error);
    }
  }

  return { results, detectedLanguage };
}

export function clearCache(): void {
  cache.romanization.clear();
  cache.translation.clear();
}

export function getTranslationFromCache(text: string, targetLanguage: string): TranslationResult | null {
  const cacheKey = `${targetLanguage}_${text.trim()}`;
  return cache.translation.get(cacheKey) || null;
}

export function getRomanizationFromCache(text: string): string | null {
  return cache.romanization.get(text.trim()) || null;
}
