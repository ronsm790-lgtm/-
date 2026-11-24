declare module 'arabic-reshaper' {
  export function convertArabic(text: string): string;
  const reshaper: {
    convertArabic: (text: string) => string;
    convertArabicBack?: (text: string) => string;
  };
  export default reshaper;
}

declare module 'bidi-js' {
  export interface BidiLevels {
    levels: Uint8Array;
    paragraphs: Array<{ start: number; end: number; level: number }>;
  }
  export interface BidiApi {
    getEmbeddingLevels: (text: string, direction?: 'ltr' | 'rtl' | 'auto') => BidiLevels;
    getReorderSegments: (
      text: string,
      levelsResult: BidiLevels,
      start?: number,
      end?: number
    ) => Array<[number, number]>;
    getReorderedString: (text: string, levelsResult: BidiLevels, start?: number, end?: number) => string;
    getReorderedIndices: (text: string, levelsResult: BidiLevels, start?: number, end?: number) => number[];
    getMirroredCharacter: (char: string) => string | null;
  }
  export default function bidiFactory(): BidiApi;
}
