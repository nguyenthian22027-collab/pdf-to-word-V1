import { GoogleGenAI } from '@google/genai';
import { parseApiKeys } from './apiHealthService';
import type { CallGeminiOptions, GeminiModel } from './types';

/**
 * Danh sách model mặc định khi người dùng chọn 'auto' (Tự động xoay vòng theo thứ tự từ mạnh đến ổn định)
 */
export const CANDIDATE_AUTO_MODELS: GeminiModel[] = [
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemini-2.0-flash',
];

/**
 * Gọi Google Gemini AI với cơ chế xoay vòng 2 lớp:
 * 1. Xoay vòng danh sách Model (nếu chọn 'auto').
 * 2. Tự động chuyển API Key khi gặp lỗi Quota (429/Resource Exhausted) hoặc Lỗi Xác thực (401/403).
 */
export async function callGeminiWithFailover({
  prompt,
  apiKeysText,
  model = 'auto',
  systemInstruction,
  maxOutputTokens = 65536,
  temperature = 0.2,
  onStreamText,
}: CallGeminiOptions): Promise<string> {
  const keys = parseApiKeys(apiKeysText);
  if (keys.length === 0) {
    throw new Error('Chưa nhập Gemini API Key. Hãy cấu hình API Key trước khi sử dụng.');
  }

  const candidateModels: string[] =
    model === 'auto'
      ? CANDIDATE_AUTO_MODELS
      : [model];

  const contents = [
    {
      role: 'user',
      parts: [{ text: prompt }],
    },
  ];

  const config: {
    maxOutputTokens: number;
    temperature: number;
    systemInstruction?: string;
  } = {
    maxOutputTokens,
    temperature,
  };

  if (systemInstruction?.trim()) {
    config.systemInstruction = systemInstruction.trim();
  }

  let lastError: unknown;

  // Lớp 1: Lặp qua từng model ứng viên
  for (const currentModel of candidateModels) {
    // Lớp 2: Lặp qua từng API key
    for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
      const activeKey = keys[keyIdx];
      const ai = new GoogleGenAI({ apiKey: activeKey });

      try {
        let fullText = '';
        const responseStream = await ai.models.generateContentStream({
          model: currentModel,
          config,
          contents,
        });

        for await (const chunk of responseStream) {
          // Trích xuất text từ response chunk
          const chunkText =
            chunk.candidates?.[0]?.content?.parts?.[0]?.text ||
            (typeof (chunk as any).text === 'function' ? (chunk as any).text() : '') ||
            '';

          if (chunkText) {
            fullText += chunkText;
            onStreamText?.(fullText);
          }
        }

        if (fullText.trim()) {
          return fullText; // Trả về ngay khi thành công
        }

        // Nếu stream không trả về nội dung, thử gọi non-stream dự phòng
        const fallbackResponse = await ai.models.generateContent({
          model: currentModel,
          config,
          contents,
        });

        const fallbackText =
          fallbackResponse.candidates?.[0]?.content?.parts?.[0]?.text ||
          (typeof (fallbackResponse as any).text === 'function' ? (fallbackResponse as any).text() : '') ||
          '';

        if (fallbackText.trim()) {
          onStreamText?.(fallbackText);
          return fallbackText;
        }

        throw new Error('Mô hình trả về nội dung rỗng.');
      } catch (err) {
        lastError = err;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[Gemini-Toolkit] Thử model ${currentModel} với Key #${keyIdx + 1} thất bại:`, errMsg);

        // Kiểm tra xem lỗi có phải do Quota/Rate Limit (429) hoặc Sai Key (401/403) không
        const isQuotaOrAuth = /429|RESOURCE_EXHAUSTED|rate limit|quota|401|403|API_KEY_INVALID/i.test(errMsg);
        if (isQuotaOrAuth && keyIdx < keys.length - 1) {
          console.info(`[Gemini-Toolkit] Tự động chuyển sang API Key tiếp theo (#${keyIdx + 2})...`);
          continue; // Nhảy sang key tiếp theo
        }
      }
    }
  }

  const finalErrMsg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Không thể hoàn thành yêu cầu với tất cả các Model & Key đã cung cấp: ${finalErrMsg}`);
}
