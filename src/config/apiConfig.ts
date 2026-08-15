/**
 * Cấu hình backend HARD-CODED.
 *
 * Không đọc biến môi trường khi build hoặc runtime.
 * Chỉ cần thay đúng 3 URL dưới đây nếu đổi máy chủ.
 */
const HARD_CODED_API = {
  // URL gốc backend PyMuPDF. App tự nối /api/render-pdf và /api/crop-document.
  pdfRender: 'https://pymupdf-2026.onrender.com',

  // URL đầy đủ endpoint Pandoc nhận POST JSON { markdown }.
  pandoc: 'https://pandoc-server.onrender.com/convert',

  // URL gốc backend MathType. App tự nối /api/convert-markdown.
  mathType: 'https://latex2mathtypeweb.onrender.com',
} as const;

const PLACEHOLDER_PATTERN = /TEN-DICH-VU|TEN-PANDOC|TEN-MATHTYPE/i;

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function normalizeEndpointUrl(value: string): string {
  return value.trim();
}

export const PDF_RENDER_API = normalizeBaseUrl(HARD_CODED_API.pdfRender);
export const PANDOC_API_URL = normalizeEndpointUrl(HARD_CODED_API.pandoc);
export const MATHTYPE_API = normalizeBaseUrl(HARD_CODED_API.mathType);

/** Tránh gọi nhầm các URL mẫu trong source trước khi thay bằng URL thật. */
export function isHardcodedApiConfigured(value: string): boolean {
  return Boolean(value) && !PLACEHOLDER_PATTERN.test(value);
}
