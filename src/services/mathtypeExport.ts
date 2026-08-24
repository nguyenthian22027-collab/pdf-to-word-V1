import { MATHTYPE_API, isHardcodedApiConfigured } from '../config/apiConfig';
import { applyWordDefaults, sanitizeMarkdownForPandoc } from './docxExportService';

const MATH_API = MATHTYPE_API;

// Luôn dùng đường dẫn proxy /mathtype-api thay vì gọi thẳng backend.
// - Khi dev (localhost): Vite proxy /mathtype-api -> latex2mathtypeweb.onrender.com
// - Khi production (Vercel): Vercel rewrites /mathtype-api -> latex2mathtypeweb.onrender.com
// Cả 2 đều tránh CORS vì request đi qua server trung gian, không phải từ trình duyệt.
const MATHTYPE_PROXY = '/mathtype-api';

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

  const apiBase = MATHTYPE_PROXY;
  console.log('[MathType] Gửi request tới:', `${apiBase}/api/convert-markdown`);

  let resp: Response;
  try {
    resp = await fetch(`${apiBase}/api/convert-markdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: safeMarkdown, formula_mode: 'mathtype' }),
    });
  } catch (networkErr) {
    console.error('[MathType] Lỗi mạng khi gọi backend:', networkErr);
    throw new Error(`Không kết nối được tới máy chủ MathType: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`);
  }

  console.log('[MathType] Phản hồi:', resp.status, resp.statusText);
  console.log('[MathType] X-Stats:', resp.headers.get('X-Stats'));
  console.log('[MathType] Content-Type:', resp.headers.get('Content-Type'));

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
  console.log('[MathType] Blob nhận được:', rawBlob.size, 'bytes, type:', rawBlob.type);

  let finalBlob = rawBlob;
  try {
    finalBlob = await applyWordDefaults(rawBlob, markdown);
    console.log('[MathType] Sau applyWordDefaults:', finalBlob.size, 'bytes');
  } catch (err) {
    console.warn('[MathType] Không thể hậu xử lý font/viền bảng:', err);
    // Tiếp tục dùng rawBlob nếu applyWordDefaults thất bại
  }

  // Đảm bảo blob có đúng MIME type cho .docx
  const docxBlob = new Blob([finalBlob], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  console.log('[MathType] Bắt đầu tải file:', filename);
  const url = URL.createObjectURL(docxBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Delay revoke để trình duyệt kịp đọc blob trước khi URL bị huỷ
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
    console.log('[MathType] Đã tải xong và giải phóng URL.');
  }, 5000);

  return { converted, failed };
}
