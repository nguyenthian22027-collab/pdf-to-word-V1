import type { ApiKeyHealthResult } from '../types';

/**
 * Tách và làm sạch danh sách API Keys từ chuỗi nhập vào (phân tách bởi dòng mới, dấu phẩy, chấm phẩy hoặc khoảng trắng)
 */
export function parseApiKeys(rawText: string): string[] {
  if (!rawText) return [];
  return rawText
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Rút gọn hiển thị API key an toàn (VD: AIzaSyB7...9x2A)
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

/**
 * Kiểm tra sức khỏe của một API Key đơn lẻ theo chuẩn Google Gemini REST API
 */
export async function checkSingleApiKeyHealth(
  apiKey: string,
  keyIndex: number = 0,
  testModel: string = 'gemini-2.0-flash',
): Promise<ApiKeyHealthResult> {
  const cleanKey = apiKey.trim();
  const maskedKey = maskApiKey(cleanKey);

  if (!cleanKey) {
    return {
      keyIndex,
      maskedKey: '(Trống)',
      fullKey: cleanKey,
      status: 'auth_error',
      message: 'Chưa nhập API Key.',
    };
  }

  // Model dùng để test ping nhẹ nhất
  const model = testModel === 'auto' ? 'gemini-2.0-flash' : testModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleanKey)}`;

  const payload = {
    contents: [{ parts: [{ text: 'ping' }] }],
    generationConfig: { maxOutputTokens: 5 },
  };

  const startTime = performance.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Math.round(performance.now() - startTime);

    if (response.ok) {
      return {
        keyIndex,
        maskedKey,
        fullKey: cleanKey,
        status: 'success',
        message: `Hoạt động tốt (Độ trễ: ${latencyMs}ms)`,
        latencyMs,
      };
    }

    // Xử lý mã lỗi cụ thể từ response
    let errMsg = '';
    try {
      const errorData = await response.json();
      errMsg = errorData?.error?.message || '';
    } catch {
      errMsg = response.statusText;
    }

    if (response.status === 401 || response.status === 403) {
      return {
        keyIndex,
        maskedKey,
        fullKey: cleanKey,
        status: 'auth_error',
        message: 'API Key không hợp lệ hoặc bị khóa/chưa kích hoạt Gemini API.',
        latencyMs,
      };
    }

    if (response.status === 429) {
      return {
        keyIndex,
        maskedKey,
        fullKey: cleanKey,
        status: 'rate_limit',
        message: 'Đã vượt hạn mức (Quota Exceeded / Rate Limit). Hãy thử lại sau.',
        latencyMs,
      };
    }

    if (response.status === 400) {
      return {
        keyIndex,
        maskedKey,
        fullKey: cleanKey,
        status: 'api_error',
        message: `Lỗi yêu cầu (400 Bad Request): ${errMsg || 'Cú pháp không hợp lệ'}`,
        latencyMs,
      };
    }

    if (response.status >= 500) {
      return {
        keyIndex,
        maskedKey,
        fullKey: cleanKey,
        status: 'api_error',
        message: `Máy chủ Google AI đang bảo trì/quá tải (${response.status}): ${errMsg}`,
        latencyMs,
      };
    }

    return {
      keyIndex,
      maskedKey,
      fullKey: cleanKey,
      status: 'api_error',
      message: `Lỗi ${response.status}: ${errMsg || 'Không xác định'}`,
      latencyMs,
    };
  } catch (error: unknown) {
    const latencyMs = Math.round(performance.now() - startTime);
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        keyIndex,
        maskedKey,
        fullKey: cleanKey,
        status: 'network_error',
        message: 'Kết nối quá hạn (Timeout > 12s). Mạng quá chậm hoặc bị chặn.',
        latencyMs,
      };
    }

    const errMessage = error instanceof Error ? error.message : String(error);
    return {
      keyIndex,
      maskedKey,
      fullKey: cleanKey,
      status: 'network_error',
      message: `Không thể kết nối máy chủ: ${errMessage} (Kiểm tra mạng / VPN / Tường lửa)`,
      latencyMs,
    };
  }
}

/**
 * Kiểm tra sức khỏe toàn bộ danh sách API Keys
 */
export async function checkMultipleApiKeysHealth(
  apiKeys: string[],
  testModel: string = 'gemini-2.0-flash',
): Promise<ApiKeyHealthResult[]> {
  const promises = apiKeys.map((key, index) =>
    checkSingleApiKeyHealth(key, index, testModel),
  );
  return Promise.all(promises);
}
