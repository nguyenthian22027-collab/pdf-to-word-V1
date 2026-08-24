/**
 * Cấu hình các Backend phụ trợ (Pandoc, MathType OLE, PyMuPDF Render).
 */
export const HARD_CODED_BACKEND_APIS = {
  pdfRender: 'https://pymupdf-2026.onrender.com',
  pandoc: 'https://pandoc-server.onrender.com/convert',
  mathType: 'https://latex2mathtypeweb.onrender.com',
} as const;

const PLACEHOLDER_PATTERN = /TEN-DICH-VU|TEN-PANDOC|TEN-MATHTYPE/i;

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function normalizeEndpointUrl(value: string): string {
  return value.trim();
}

export const PDF_RENDER_API = normalizeBaseUrl(HARD_CODED_BACKEND_APIS.pdfRender);
export const PANDOC_API_URL = normalizeEndpointUrl(HARD_CODED_BACKEND_APIS.pandoc);
export const MATHTYPE_API = normalizeBaseUrl(HARD_CODED_BACKEND_APIS.mathType);

export function isHardcodedApiConfigured(value: string): boolean {
  return Boolean(value) && !PLACEHOLDER_PATTERN.test(value);
}
