import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDF_RENDER_API, isHardcodedApiConfigured } from '../config/apiConfig';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface PdfRenderOptions {
  maxPages: number;
  scale: number;
  jpegQuality?: number;
  onProgress?: (current: number, total: number) => void;
}

export interface RenderedSourcePage {
  pageNumber: number;
  sourceName: string;
  imageDataUrl: string;
}

export interface SmartCropResult {
  dataUrl: string;
  /** Tỉ lệ pixel tối trong vùng ảnh đã chọn. Dùng để phát hiện crop trắng. */
  inkRatio: number;
  /** Cách hiệu chỉnh crop đã dùng, hữu ích khi debug. */
  strategy: string;
  /** true khi phải dùng vùng mở rộng hoặc toàn trang để tránh ảnh trắng. */
  usedFallback: boolean;
}

interface NormalizedBox {
  top: number;
  left: number;
  bottom: number;
  right: number;
  strategy: string;
  penalty?: number;
}

interface BoxScore {
  box: NormalizedBox;
  inkRatio: number;
  averageDarkness: number;
  score: number;
}

const MAX_RENDER_DIMENSION = 3000;
const ANALYSIS_MAX_DIMENSION = 1000;
const MIN_VISIBLE_INK_RATIO = 0.0007;

export function isPdfRenderBackendConfigured(): boolean {
  return isHardcodedApiConfigured(PDF_RENDER_API);
}

export interface BackendCropFigure {
  id: string;
  pageNumber: number;
  description: string;
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

interface BackendCropResponse {
  crops?: Array<{
    id?: string;
    ok?: boolean;
    base64?: string;
    mimeType?: string;
    mime_type?: string;
    error?: string;
  }>;
  detail?: string;
  error?: string;
}

/**
 * Cắt hàng loạt trực tiếp từ PDF/ảnh gốc bằng backend PyMuPDF/Pillow.
 * Backend tự chừa biên theo loại hình (đồ thị, hình học, bảng), vì vậy
 * nhãn điểm, tên trục và nét đứt ít bị lẹm hơn cắt canvas ở trình duyệt.
 */
export async function cropDocumentFiguresWithBackend(
  file: File,
  figures: BackendCropFigure[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!isHardcodedApiConfigured(PDF_RENDER_API) || figures.length === 0) return result;

  const endpoint = /\/api\/(?:crop-document|crop-pdf)$/i.test(PDF_RENDER_API)
    ? PDF_RENDER_API
    : `${PDF_RENDER_API}/api/crop-document`;
  const payload = figures.map((figure) => ({
    id: figure.id,
    page: figure.pageNumber,
    description: figure.description,
    bbox: {
      ymin: Math.round(figure.ymin),
      xmin: Math.round(figure.xmin),
      ymax: Math.round(figure.ymax),
      xmax: Math.round(figure.xmax),
    },
  }));

  const form = new FormData();
  form.append('file', file, file.name);
  form.append('figures', JSON.stringify(payload));
  form.append('scale', '3');
  form.append('safety', '0.01');

  const response = await fetch(endpoint, { method: 'POST', body: form });
  const raw = await response.text();
  let data: BackendCropResponse = {};
  try {
    data = raw ? (JSON.parse(raw) as BackendCropResponse) : {};
  } catch {
    // Giữ raw để báo URL backend/proxy trả HTML.
  }
  if (!response.ok) {
    throw new Error(data.detail || data.error || raw || `Crop API lỗi HTTP ${response.status}.`);
  }

  for (const crop of data.crops ?? []) {
    const id = String(crop.id ?? '').trim();
    const base64 = String(crop.base64 ?? '').trim();
    if (!id || crop.ok === false || !base64) continue;
    const mimeType = crop.mimeType ?? crop.mime_type ?? 'image/png';
    result.set(id, `data:${mimeType};base64,${base64}`);
  }
  return result;
}

interface PdfRenderBackendResponse {
  pages?: Array<{
    pageNumber?: number;
    page_number?: number;
    imageDataUrl?: string;
    image_data_url?: string;
    base64?: string;
    mimeType?: string;
    mime_type?: string;
  }>;
  error?: string;
}

/**
 * Render PDF theo thứ tự ưu tiên:
 * 1. Backend PyMuPDF nếu URL hardcode đã được cấu hình.
 * 2. PDF.js trong trình duyệt làm phương án dự phòng.
 *
 * Backend có thể cấu hình bằng URL gốc hoặc URL đầy đủ /api/render-pdf.
 */
export async function renderPdfToImages(
  file: File,
  options: PdfRenderOptions,
): Promise<RenderedSourcePage[]> {
  let backendError = '';

  if (isHardcodedApiConfigured(PDF_RENDER_API)) {
    try {
      return await renderPdfWithBackend(file, options);
    } catch (error) {
      backendError = error instanceof Error ? error.message : String(error);
      console.warn('Backend PyMuPDF không render được PDF, chuyển sang PDF.js:', error);
    }
  }

  try {
    return await renderPdfWithPdfJs(file, options);
  } catch (error) {
    const browserError = error instanceof Error ? error.message : String(error);
    if (isHardcodedApiConfigured(PDF_RENDER_API)) {
      throw new Error(
        `Không render được PDF bằng cả backend PyMuPDF và PDF.js. ` +
          `Backend: ${backendError}. Trình duyệt: ${browserError}`,
      );
    }

    throw new Error(
      `${browserError} Chưa hardcode URL PDF Render API thật trong src/config/apiConfig.ts, vì vậy ứng dụng không có ` +
        'backend PyMuPDF để lấy ảnh thật từ PDF này.',
    );
  }
}

async function renderPdfWithBackend(
  file: File,
  options: PdfRenderOptions,
): Promise<RenderedSourcePage[]> {
  const endpoint = /\/api\/render-pdf$/i.test(PDF_RENDER_API)
    ? PDF_RENDER_API
    : `${PDF_RENDER_API}/api/render-pdf`;
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('max_pages', String(Math.max(1, Math.round(options.maxPages))));
  form.append('scale', String(Math.max(1, Math.min(options.scale, 3))));

  const response = await fetch(endpoint, {
    method: 'POST',
    body: form,
  });

  const rawText = await response.text();
  let payload: PdfRenderBackendResponse = {};
  try {
    payload = rawText ? (JSON.parse(rawText) as PdfRenderBackendResponse) : {};
  } catch {
    // Báo nguyên văn phản hồi để dễ phát hiện URL sai hoặc proxy trả HTML.
  }

  if (!response.ok) {
    throw new Error(
      payload.error || rawText || `PDF Render API lỗi HTTP ${response.status}.`,
    );
  }

  const sourcePages = Array.isArray(payload.pages) ? payload.pages : [];
  if (sourcePages.length === 0) {
    throw new Error('PDF Render API không trả về ảnh trang nào.');
  }

  const pages = sourcePages.map((page, index) => {
    const pageNumber = Math.max(
      1,
      Math.round(Number(page.pageNumber ?? page.page_number ?? index + 1)),
    );
    const mimeType = page.mimeType ?? page.mime_type ?? 'image/png';
    const imageDataUrl =
      page.imageDataUrl ??
      page.image_data_url ??
      (page.base64 ? `data:${mimeType};base64,${page.base64}` : '');

    if (!/^data:image\//i.test(imageDataUrl)) {
      throw new Error(`PDF Render API trả ảnh trang ${pageNumber} không hợp lệ.`);
    }

    return {
      pageNumber,
      sourceName: file.name,
      imageDataUrl,
    } satisfies RenderedSourcePage;
  });

  pages.sort((a, b) => a.pageNumber - b.pageNumber);
  pages.forEach((_, index) => options.onProgress?.(index + 1, pages.length));
  return pages;
}

async function renderPdfWithPdfJs(
  file: File,
  options: PdfRenderOptions,
): Promise<RenderedSourcePage[]> {
  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const total = Math.min(pdf.numPages, Math.max(1, options.maxPages));
  const pages: RenderedSourcePage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const requestedScale = Math.max(1, Math.min(options.scale, 3));
      const longestAtRequestedScale =
        Math.max(baseViewport.width, baseViewport.height) * requestedScale;
      const safeScale =
        longestAtRequestedScale > MAX_RENDER_DIMENSION
          ? requestedScale * (MAX_RENDER_DIMENSION / longestAtRequestedScale)
          : requestedScale;
      const viewport = page.getViewport({ scale: safeScale });

      // PDF.js 5 khuyến nghị truyền trực tiếp `canvas`. Không truyền đồng thời
      // `canvas` và `canvasContext`, vì một số bản trình duyệt có thể hoàn tất
      // render nhưng để lại canvas trắng.
      let canvas = createWhiteCanvas(viewport.width, viewport.height);
      await page.render({
        canvas,
        viewport,
        intent: 'display',
        background: 'rgb(255,255,255)',
      } as never).promise;

      let inkRatio = getCanvasInkRatio(canvas);

      // Retry bằng API canvasContext tương thích cũ nếu lần đầu vẫn trắng.
      if (inkRatio < MIN_RENDERED_PAGE_INK_RATIO) {
        canvas = createWhiteCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d', {
          alpha: false,
          willReadFrequently: true,
        });
        if (!context) throw new Error(`Không tạo được canvas cho trang ${pageNumber}.`);

        await page.render({
          canvas: null,
          canvasContext: context,
          viewport,
          intent: 'print',
          background: 'rgb(255,255,255)',
        } as never).promise;
        inkRatio = getCanvasInkRatio(canvas);
      }

      // Nhiều PDF scan lưu mỗi trang dưới dạng một ảnh raster XObject. Có trường
      // hợp canvas render trắng dù dữ liệu ảnh bên trong PDF vẫn đọc được. Khi đó
      // lấy trực tiếp ảnh raster lớn nhất của trang làm phương án dự phòng.
      if (inkRatio < MIN_RENDERED_PAGE_INK_RATIO) {
        const embedded = await extractLargestEmbeddedRaster(page);
        if (embedded) {
          canvas = embedded;
          inkRatio = getCanvasInkRatio(canvas);
        }
      }

      if (inkRatio < MIN_RENDERED_PAGE_INK_RATIO) {
        throw new Error(
          `Trang ${pageNumber} không tạo được ảnh xem trước. ` +
            'Ứng dụng đã thử display, print và trích ảnh raster nhúng trong PDF. ' +
            'Lỗi này chỉ ảnh hưởng cắt hình; chế độ Gemini vẫn phải OCR trực tiếp từ PDF gốc.',
        );
      }

      // PNG giữ nét mảnh, đồ thị và ký hiệu hình học tốt hơn JPEG.
      pages.push({
        pageNumber,
        sourceName: file.name,
        imageDataUrl: canvas.toDataURL('image/png'),
      });
      options.onProgress?.(pageNumber, total);
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }

  return pages;
}

const MIN_RENDERED_PAGE_INK_RATIO = 0.00015;

function createWhiteCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Không tạo được canvas để render PDF.');
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
  return canvas;
}

function getCanvasInkRatio(canvas: HTMLCanvasElement): number {
  const maxDimension = 700;
  const scale = Math.min(1, maxDimension / Math.max(canvas.width, canvas.height));
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const sample = document.createElement('canvas');
  sample.width = width;
  sample.height = height;
  const context = sample.getContext('2d', {
    alpha: false,
    willReadFrequently: true,
  });
  if (!context) return 0;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(canvas, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  let ink = 0;
  const total = width * height;

  for (let index = 0; index < pixels.length; index += 4) {
    const luminance =
      pixels[index] * 0.2126 +
      pixels[index + 1] * 0.7152 +
      pixels[index + 2] * 0.0722;
    if (luminance < 246) ink += 1;
  }
  return ink / Math.max(1, total);
}


async function extractLargestEmbeddedRaster(page: unknown): Promise<HTMLCanvasElement | null> {
  const pageAny = page as {
    getOperatorList?: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
    objs?: { get: (id: string, callback?: (value: unknown) => void) => unknown };
  };
  if (!pageAny.getOperatorList) return null;

  try {
    const operatorList = await pageAny.getOperatorList();
    const candidates: unknown[] = [];
    const seen = new Set<string>();
    const ops = pdfjsLib.OPS as Record<string, number>;

    for (let index = 0; index < operatorList.fnArray.length; index += 1) {
      const fn = operatorList.fnArray[index];
      const args = operatorList.argsArray[index] ?? [];

      if (
        fn === ops.paintInlineImageXObject ||
        fn === ops.paintInlineImageXObjectGroup
      ) {
        if (args[0]) candidates.push(args[0]);
        continue;
      }

      if (
        fn === ops.paintImageXObject ||
        fn === ops.paintImageXObjectRepeat
      ) {
        const objectId = String(args[0] ?? '');
        if (!objectId || seen.has(objectId) || !pageAny.objs) continue;
        seen.add(objectId);
        const value = await resolvePdfObject(pageAny.objs, objectId);
        if (value) candidates.push(value);
      }
    }

    let best: { canvas: HTMLCanvasElement; area: number; inkRatio: number } | null = null;
    for (const candidate of candidates) {
      const canvas = imageObjectToCanvas(candidate);
      if (!canvas) continue;
      const area = canvas.width * canvas.height;
      if (area < 10_000) continue;
      const inkRatio = getCanvasInkRatio(canvas);
      if (inkRatio < MIN_RENDERED_PAGE_INK_RATIO) continue;
      if (!best || area > best.area) best = { canvas, area, inkRatio };
    }

    return best ? constrainCanvasSize(best.canvas, MAX_RENDER_DIMENSION) : null;
  } catch (error) {
    console.warn('Không trích được ảnh raster nhúng trong PDF:', error);
    return null;
  }
}

function resolvePdfObject(
  objects: { get: (id: string, callback?: (value: unknown) => void) => unknown },
  objectId: string,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: unknown | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const immediate = objects.get(objectId, (value) => finish(value));
      if (immediate) finish(immediate);
    } catch {
      try {
        const immediate = objects.get(objectId);
        finish(immediate ?? null);
      } catch {
        // getOperatorList thường đã kích hoạt tải object. Chờ callback ngắn trước
        // khi bỏ qua để tránh treo giao diện trên PDF lỗi.
      }
    }

    window.setTimeout(() => finish(null), 2500);
  });
}

function imageObjectToCanvas(value: unknown): HTMLCanvasElement | null {
  if (!value || typeof value !== 'object') return null;
  const image = value as {
    width?: number;
    height?: number;
    bitmap?: CanvasImageSource;
    data?: Uint8Array | Uint8ClampedArray;
    kind?: number;
  };
  const width = Math.max(1, Math.round(Number(image.width) || 0));
  const height = Math.max(1, Math.round(Number(image.height) || 0));
  if (!width || !height) return null;

  const canvas = createWhiteCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) return null;

  try {
    if (image.bitmap) {
      context.drawImage(image.bitmap, 0, 0, width, height);
      return canvas;
    }

    if (!image.data) return null;
    const source = image.data;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const kinds = pdfjsLib.ImageKind as Record<string, number>;

    if (image.kind === kinds.RGBA_32BPP || source.length >= width * height * 4) {
      rgba.set(source.subarray(0, rgba.length));
    } else if (image.kind === kinds.RGB_24BPP || source.length >= width * height * 3) {
      let src = 0;
      let dest = 0;
      const pixelCount = width * height;
      for (let index = 0; index < pixelCount; index += 1) {
        rgba[dest++] = source[src++];
        rgba[dest++] = source[src++];
        rgba[dest++] = source[src++];
        rgba[dest++] = 255;
      }
    } else if (image.kind === kinds.GRAYSCALE_1BPP) {
      const rowBytes = (width + 7) >> 3;
      let dest = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const byte = source[y * rowBytes + (x >> 3)] ?? 0;
          const white = (byte & (128 >> (x & 7))) !== 0;
          const level = white ? 255 : 0;
          rgba[dest++] = level;
          rgba[dest++] = level;
          rgba[dest++] = level;
          rgba[dest++] = 255;
        }
      }
    } else {
      return null;
    }

    context.putImageData(new ImageData(rgba, width, height), 0, 0);
    return canvas;
  } catch (error) {
    console.warn('Không chuyển được PDF image object thành canvas:', error);
    return null;
  }
}

function constrainCanvasSize(canvas: HTMLCanvasElement, maxDimension: number): HTMLCanvasElement {
  const longest = Math.max(canvas.width, canvas.height);
  if (longest <= maxDimension) return canvas;
  const scale = maxDimension / longest;
  const output = createWhiteCanvas(canvas.width * scale, canvas.height * scale);
  const context = output.getContext('2d', { alpha: false });
  if (!context) return canvas;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, output.width, output.height);
  return output;
}

export async function imageFilesToPages(files: File[]): Promise<RenderedSourcePage[]> {
  const pages: RenderedSourcePage[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    pages.push({
      pageNumber: index + 1,
      sourceName: file.name,
      imageDataUrl: await fileToDataUrl(file),
    });
  }
  return pages;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Không đọc được file ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/**
 * Crop đơn giản theo tọa độ chuẩn hóa 0..1.
 * Giữ lại để tương thích với mã cũ.
 */
export async function cropImageDataUrl(
  sourceDataUrl: string,
  top: number,
  left: number,
  bottom: number,
  right: number,
): Promise<string> {
  const image = await loadImage(sourceDataUrl);
  const box = normalizeBox({ top, left, bottom, right, strategy: 'direct' });
  return cropBoxToDataUrl(image, box);
}

/**
 * Crop chính xác cho bbox đã được Gemini định vị lần 2 trên ảnh trang PNG.
 * Chỉ nới đều quanh đúng tâm bbox; tuyệt đối không tịnh tiến sang vùng khác.
 */
export async function cropImageDataUrlPrecise(
  sourceDataUrl: string,
  top: number,
  left: number,
  bottom: number,
  right: number,
): Promise<SmartCropResult> {
  const image = await loadImage(sourceDataUrl);
  const analyzer = buildImageAnalyzer(image);
  const direct = normalizeBox({
    top,
    left,
    bottom,
    right,
    strategy: 'gemini-second-pass',
  });

  if (direct.bottom - direct.top < 0.01 || direct.right - direct.left < 0.01) {
    throw new Error('Vùng hình Gemini định vị quá nhỏ.');
  }

  // Nới 4% kích thước hộp để giữ nhãn điểm. Chỉ tăng lên 8%/12% khi vùng
  // ban đầu gần như trắng; không bao giờ dịch hộp sang bảng hay hình lân cận.
  const paddingRatios = [0.04, 0.08, 0.12];
  let selected: BoxScore | null = null;
  let usedFallback = false;

  for (let index = 0; index < paddingRatios.length; index += 1) {
    const ratio = paddingRatios[index];
    const candidate = expandBoxRelative(
      direct,
      ratio,
      `gemini-second-pass; padding=${Math.round(ratio * 100)}%`,
    );
    const scored = analyzer.score(candidate);
    selected = scored;
    if (scored.inkRatio >= MIN_VISIBLE_INK_RATIO) {
      usedFallback = index > 0;
      break;
    }
  }

  if (!selected || selected.inkRatio < MIN_VISIBLE_INK_RATIO) {
    throw new Error('Vùng hình được định vị gần như trắng; không tự chuyển sang vùng khác.');
  }

  return {
    dataUrl: await cropBoxToDataUrl(image, selected.box, true),
    inkRatio: selected.inkRatio,
    strategy: selected.box.strategy,
    usedFallback,
  };
}

function expandBoxRelative(
  box: NormalizedBox,
  ratio: number,
  strategy: string,
): NormalizedBox {
  const width = Math.max(0.01, box.right - box.left);
  const height = Math.max(0.01, box.bottom - box.top);
  return normalizeBox({
    top: box.top - height * ratio,
    left: box.left - width * ratio,
    bottom: box.bottom + height * ratio,
    right: box.right + width * ratio,
    strategy,
    penalty: box.penalty,
  });
}

/**
 * Crop thông minh dành cho marker do AI sinh ra.
 *
 * Vấn đề của bản cũ: Gemini có thể trả tọa độ theo nhiều quy ước khác nhau
 * (y,x hoặc x,y; gốc trên/dưới; trang xoay). Khi crop nhầm vùng trắng, Pandoc
 * vẫn nhúng một PNG hợp lệ nên Word chỉ hiện một khoảng trắng lớn.
 *
 * Hàm này thử nhiều cách diễn giải tọa độ, tự chấm điểm lượng "mực" trong ảnh,
 * mở rộng/tịnh tiến nhẹ khi cần và chỉ dùng toàn trang như phương án cuối cùng.
 */
export async function cropImageDataUrlSmart(
  sourceDataUrl: string,
  top: number,
  left: number,
  bottom: number,
  right: number,
): Promise<SmartCropResult> {
  const image = await loadImage(sourceDataUrl);
  const analyzer = buildImageAnalyzer(image);

  const baseBoxes = buildCoordinateCandidates(top, left, bottom, right);
  const scored: BoxScore[] = [];

  for (const base of baseBoxes) {
    const baseWidth = Math.max(0.015, base.right - base.left);
    const baseHeight = Math.max(0.015, base.bottom - base.top);
    const shifts = [-0.35, 0, 0.35];
    const scales = [1, 1.18, 1.45, 1.9];

    for (const scale of scales) {
      for (const shiftX of shifts) {
        for (const shiftY of shifts) {
          const candidate = resizeAndShiftBox(
            base,
            scale,
            shiftX * baseWidth,
            shiftY * baseHeight,
            `${base.strategy}; scale=${scale}; dx=${shiftX}; dy=${shiftY}`,
          );
          const result = analyzer.score(candidate);
          const distancePenalty =
            Math.abs(shiftX) * 0.00012 +
            Math.abs(shiftY) * 0.00012 +
            Math.max(0, scale - 1) * 0.00008 +
            (candidate.penalty ?? 0);
          scored.push({ ...result, score: result.score - distancePenalty });
        }
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  let best = scored[0];
  let usedFallback = false;

  // Nếu mọi crop gần marker đều gần như trắng, tìm rộng hơn quanh vùng dự đoán.
  if (!best || best.inkRatio < MIN_VISIBLE_INK_RATIO) {
    usedFallback = true;
    const broadCandidates: BoxScore[] = [];
    for (const base of baseBoxes.slice(0, 4)) {
      const baseWidth = Math.max(0.06, base.right - base.left);
      const baseHeight = Math.max(0.06, base.bottom - base.top);
      const shifts = [-1.25, -0.75, -0.35, 0, 0.35, 0.75, 1.25];
      const scales = [2.2, 3, 4.2];

      for (const scale of scales) {
        for (const shiftX of shifts) {
          for (const shiftY of shifts) {
            const candidate = resizeAndShiftBox(
              base,
              scale,
              shiftX * baseWidth,
              shiftY * baseHeight,
              `${base.strategy}; broad scale=${scale}; dx=${shiftX}; dy=${shiftY}`,
            );
            const result = analyzer.score(candidate);
            const distancePenalty =
              (Math.abs(shiftX) + Math.abs(shiftY)) * 0.00006 +
              Math.max(0, scale - 2) * 0.00004 +
              (candidate.penalty ?? 0);
            broadCandidates.push({ ...result, score: result.score - distancePenalty });
          }
        }
      }
    }

    broadCandidates.sort((a, b) => b.score - a.score);
    if (broadCandidates[0] && (!best || broadCandidates[0].score > best.score)) {
      best = broadCandidates[0];
    }
  }

  // Phương án cuối: nhúng toàn bộ trang. Không hoàn hảo nhưng tuyệt đối không
  // sinh PNG trắng, và người dùng vẫn nhìn thấy hình gốc trong Word.
  if (!best || best.inkRatio < MIN_VISIBLE_INK_RATIO) {
    usedFallback = true;
    const fullPage = normalizeBox({
      top: 0,
      left: 0,
      bottom: 1,
      right: 1,
      strategy: 'fallback-full-page',
      penalty: 0,
    });
    best = analyzer.score(fullPage);
  }

  const padded = addPadding(best.box, 0.012);
  const dataUrl = await cropBoxToDataUrl(image, padded, true);

  return {
    dataUrl,
    inkRatio: best.inkRatio,
    strategy: best.box.strategy,
    usedFallback,
  };
}

function buildCoordinateCandidates(
  top: number,
  left: number,
  bottom: number,
  right: number,
): NormalizedBox[] {
  const direct = normalizeBox({ top, left, bottom, right, strategy: 'y-x-y-x' });
  const swapped = normalizeBox({
    top: left,
    left: top,
    bottom: right,
    right: bottom,
    strategy: 'x-y-x-y',
    penalty: 0.00008,
  });

  const variants: NormalizedBox[] = [
    direct,
    swapped,
    flipY(direct, 'flip-y'),
    flipX(direct, 'flip-x'),
    rotate180(direct, 'rotate-180'),
    rotate90(direct, 'rotate-90'),
    rotate270(direct, 'rotate-270'),
    flipY(swapped, 'swap+flip-y'),
    rotate90(swapped, 'swap+rotate-90'),
    rotate270(swapped, 'swap+rotate-270'),
  ];

  const seen = new Set<string>();
  return variants.filter((box) => {
    const key = [box.top, box.left, box.bottom, box.right]
      .map((value) => value.toFixed(4))
      .join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return box.bottom - box.top >= 0.005 && box.right - box.left >= 0.005;
  });
}

function normalizeBox(box: NormalizedBox): NormalizedBox {
  const top = clamp(Math.min(box.top, box.bottom), 0, 1);
  const bottom = clamp(Math.max(box.top, box.bottom), 0, 1);
  const left = clamp(Math.min(box.left, box.right), 0, 1);
  const right = clamp(Math.max(box.left, box.right), 0, 1);
  return { ...box, top, left, bottom, right };
}

function flipY(box: NormalizedBox, strategy: string): NormalizedBox {
  return normalizeBox({
    top: 1 - box.bottom,
    left: box.left,
    bottom: 1 - box.top,
    right: box.right,
    strategy,
    penalty: 0.00012,
  });
}

function flipX(box: NormalizedBox, strategy: string): NormalizedBox {
  return normalizeBox({
    top: box.top,
    left: 1 - box.right,
    bottom: box.bottom,
    right: 1 - box.left,
    strategy,
    penalty: 0.00012,
  });
}

function rotate180(box: NormalizedBox, strategy: string): NormalizedBox {
  return normalizeBox({
    top: 1 - box.bottom,
    left: 1 - box.right,
    bottom: 1 - box.top,
    right: 1 - box.left,
    strategy,
    penalty: 0.00014,
  });
}

function rotate90(box: NormalizedBox, strategy: string): NormalizedBox {
  return normalizeBox({
    top: box.left,
    left: 1 - box.bottom,
    bottom: box.right,
    right: 1 - box.top,
    strategy,
    penalty: 0.00018,
  });
}

function rotate270(box: NormalizedBox, strategy: string): NormalizedBox {
  return normalizeBox({
    top: 1 - box.right,
    left: box.top,
    bottom: 1 - box.left,
    right: box.bottom,
    strategy,
    penalty: 0.00018,
  });
}

function resizeAndShiftBox(
  box: NormalizedBox,
  scale: number,
  shiftX: number,
  shiftY: number,
  strategy: string,
): NormalizedBox {
  const centerX = (box.left + box.right) / 2 + shiftX;
  const centerY = (box.top + box.bottom) / 2 + shiftY;
  const width = Math.min(1, Math.max(0.02, (box.right - box.left) * scale));
  const height = Math.min(1, Math.max(0.02, (box.bottom - box.top) * scale));

  let left = centerX - width / 2;
  let right = centerX + width / 2;
  let top = centerY - height / 2;
  let bottom = centerY + height / 2;

  if (left < 0) {
    right -= left;
    left = 0;
  }
  if (right > 1) {
    left -= right - 1;
    right = 1;
  }
  if (top < 0) {
    bottom -= top;
    top = 0;
  }
  if (bottom > 1) {
    top -= bottom - 1;
    bottom = 1;
  }

  return normalizeBox({
    top,
    left,
    bottom,
    right,
    strategy,
    penalty: box.penalty,
  });
}

function addPadding(box: NormalizedBox, padding: number): NormalizedBox {
  return normalizeBox({
    top: box.top - padding,
    left: box.left - padding,
    bottom: box.bottom + padding,
    right: box.right + padding,
    strategy: box.strategy,
    penalty: box.penalty,
  });
}

function buildImageAnalyzer(image: HTMLImageElement) {
  const scale = Math.min(
    1,
    ANALYSIS_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) throw new Error('Không tạo được canvas phân tích vùng ảnh.');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;

  const stride = width + 1;
  const darkIntegral = new Float64Array((width + 1) * (height + 1));
  const inkIntegral = new Uint32Array((width + 1) * (height + 1));

  for (let y = 1; y <= height; y += 1) {
    let rowDark = 0;
    let rowInk = 0;
    for (let x = 1; x <= width; x += 1) {
      const index = ((y - 1) * width + (x - 1)) * 4;
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const darkness = Math.max(0, 248 - luminance);
      const ink = luminance < 238 ? 1 : 0;
      rowDark += darkness;
      rowInk += ink;
      const target = y * stride + x;
      darkIntegral[target] = darkIntegral[target - stride] + rowDark;
      inkIntegral[target] = inkIntegral[target - stride] + rowInk;
    }
  }

  function sumRegion(
    integral: Float64Array | Uint32Array,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): number {
    const a = y1 * stride + x1;
    const b = y1 * stride + x2;
    const c = y2 * stride + x1;
    const d = y2 * stride + x2;
    return integral[d] - integral[b] - integral[c] + integral[a];
  }

  return {
    score(box: NormalizedBox): BoxScore {
      const x1 = clamp(Math.floor(box.left * width), 0, width - 1);
      const y1 = clamp(Math.floor(box.top * height), 0, height - 1);
      const x2 = clamp(Math.ceil(box.right * width), x1 + 1, width);
      const y2 = clamp(Math.ceil(box.bottom * height), y1 + 1, height);
      const area = Math.max(1, (x2 - x1) * (y2 - y1));
      const dark = sumRegion(darkIntegral, x1, y1, x2, y2);
      const ink = sumRegion(inkIntegral, x1, y1, x2, y2);
      const inkRatio = ink / area;
      const averageDarkness = dark / (area * 248);

      // Tỉ lệ mực là tín hiệu chính; độ tối trung bình giúp nhận ra nét mảnh.
      const score = inkRatio * 0.82 + averageDarkness * 0.18;
      return { box, inkRatio, averageDarkness, score };
    },
  };
}

async function cropBoxToDataUrl(
  image: HTMLImageElement,
  box: NormalizedBox,
  trimWhiteEdges = false,
): Promise<string> {
  const sourceX = Math.round(box.left * image.naturalWidth);
  const sourceY = Math.round(box.top * image.naturalHeight);
  const sourceWidth = Math.max(1, Math.round((box.right - box.left) * image.naturalWidth));
  const sourceHeight = Math.max(1, Math.round((box.bottom - box.top) * image.naturalHeight));

  if (sourceWidth < 12 || sourceHeight < 12) {
    throw new Error('Vùng ảnh AI trả về quá nhỏ.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: trimWhiteEdges });
  if (!context) throw new Error('Không tạo được canvas cắt ảnh.');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, sourceWidth, sourceHeight);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );

  if (!trimWhiteEdges) return canvas.toDataURL('image/png');

  const trimmed = trimCanvasWhiteMargins(canvas, 14);
  return trimmed.toDataURL('image/png');
}

function trimCanvasWhiteMargins(source: HTMLCanvasElement, padding: number): HTMLCanvasElement {
  const context = source.getContext('2d', { willReadFrequently: true });
  if (!context) return source;
  const { width, height } = source;
  const data = context.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  // Bước nhảy 1 để không bỏ sót nét hình mảnh.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const luminance =
        data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
      if (luminance < 244) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return source;

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);

  const targetWidth = Math.max(1, maxX - minX + 1);
  const targetHeight = Math.max(1, maxY - minY + 1);

  // Nếu việc trim gần như không thay đổi gì thì giữ canvas cũ.
  if (targetWidth > width * 0.97 && targetHeight > height * 0.97) return source;

  const target = document.createElement('canvas');
  target.width = targetWidth;
  target.height = targetHeight;
  const targetContext = target.getContext('2d', { alpha: false });
  if (!targetContext) return source;
  targetContext.fillStyle = '#ffffff';
  targetContext.fillRect(0, 0, targetWidth, targetHeight);
  targetContext.drawImage(
    source,
    minX,
    minY,
    targetWidth,
    targetHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  );
  return target;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Không tải được ảnh để cắt.'));
    image.src = dataUrl;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
