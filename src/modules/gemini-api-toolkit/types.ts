export type ApiKeyHealthStatus =
  | 'success'
  | 'rate_limit'
  | 'auth_error'
  | 'api_error'
  | 'network_error';

export interface ApiKeyHealthResult {
  keyIndex: number;
  maskedKey: string;
  fullKey: string;
  status: ApiKeyHealthStatus;
  message: string;
  latencyMs?: number;
}

export type GeminiModel =
  | 'gemini-3.7-flash'
  | 'gemini-3.5-flash'
  | 'gemini-3.0-flash'
  | 'gemini-3.1-flash-lite'
  | 'gemini-3.6-flash'
  | 'gemini-2.0-flash'
  | 'gemini-1.5-flash'
  | 'gemini-1.5-pro'
  | 'auto';

export type MathSolverModel =
  | 'gemini-3.7-flash'
  | 'gemini-3.6-flash'
  | 'gemini-3.5-flash'
  | 'gemini-3.0-flash'
  | 'gemini-2.0-flash'
  | 'gemini-1.5-pro';

export interface CallGeminiOptions {
  prompt: string;
  apiKeysText: string;
  model?: GeminiModel;
  systemInstruction?: string;
  maxOutputTokens?: number;
  temperature?: number;
  onStreamText?: (accumulatedText: string) => void;
}
