export type AppMode = 'ocr' | 'latex';

export type OcrEngine = 'gemini' | 'gemma';

export type GeminiModel =
  | 'gemini-3.7-flash'
  | 'gemini-3.6-flash'
  | 'gemini-3.5-flash'
  | 'gemini-3.0-flash'
  | 'gemini-3.1-flash-lite'
  | 'gemini-2.0-flash'
  | 'gemini-1.5-flash'
  | 'gemini-1.5-pro'
  | 'auto'
  | 'gemini-3-flash-preview';

export type MathSolverModel =
  | 'gemini-3.7-flash'
  | 'gemini-3.6-flash'
  | 'gemini-3.5-flash'
  | 'gemini-3.0-flash'
  | 'gemini-2.0-flash'
  | 'gemini-1.5-pro';

export type OcrModel = GeminiModel | 'gemma-4-31b-it';

export type PageStatus = 'waiting' | 'processing' | 'done' | 'error';

export interface OcrPage {
  id: string;
  pageNumber: number;
  sourceName: string;
  imageDataUrl: string;
  markdown: string;
  status: PageStatus;
  error?: string;
}

export interface ApiKeyHealthResult {
  keyIndex: number;
  maskedKey: string;
  fullKey: string;
  status: 'success' | 'auth_error' | 'rate_limit' | 'api_error' | 'network_error';
  message: string;
  latencyMs?: number;
}

export interface OcrSettings {
  apiKey: string;
  apiKeys: string[];
  engine: OcrEngine;
  geminiModel: GeminiModel;
  mathModel: MathSolverModel;
  customPrompt: string;
  maxPages: number;
  renderScale: number;
  concurrency: number;
}

