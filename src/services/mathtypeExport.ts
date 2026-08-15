import { MATHTYPE_API, isHardcodedApiConfigured } from '../config/apiConfig';
import { applyWordDefaults, sanitizeMarkdownForPandoc } from './docxExportService';

const MATH_API = MATHTYPE_API;

export interface MathTypeResult {
  converted: number;
  failed: number;
}

/**
 * Gửi markdown -> backend -> nhận .docx (công thức = MathType OLE) và tự tải về.
 * Giữ nguyên bảng/ảnh/heading/in đậm của markdown.
 */
export async function exportMathTypeDocx(
  markdown: string,
  filename = 'tai_lieu_mathtype.docx'
): Promise<MathTypeResult> {
  if (!isHardcodedApiConfigured(MATH_API)) {
    throw new Error(
      'Chưa hardcode URL MathType thật trong src/config/apiConfig.ts.'
    );
  }

  const safeMarkdown = sanitizeMarkdownForPandoc(markdown);

  const resp = await fetch(`${MATH_API}/api/convert-markdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown: safeMarkdown, formula_mode: 'mathtype' }),
  });

  if (!resp.ok) {
    let msg = `Lỗi máy chủ (${resp.status})`;
    try {
      const j = await resp.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const [converted, failed] = (resp.headers.get('X-Stats') ?? '0,0')
    .split(',')
    .map((n) => parseInt(n, 10) || 0);

  const rawBlob = await resp.blob();
  let finalBlob = rawBlob;
  try {
    finalBlob = await applyWordDefaults(rawBlob, markdown);
  } catch (err) {
    console.warn('Không thể hậu xử lý font/viền bảng Word cho MathType docx:', err);
  }

  const url = URL.createObjectURL(finalBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return { converted, failed };
}
