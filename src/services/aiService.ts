import { GoogleGenAI } from '@google/genai';
import type { OcrEngine, OcrModel } from '../types';
import { cropDocumentFiguresWithBackend, cropImageDataUrlPrecise } from './pdfUtils';

const MAX_INLINE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_REFERENCE_IMAGE_BYTES = 18 * 1024 * 1024;
export const MAX_OUTPUT_TOKENS = 65_536;

export const GEMINI_DOCUMENT_PROMPT = `OCR toàn bộ tài liệu nhiều trang này thành một tài liệu Markdown duy nhất để xuất sang Word.

Yêu cầu bắt buộc:
1. Đọc theo đúng thứ tự từng trang. Trước nội dung mỗi trang phải ghi marker đúng dạng <!-- Trang N -->, trong đó N bắt đầu từ 1.
2. Giữ nguyên tiêu đề, đoạn văn, danh sách, số câu, phương án A/B/C/D, ký hiệu và thứ tự nội dung. Không tự giải bài, không sửa đề, không thêm nhận xét.
3. Mọi công thức toán phải chuyển thành LaTeX. Công thức trong dòng dùng $...$; công thức riêng dòng dùng $$...$$. Không biến công thức thành ảnh.
4. Mọi bảng phải dùng bảng Markdown chuẩn với dấu |. Giữ đủ hàng, cột, ô trống và nội dung nhiều dòng; tuyệt đối không dùng HTML table.
5. Với hình vẽ, biểu đồ, sơ đồ hoặc ảnh minh họa có ý nghĩa, đặt marker trên MỘT DÒNG RIÊNG ngay đúng vị trí theo mẫu. Nếu bên dưới PDF có các ảnh tham chiếu từng trang thì phải dùng chính các ảnh đó để xác định hộp bao:
   [[IMAGE:page,ymin,xmin,ymax,xmax|mô tả ngắn]]
   - page là số trang bắt đầu từ 1.
   - ymin,xmin,ymax,xmax PHẢI là số nguyên trong thang 0..1000, tính trên TOÀN BỘ trang: góc trên-trái là (0,0), góc dưới-phải là (1000,1000).
   - Ví dụ vùng từ 12% đến 36% chiều cao và từ 20% đến 70% chiều rộng phải ghi [[IMAGE:1,120,200,360,700|...]].
   - Không dùng phần trăm, không dùng thang 0..100 và không đổi thứ tự thành x,y.
   - Không tạo marker cho logo, watermark, số trang hoặc họa tiết trang trí.
6. Không dùng cú pháp ảnh Markdown khác, không bọc kết quả trong code fence.
7. Phải OCR đủ tất cả các trang được yêu cầu, từ trang đầu đến trang cuối. Không được dừng sớm, không được bỏ trang và không thay phần còn lại bằng dấu ba chấm.
8. Chỉ trả về Markdown cuối cùng, không mở đầu bằng lời giải thích.`;

export const GEMMA_DOCUMENT_PROMPT = `OCR toàn bộ chuỗi ảnh trang tài liệu này thành một tài liệu Markdown duy nhất để xuất sang Word.

Yêu cầu bắt buộc:
1. Các ảnh được gửi theo thứ tự trang. Trước nội dung mỗi trang phải ghi marker đúng dạng <!-- Trang N -->, trong đó N bắt đầu từ 1.
2. Giữ nguyên tiêu đề, đoạn văn, danh sách, số câu, phương án A/B/C/D, ký hiệu và thứ tự nội dung. Không tự giải bài, không sửa đề, không thêm nhận xét.
3. Mọi công thức toán phải chuyển thành LaTeX: trong dòng dùng $...$, riêng dòng dùng $$...$$.
4. Ưu tiên đặc biệt cho bảng: mọi bảng phải dùng bảng Markdown chuẩn với dấu |, giữ tối đa hàng, cột, ô trống và nội dung nhiều dòng; không dùng HTML table.
5. Không cắt, không chèn và không tạo marker ảnh. Bỏ qua ảnh trang trí; hình có chữ quan trọng có thể mô tả ngắn bằng văn bản.
6. Phải OCR đủ tất cả các trang được yêu cầu, từ trang đầu đến trang cuối. Không được dừng sớm, không được bỏ trang và không thay phần còn lại bằng dấu ba chấm.
7. Không bọc kết quả trong code fence. Chỉ trả về Markdown cuối cùng.`;

export interface RenderedInputPage {
  pageNumber: number;
  imageDataUrl: string;
}

import { parseApiKeys } from './apiHealthService';

export interface ProcessOriginalDocumentOptions {
  apiKey: string;
  apiKeys?: string[];
  engine: OcrEngine;
  model: OcrModel;
  sourceFiles: File[];
  renderedPages?: RenderedInputPage[];
  maxPages: number;
  customPrompt?: string;
  onText?: (partialText: string) => void;
}

interface ParsedImageMarker {
  id: string;
  marker: string;
  start: number;
  end: number;
  pageNumber: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  alt: string;
  context: string;
}

interface LocatedFigure {
  id: string;
  found: boolean;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  confidence?: number;
}

export interface RefineImageMarkersOptions {
  apiKey: string;
  apiKeys?: string[];
  model: OcrModel;
  markdown: string;
  pageImages: Map<number, string>;
  onProgress?: (current: number, total: number, pageNumber: number) => void;
}

/**
 * Gửi một lần toàn bộ tài liệu cho AI.
 * - Gemini + PDF: gửi trực tiếp file PDF gốc application/pdf.
 * - Gemini + ảnh: gửi toàn bộ ảnh gốc trong cùng một request.
 * - Gemma + PDF: gửi toàn bộ ảnh trang đã render trong cùng một request.
 * - Hỗ trợ nhiều API Keys (tự động chuyển key khi gặp lỗi Quota/429 hoặc Auth).
 * - Hỗ trợ model 'auto' (tự động thử các model tốt nhất).
 */
export async function processOriginalDocument(
  options: ProcessOriginalDocumentOptions,
): Promise<string> {
  const allKeys = (
    options.apiKeys && options.apiKeys.length > 0
      ? options.apiKeys
      : parseApiKeys(options.apiKey)
  ).map((k) => k.trim()).filter(Boolean);

  if (allKeys.length === 0) throw new Error('Chưa nhập Gemini API key.');
  if (options.sourceFiles.length === 0) throw new Error('Chưa có file nguồn để OCR.');

  const candidateModels: string[] =
    options.model === 'auto'
      ? ['gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.0-flash', 'gemini-2.0-flash']
      : [options.model];

  const inputParts = await buildInputParts(options);
  const basePrompt = options.engine === 'gemini' ? GEMINI_DOCUMENT_PROMPT : GEMMA_DOCUMENT_PROMPT;
  const prompt = [
    basePrompt,
    `Chỉ OCR tối đa ${Math.max(1, options.maxPages)} trang đầu của tài liệu.`,
    options.customPrompt?.trim()
      ? `Yêu cầu bổ sung của người dùng:\n${options.customPrompt.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const contents = [
    {
      role: 'user',
      parts: [...inputParts, { text: prompt }],
    },
  ];

  const config = {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };

  let lastError: unknown;

  // Thử lần lượt từng model và từng key nếu gặp lỗi 429 hoặc xác thực
  for (const modelToTry of candidateModels) {
    for (let keyIdx = 0; keyIdx < allKeys.length; keyIdx += 1) {
      const activeKey = allKeys[keyIdx];
      const ai = new GoogleGenAI({ apiKey: activeKey });

      try {
        let fullText = '';
        let lastChunk: unknown;

        const stream = await ai.models.generateContentStream({
          model: modelToTry,
          config,
          contents,
        });

        for await (const chunk of stream) {
          lastChunk = chunk;
          const text = extractResponseText(chunk);
          if (text) {
            fullText += text;
            options.onText?.(fullText);
          }
        }

        if (!fullText.trim()) {
          const response = await ai.models.generateContent({
            model: modelToTry,
            config,
            contents,
          });
          fullText = extractResponseText(response);
          if (!fullText.trim()) {
            throw new Error(buildEmptyResponseMessage(response ?? lastChunk));
          }
        }

        return stripOuterCodeFence(fullText);
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`Thử model ${modelToTry} với Key #${keyIdx + 1} thất bại:`, msg);

        // Nếu còn key khác và gặp lỗi 429 hoặc 401/403 thì chuyển key tiếp theo
        const isQuotaOrAuth = /429|RESOURCE_EXHAUSTED|rate limit|quota|401|403|API_KEY_INVALID/i.test(msg);
        if (isQuotaOrAuth && keyIdx < allKeys.length - 1) {
          continue; // thử key tiếp theo
        }
      }
    }
  }

  throw new Error(toReadableApiError(lastError, candidateModels[0]));
}

export function hasDocumentImageMarkers(markdown: string): boolean {
  return /\[\[IMAGE\s*:/i.test(markdown);
}

/**
 * Khi PDF.js không thể tạo ảnh trang, vẫn giữ trọn kết quả OCR. Marker ảnh
 * được đổi thành ghi chú dễ đọc thay vì làm hỏng toàn bộ quá trình.
 */
export function replaceUnresolvedImageMarkers(markdown: string): string {
  const markerRegex = /\[\[IMAGE\s*:\s*(\d+)\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*\|\s*([^\]]*?)\s*\]\]/gi;
  return markdown.replace(markerRegex, (_marker, pageRaw: string, altRaw: string) => {
    const pageNumber = Math.max(1, Math.round(Number(pageRaw) || 1));
    const alt = sanitizeAltText(altRaw || `Hình minh họa trang ${pageNumber}`);
    return `\n\n> **Hình minh họa – trang ${pageNumber}:** ${alt} *(chưa lấy được ảnh trang PDF)*\n\n`;
  });
}

/**
 * Gọi Gemini lần 2 trên từng ảnh trang đã render để định vị lại chính xác các
 * hình mà lần OCR đầu đã mô tả. Lần 2 chỉ trả bbox, không OCR lại nội dung.
 */
export async function refineDocumentImageMarkers(
  options: RefineImageMarkersOptions,
): Promise<string> {
  const markers = parseImageMarkers(options.markdown);
  if (markers.length === 0 || options.pageImages.size === 0) return options.markdown;

  const allKeys = (
    options.apiKeys && options.apiKeys.length > 0
      ? options.apiKeys
      : parseApiKeys(options.apiKey)
  ).map((k) => k.trim()).filter(Boolean);

  if (allKeys.length === 0) return options.markdown;

  const groups = new Map<number, ParsedImageMarker[]>();
  for (const marker of markers) {
    if (!options.pageImages.has(marker.pageNumber)) continue;
    const list = groups.get(marker.pageNumber) ?? [];
    list.push(marker);
    groups.set(marker.pageNumber, list);
  }

  const pages = [...groups.keys()].sort((a, b) => a - b);
  if (pages.length === 0) return options.markdown;

  const modelToUse = options.model === 'auto' ? 'gemini-3.7-flash' : options.model;
  const replacements = new Map<string, string>();
  let currentKeyIdx = 0;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const pageNumber = pages[pageIndex];
    const pageMarkers = groups.get(pageNumber) ?? [];
    const pageImage = options.pageImages.get(pageNumber);
    if (!pageImage || pageMarkers.length === 0) continue;

    options.onProgress?.(pageIndex + 1, pages.length, pageNumber);

    try {
      const parsed = parseDataUrl(pageImage);
      const targets = pageMarkers.map((marker) => ({
        id: marker.id,
        description: marker.alt,
        surrounding_text: marker.context,
        old_bbox_hint: {
          ymin: Math.round(marker.top * 1000),
          xmin: Math.round(marker.left * 1000),
          ymax: Math.round(marker.bottom * 1000),
          xmax: Math.round(marker.right * 1000),
        },
      }));

      const prompt = buildFigureLocatorPrompt(pageNumber, targets);
      let response: unknown = null;

      for (let k = 0; k < allKeys.length; k += 1) {
        const keyToUse = allKeys[(currentKeyIdx + k) % allKeys.length];
        try {
          const ai = new GoogleGenAI({ apiKey: keyToUse });
          response = await ai.models.generateContent({
            model: modelToUse,
            config: {
              maxOutputTokens: 8_192,
              responseMimeType: 'application/json',
            },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: parsed.mimeType,
                      data: parsed.base64,
                    },
                  },
                  { text: prompt },
                ],
              },
            ],
          });
          currentKeyIdx = (currentKeyIdx + k) % allKeys.length;
          break;
        } catch (callErr) {
          const errMsg = callErr instanceof Error ? callErr.message : String(callErr);
          console.warn(`Lỗi định vị ảnh trang ${pageNumber} với key ${k + 1}:`, errMsg);
          if (/429|quota|rate limit|401|403/i.test(errMsg) && k < allKeys.length - 1) {
            continue;
          }
          break;
        }
      }

      if (!response) continue;

      const located = parseFigureLocatorResponse(extractResponseText(response));
      const byId = new Map(located.map((figure) => [figure.id, figure] as const));

      for (const marker of pageMarkers) {
        const figure = byId.get(marker.id);
        if (!figure?.found) continue;
        const normalized = normalizeLocatorCoordinates(figure);
        if (!normalized) continue;

        const [top, left, bottom, right] = normalized;
        replacements.set(
          marker.id,
          `[[IMAGE:${marker.pageNumber},${Math.round(top * 1000)},${Math.round(left * 1000)},${Math.round(bottom * 1000)},${Math.round(right * 1000)}|${marker.alt}]]`,
        );
      }
    } catch (error) {
      // Không để lỗi định vị lần 2 làm mất kết quả OCR. Khi lỗi sẽ dùng bbox cũ.
      console.warn(`Không định vị lại được hình ở trang ${pageNumber}:`, error);
    }
  }

  if (replacements.size === 0) return options.markdown;

  let output = options.markdown;
  const reverseMarkers = [...markers].sort((a, b) => b.start - a.start);
  for (const marker of reverseMarkers) {
    const replacement = replacements.get(marker.id);
    if (!replacement) continue;
    output = output.slice(0, marker.start) + replacement + output.slice(marker.end);
  }
  return output;
}

export async function replaceDocumentImageMarkers(
  markdown: string,
  pageImages: Map<number, string>,
  sourceFile?: File,
): Promise<string> {
  const markers = parseImageMarkers(markdown);
  if (markers.length === 0) return markdown;

  let backendCrops = new Map<string, string>();
  if (sourceFile) {
    try {
      backendCrops = await cropDocumentFiguresWithBackend(
        sourceFile,
        markers.map((marker) => ({
          id: marker.id,
          pageNumber: marker.pageNumber,
          description: marker.alt,
          ymin: marker.top * 1000,
          xmin: marker.left * 1000,
          ymax: marker.bottom * 1000,
          xmax: marker.right * 1000,
        })),
      );
    } catch (error) {
      // Backend là đường chính nhưng không để lỗi crop làm mất toàn bộ OCR.
      console.warn('Backend không cắt được hình, chuyển sang crop cục bộ:', error);
    }
  }

  let output = markdown;
  for (const marker of [...markers].sort((a, b) => b.start - a.start)) {
    const sourceImage = pageImages.get(marker.pageNumber);
    let dataUrl = backendCrops.get(marker.id) ?? '';

    if (!dataUrl && sourceImage) {
      try {
        const cropped = await cropImageDataUrlPrecise(
          sourceImage,
          marker.top,
          marker.left,
          marker.bottom,
          marker.right,
        );
        dataUrl = cropped.dataUrl;
      } catch (error) {
        console.warn('Không cắt được vùng ảnh cục bộ:', marker.marker, error);
      }
    }

    const replacement = dataUrl
      ? `\n\n![${marker.alt}](${dataUrl})\n\n`
      : `\n\n> **${marker.alt}:** không cắt được đúng vùng hình trên trang ${marker.pageNumber}.\n\n`;
    output = output.slice(0, marker.start) + replacement + output.slice(marker.end);
  }

  return output;
}

function parseImageMarkers(markdown: string): ParsedImageMarker[] {
  const markerRegex = /\[\[IMAGE\s*:\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\|\s*([^\]]*?)\s*\]\]/gi;
  const matches = [...markdown.matchAll(markerRegex)];
  const counters = new Map<number, number>();

  return matches.map((match) => {
    const pageNumber = Math.max(1, Math.round(Number(match[1]) || 1));
    const count = (counters.get(pageNumber) ?? 0) + 1;
    counters.set(pageNumber, count);
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const contextStart = Math.max(0, start - 260);
    const contextEnd = Math.min(markdown.length, end + 260);
    const [top, left, bottom, right] = normalizeCoordinateTuple([
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    ]);

    return {
      id: `p${pageNumber}_f${count}`,
      marker: match[0],
      start,
      end,
      pageNumber,
      top,
      left,
      bottom,
      right,
      alt: sanitizeAltText(match[6] || `Hình minh họa trang ${pageNumber}`),
      context: markdown
        .slice(contextStart, contextEnd)
        .replace(/\[\[IMAGE[\s\S]*?\]\]/gi, '[VỊ TRÍ HÌNH]')
        .replace(/\s+/g, ' ')
        .trim(),
    };
  });
}

function buildFigureLocatorPrompt(
  pageNumber: number,
  targets: Array<Record<string, unknown>>,
): string {
  return `Bạn chỉ làm nhiệm vụ ĐỊNH VỊ HÌNH trên ảnh toàn trang ${pageNumber}. Không OCR lại tài liệu và không giải bài.

Các mục tiêu cần tìm:
${JSON.stringify(targets, null, 2)}

Quy tắc bắt buộc:
1. Tìm đúng đối tượng khớp với description và surrounding_text. old_bbox_hint chỉ là gợi ý có thể sai hoàn toàn.
2. Hộp bao phải chứa TRỌN VẸN hình vẽ/đồ thị/sơ đồ, gồm toàn bộ nét liền, nét đứt, mũi tên, nhãn điểm, tên trục, số trên trục và chú thích trực tiếp thuộc hình.
3. Đặt bbox sát phần tử ngoài cùng thuộc hình nhưng không cắt vào nét/nhãn. KHÔNG cộng lề trắng lớn vì backend sẽ tự chừa biên an toàn.
4. Không lấy phần đề bài, phương án A/B/C/D, bảng số liệu hoặc hình khác ở gần. Chỉ lấy bảng khi description thật sự mô tả một bảng.
5. Tọa độ là số nguyên 0..1000 trên toàn bộ ảnh trang, gốc ở góc trên-trái, theo đúng thứ tự ymin,xmin,ymax,xmax.
6. Nếu không tìm thấy chắc chắn thì found=false. Không đoán sang một đối tượng khác có nhiều nét đen hơn.
7. Mỗi id phải xuất hiện đúng một lần.

Chỉ trả JSON hợp lệ:
{
  "figures": [
    {
      "id": "p1_f1",
      "found": true,
      "bbox": { "ymin": 0, "xmin": 0, "ymax": 1000, "xmax": 1000 },
      "confidence": 0.0
    }
  ]
}`;
}

function parseFigureLocatorResponse(text: string): LocatedFigure[] {
  if (!text.trim()) return [];
  const cleaned = stripOuterCodeFence(text).trim();
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first < 0 || last <= first) return [];
    try {
      value = JSON.parse(cleaned.slice(first, last + 1));
    } catch {
      return [];
    }
  }

  const root = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rows = Array.isArray(root.figures) ? root.figures : [];
  return rows.flatMap((row): LocatedFigure[] => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    const bbox = item.bbox && typeof item.bbox === 'object'
      ? (item.bbox as Record<string, unknown>)
      : item;
    const id = String(item.id ?? '').trim();
    if (!id) return [];
    return [{
      id,
      found: item.found !== false,
      ymin: Number(bbox.ymin),
      xmin: Number(bbox.xmin),
      ymax: Number(bbox.ymax),
      xmax: Number(bbox.xmax),
      confidence: Number(item.confidence),
    }];
  });
}

function normalizeLocatorCoordinates(
  figure: LocatedFigure,
): [number, number, number, number] | null {
  const values = [figure.ymin, figure.xmin, figure.ymax, figure.xmax];
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [top, left, bottom, right] = values.map((value) => Math.min(1, Math.max(0, value / 1000)));
  if (bottom - top < 0.015 || right - left < 0.015) return null;
  if (bottom <= top || right <= left) return null;
  return [top, left, bottom, right];
}

async function buildInputParts(options: ProcessOriginalDocumentOptions): Promise<Array<Record<string, unknown>>> {
  const first = options.sourceFiles[0];
  const isPdf = first.type === 'application/pdf';

  if (options.engine === 'gemma' && isPdf) {
    if (!options.renderedPages?.length) {
      throw new Error('Chưa tạo ảnh trang PDF cho chế độ Gemma.');
    }
    return options.renderedPages.slice(0, options.maxPages).flatMap((page) => {
      const parsed = parseDataUrl(page.imageDataUrl);
      return [
        { text: `Ảnh trang ${page.pageNumber}:` },
        {
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.base64,
          },
        },
      ];
    });
  }

  const files = isPdf ? [first] : options.sourceFiles.slice(0, options.maxPages);
  const parts: Array<Record<string, unknown>> = [];
  for (const file of files) {
    if (file.size > MAX_INLINE_FILE_BYTES) {
      throw new Error(`File ${file.name} vượt quá 50 MB, không thể gửi inline cho Gemini API.`);
    }
    parts.push({
      inlineData: {
        mimeType: file.type || guessMimeType(file.name),
        data: await fileToBase64(file),
      },
    });
  }

  // Gemini vẫn OCR từ PDF gốc trong một request. Các ảnh trang render cục bộ chỉ
  // làm mốc tọa độ để model trả hộp bao đúng; không phải các request OCR riêng.
  if (isPdf && options.engine === 'gemini' && options.renderedPages?.length) {
    const referenceParts: Array<Record<string, unknown>> = [];
    let usedBytes = 0;

    for (const page of options.renderedPages.slice(0, options.maxPages)) {
      const parsed = parseDataUrl(page.imageDataUrl);
      const estimatedBytes = Math.ceil((parsed.base64.length * 3) / 4);
      if (usedBytes + estimatedBytes > MAX_REFERENCE_IMAGE_BYTES) break;
      usedBytes += estimatedBytes;
      referenceParts.push(
        {
          text:
            `Ảnh tham chiếu trang ${page.pageNumber}. ` +
            'Chỉ dùng ảnh này để xác định marker IMAGE theo thang ymin,xmin,ymax,xmax = 0..1000.',
        },
        {
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.base64,
          },
        },
      );
    }

    if (referenceParts.length > 0) {
      parts.push({
        text:
          'Sau PDF gốc là các ảnh tham chiếu từng trang. OCR nội dung từ PDF gốc; ' +
          'khi ghi marker IMAGE, đo hộp bao trên đúng ảnh tham chiếu có cùng số trang.',
      });
      parts.push(...referenceParts);
    }
  }

  return parts;
}

function extractResponseText(response: unknown): string {
  if (!response || typeof response !== 'object') return '';
  const value = response as Record<string, unknown>;

  try {
    const direct = value.text;
    if (typeof direct === 'string' && direct.trim()) return direct;
  } catch {
    // getter text có thể ném lỗi khi candidate không có text
  }

  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  const textParts: string[] = [];
  for (const candidate of candidates) {
    const content = (candidate as Record<string, unknown>)?.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of parts) {
      const text = (part as Record<string, unknown>)?.text;
      if (typeof text === 'string' && text) textParts.push(text);
    }
  }
  return textParts.join('');
}

function buildEmptyResponseMessage(response: unknown): string {
  const value = (response && typeof response === 'object' ? response : {}) as Record<string, unknown>;
  const candidates = Array.isArray(value.candidates) ? value.candidates : [];
  const finishReasons = candidates
    .map((candidate) => String((candidate as Record<string, unknown>)?.finishReason ?? ''))
    .filter(Boolean);
  const promptFeedback = value.promptFeedback as Record<string, unknown> | undefined;
  const blockReason = promptFeedback?.blockReason ? String(promptFeedback.blockReason) : '';

  const details = [
    finishReasons.length ? `finishReason=${finishReasons.join(',')}` : '',
    blockReason ? `blockReason=${blockReason}` : '',
  ]
    .filter(Boolean)
    .join('; ');

  return details
    ? `Mô hình không trả về nội dung OCR (${details}).`
    : 'Mô hình không trả về nội dung OCR sau cả hai lần gọi.';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error(`Không chuyển được ${file.name} sang base64.`));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error(`Không đọc được file ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) throw new Error('Dữ liệu ảnh không hợp lệ.');
  return { mimeType: match[1], base64: match[2] };
}

function guessMimeType(filename: string): string {
  if (/\.pdf$/i.test(filename)) return 'application/pdf';
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  return 'image/jpeg';
}

function normalizeCoordinateTuple(values: number[]): [number, number, number, number] {
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Tọa độ ảnh không hợp lệ.');
  }

  const maximum = Math.max(...values.map((value) => Math.abs(value)));
  // Prompt mới quy định 0..1000. Chỉ coi là 0..1 khi cả bốn số thực sự <= 1.
  // Bản cũ chuẩn hóa từng số riêng lẻ nên marker kiểu 80,200,180,600 bị hiểu
  // 80 -> 0.8 nhưng 200 -> 0.2, dẫn đến crop vùng trắng.
  const divisor = maximum <= 1 ? 1 : 1000;
  const normalized = values.map((value) => Math.min(1, Math.max(0, value / divisor)));
  return normalized as [number, number, number, number];
}

function stripOuterCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (match ? match[1] : trimmed).trim();
}

function sanitizeAltText(value: string): string {
  return value.replace(/[\[\]()]/g, '').replace(/\s+/g, ' ').trim() || 'Hình minh họa';
}

function toReadableApiError(error: unknown, model: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/API_KEY_INVALID|API key not valid|invalid api key/i.test(message)) {
    return 'Gemini API key không hợp lệ hoặc chưa được cấp quyền dùng Gemini API.';
  }
  if (/429|RESOURCE_EXHAUSTED|rate limit|quota/i.test(message)) {
    return `Đã vượt hạn mức hoặc tốc độ gọi API của ${model}. Hãy kiểm tra quota của API key.`;
  }
  if (/404|NOT_FOUND|model.*not found/i.test(message)) {
    return `Không tìm thấy model ${model} trong tài khoản/API hiện tại.`;
  }
  if (/SAFETY|blocked|PROHIBITED_CONTENT/i.test(message)) {
    return `Nội dung bị bộ lọc an toàn của ${model} chặn.`;
  }
  if (/fetch|network|Failed to fetch|CORS/i.test(message)) {
    return `Không kết nối được Gemini API khi dùng ${model}. Kiểm tra mạng, API key và giới hạn trình duyệt.`;
  }
  if (message.startsWith(`Lỗi ${model}:`)) return message;
  return `Lỗi ${model}: ${message}`;
}

export interface AiOptimizeLatexOptions {
  apiKey?: string;
  apiKeys?: string[];
  model?: string;
  content: string;
  onText?: (partialText: string) => void;
}

interface MaskedImageInfo {
  token: string;
  markdown: string;
  beforeContext: string;
  afterContext: string;
}

/** Tách và bảo vệ toàn diện các hình ảnh nhúng trước khi gửi cho AI */
function maskImagesForAi(markdown: string): {
  maskedText: string;
  imageMap: Map<string, MaskedImageInfo>;
} {
  const imageMap = new Map<string, MaskedImageInfo>();
  let counter = 0;

  // Bắt mọi định dạng ảnh Markdown ![...](...) và thẻ HTML <img>
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)|<img\b([^>]*?)(?:\/?>|>[\s\S]*?<\/img>)/gi;
  let lastIndex = 0;
  let maskedText = '';
  let match: RegExpExecArray | null;

  while ((match = imageRegex.exec(markdown)) !== null) {
    counter += 1;
    const token = `[[EMBEDDED_IMAGE_TOKEN_${counter}]]`;
    let fullImgMd = match[0];

    // Nếu là tag <img>, chuẩn hóa sang Markdown ![alt](src)
    if (fullImgMd.toLowerCase().startsWith('<img')) {
      const srcMatch = fullImgMd.match(/\bsrc=["']([^"']+)["']/i);
      const altMatch = fullImgMd.match(/\balt=["']([^"']*)["']/i);
      const src = srcMatch ? srcMatch[1] : '';
      const alt = altMatch ? altMatch[1] : 'Hình ảnh';
      if (src) {
        fullImgMd = `![${alt}](${src})`;
      }
    }

    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;

    // Lấy ngữ cảnh 40 ký tự trước và sau để dùng phục hồi khi AI lỡ bỏ quên token
    const beforeContext = markdown
      .slice(Math.max(0, matchStart - 40), matchStart)
      .replace(/\[\[EMBEDDED_IMAGE_TOKEN_\d+\]\]/g, '')
      .trim();
    const afterContext = markdown
      .slice(matchEnd, Math.min(markdown.length, matchEnd + 40))
      .replace(/\[\[EMBEDDED_IMAGE_TOKEN_\d+\]\]/g, '')
      .trim();

    imageMap.set(token, {
      token,
      markdown: fullImgMd,
      beforeContext,
      afterContext,
    });

    maskedText += markdown.slice(lastIndex, matchStart) + token;
    lastIndex = matchEnd;
  }

  maskedText += markdown.slice(lastIndex);
  return { maskedText, imageMap };
}

/** Khôi phục lại dữ liệu hình ảnh nguyên vẹn sau khi AI xử lý xong (kèm Fallback Recovery) */
function unmaskImagesFromAi(
  markdown: string,
  imageMap: Map<string, MaskedImageInfo>,
): string {
  let result = markdown;
  const restoredTokens = new Set<string>();

  // 1. Khôi phục trực tiếp theo các token và mọi biến thể do AI tự ý biến đổi (dấu cách, gạch dưới, thiếu ngoặc...)
  for (const [token, info] of imageMap.entries()) {
    const tokenNum = token.replace(/[^\d]/g, '');
    let found = false;

    // Biểu thức regex siêu linh hoạt nhận diện mọi biến thể:
    // [[EMBEDDED_IMAGE_TOKEN_5]], [[EMBEDDED IMAGE TOKEN 5]], [[IMAGE TOKEN 5]], [[TOKEN 5]], [EMBEDDED IMAGE TOKEN 5], <!--...-->, ...
    const flexRegex = new RegExp(
      `(?:\\\\?\\[|<!--|\\b)(?:\\\\?\\[)?\\s*(?:EMBEDDED[\\s_]*)?(?:IMAGE[\\s_]*)?(?:EMBED[\\s_]*)?TOKEN[\\s_]*${tokenNum}\\s*(?:\\\\?\\])?(?:\\\\?\\]|-->|\\b)`,
      'gi'
    );

    const newResult = result.replace(flexRegex, info.markdown);
    if (newResult !== result) {
      result = newResult;
      found = true;
    } else {
      // Fallback thêm các chuỗi cố định nếu regex bỏ sót
      const fallbackPatterns = [
        `[[EMBEDDED_IMAGE_TOKEN_${tokenNum}]]`,
        `[[EMBEDDED IMAGE TOKEN ${tokenNum}]]`,
        `[[EMBEDDED_IMAGE_TOKEN ${tokenNum}]]`,
        `[[EMBEDDED IMAGE TOKEN_${tokenNum}]]`,
        `\\[\\[EMBEDDED_IMAGE_TOKEN_${tokenNum}\\]\\]`,
        `\\[\\[EMBEDDED IMAGE TOKEN ${tokenNum}\\]\\]`,
        `<!-- IMAGE_EMBED_TOKEN_${tokenNum} -->`,
        `<!--IMAGE_EMBED_TOKEN_${tokenNum}-->`,
        `<!-- EMBEDDED_IMAGE_TOKEN_${tokenNum} -->`,
        `EMBEDDED_IMAGE_TOKEN_${tokenNum}`,
        `EMBEDDED IMAGE TOKEN ${tokenNum}`
      ];
      for (const pattern of fallbackPatterns) {
        if (result.includes(pattern)) {
          result = result.replaceAll(pattern, info.markdown);
          found = true;
        }
      }
    }

    if (found) {
      restoredTokens.add(token);
    }
  }

  // 2. Fallback Recovery: Tự động chèn lại các ảnh bị AI bỏ quên
  for (const [token, info] of imageMap.entries()) {
    if (restoredTokens.has(token)) continue;

    let reinserted = false;
    // Thử tìm theo ngữ cảnh trước ảnh
    if (info.beforeContext && info.beforeContext.length >= 6) {
      const idx = result.indexOf(info.beforeContext);
      if (idx !== -1) {
        const insertPos = idx + info.beforeContext.length;
        result =
          result.slice(0, insertPos) +
          `\n\n${info.markdown}\n\n` +
          result.slice(insertPos);
        reinserted = true;
        restoredTokens.add(token);
      }
    }

    // Nếu chưa chèn được, thử tìm theo ngữ cảnh sau ảnh
    if (!reinserted && info.afterContext && info.afterContext.length >= 6) {
      const idx = result.indexOf(info.afterContext);
      if (idx !== -1) {
        result =
          result.slice(0, idx) +
          `\n\n${info.markdown}\n\n` +
          result.slice(idx);
        reinserted = true;
        restoredTokens.add(token);
      }
    }

    // Nếu vẫn không khớp được ngữ cảnh, chèn vào cuối văn bản để đảm bảo không mất ảnh
    if (!reinserted) {
      result += `\n\n${info.markdown}\n\n`;
      restoredTokens.add(token);
    }
  }

  return result;
}

/**
 * Sử dụng Gemini (3.7 / 3.6 / 3.5) để tự động rà soát, chuẩn hóa ký hiệu toán học
 * và sửa lỗi cú pháp LaTeX trước khi xuất sang Word.
 */
export async function aiOptimizeAndFixLatex(options: AiOptimizeLatexOptions): Promise<string> {
  const allKeys = (
    options.apiKeys && options.apiKeys.length > 0
      ? options.apiKeys
      : parseApiKeys(options.apiKey || '')
  ).map((k) => k.trim()).filter(Boolean);

  if (allKeys.length === 0) throw new Error('Chưa nhập Gemini API key. Hãy vào Cài đặt API & Models để nhập key.');
  if (!options.content.trim()) return options.content;

  const modelToUse = options.model === 'auto' || !options.model ? 'gemini-3.7-flash' : options.model;

  const { maskedText, imageMap } = maskImagesForAi(options.content);

  const prompt = `Bạn là chuyên gia chuẩn hóa tài liệu Toán học và công thức LaTeX để xuất sang Microsoft Word Equation và MathType (chuẩn hóa toàn diện tương tự luồng OCR).
Nhiệm vụ bắt buộc:
1. Rà soát toàn bộ văn bản sau đây, sửa các lỗi cú pháp LaTeX và phục hồi bảng biểu:
   - BẢNG BIỂU (QUAN TRỌNG): Mọi bảng thống kê, bảng điểm, bảng tần số, bảng số liệu, bảng giá trị, bảng phương án hoặc khối LaTeX \\begin{tabular} BẮT BUỘC phải chuyển thành bảng Markdown chuẩn có đầy đủ các cột và hàng (| Cột 1 | Cột 2 |... và hàng phân cách | :---: | :---: |).
     * ĐẶC BIỆT: Nếu trong văn bản có câu hỏi giới thiệu bảng (ví dụ: "...cho bởi bảng sau:") và các dòng số liệu bị dính liền chữ/số (ví dụ: "Điểm (x)025678910CộngTần số (n)125691043N=40"), BẮT BUỘC nhận diện và phục hồi chính xác thành bảng Markdown 2 hàng hoặc nhiều hàng với từng cột tương ứng:
       | Điểm ($x$) | 0 | 2 | 5 | 6 | 7 | 8 | 9 | 10 | Cộng |
       | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
       | Tần số ($n$) | 1 | 2 | 5 | 6 | 9 | 10 | 4 | 3 | $N = 40$ |
   - BẢO TOÀN toàn bộ các thẻ ngắt dòng <br> bên trong các ô bảng, không được xóa <br> hay dồn các dòng trong bảng thành một dòng.
    - HÌNH ẢNH (BẮT BUỘC): BẢO TOÀN NGUYÊN VẸN 100% tất cả các token hình ảnh có dạng [[EMBEDDED_IMAGE_TOKEN_N]] ở đúng vị trí ban đầu (cả trong các ô bảng biểu và ngoài đoạn văn). TUYỆT ĐỐI KHÔNG ĐƯỢC XÓA, KHÔNG BỎ QUÊN, KHÔNG ĐỔI DẤU GẠCH DƯỚI THÀNH DẤU CÁCH.
    - Giữ nguyên toàn bộ nội dung văn bản tiếng Việt, số thứ tự câu hỏi (Câu 1, Câu 2...), các đáp án A/B/C/D, in đậm **...**.
   - KHÔNG tự ý giải đề, không xóa nội dung, không thêm nhận xét ngoài lề.
2. Trả về trực tiếp văn bản Markdown/LaTeX đã hoàn thiện, không bọc trong code fence.

VĂN BẢN GỐC CẦN CHUẨN HÓA:
${maskedText}`;

  let lastError: unknown;

  for (let keyIdx = 0; keyIdx < allKeys.length; keyIdx += 1) {
    const activeKey = allKeys[keyIdx];
    const ai = new GoogleGenAI({ apiKey: activeKey });

    try {
      let fullText = '';
      const stream = await ai.models.generateContentStream({
        model: modelToUse,
        config: { maxOutputTokens: MAX_OUTPUT_TOKENS },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      for await (const chunk of stream) {
        const text = extractResponseText(chunk);
        if (text) {
          fullText += text;
          options.onText?.(unmaskImagesFromAi(fullText, imageMap));
        }
      }

      if (!fullText.trim()) {
        const response = await ai.models.generateContent({
          model: modelToUse,
          config: { maxOutputTokens: MAX_OUTPUT_TOKENS },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        fullText = extractResponseText(response);
      }

      const stripped = stripOuterCodeFence(fullText);
      return unmaskImagesFromAi(stripped, imageMap);
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      if (/429|quota|rate limit|401|403/i.test(msg) && keyIdx < allKeys.length - 1) {
        continue;
      }
      break;
    }
  }

  throw new Error(toReadableApiError(lastError, modelToUse));
}

