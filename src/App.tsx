import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  AlertCircle,
  AlertTriangle,
  Award,
  Braces,
  CheckCircle2,
  Clipboard,
  Copy,
  Cpu,
  Crown,
  Download,
  FileEdit,
  FileImage,
  FileText,
  FileUp,
  Gift,
  Images,
  Info,
  KeyRound,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  ScanText,
  Settings,
  Settings2,
  Sigma,
  Sparkles,
  Table2,
  Trash2,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';
import { ApiSettingsModal } from './components/ApiSettingsModal';
import { ExportMenu } from './components/ExportMenu';
import { LatexDirectConverter } from './components/LatexDirectConverter';
import { LicenseModal } from './components/LicenseModal';
import { MarkdownPreview } from './components/MarkdownPreview';
import {
  hasDocumentImageMarkers,
  processOriginalDocument,
  refineDocumentImageMarkers,
  replaceDocumentImageMarkers,
  replaceUnresolvedImageMarkers,
} from './services/aiService';
import { parseApiKeys } from './services/apiHealthService';
import { consumeDownloadQuota, getLicenseStatus } from './services/licenseClient';
import type { LicenseStatus } from './services/licenseEngine';
import {
  countEmbeddedImages,
  countMathExpressions,
  downloadText,
  normalizeAiMarkdown,
  safeBaseName,
  splitMarkdownByPage,
} from './services/content';
import {
  imageFilesToPages,
  isPdfRenderBackendConfigured,
  renderPdfToImages,
} from './services/pdfUtils';
import type { AppMode, GeminiModel, MathSolverModel, OcrEngine, OcrPage } from './types';

const API_KEY_STORAGE = 'aiomt_ocr_gemini_api_key';
const API_KEYS_STORAGE = 'aiomt_ocr_gemini_api_keys';
const SETTINGS_STORAGE = 'aiomt_ocr_settings_v1';
const MAX_IMAGE_FILES = 30;

type Notice = { kind: 'success' | 'error' | 'info'; text: string } | null;
type WorkspaceTab = 'result' | 'pages';
type ResultView = 'split' | 'editor' | 'preview';

interface StoredSettings {
  engine?: OcrEngine;
  geminiModel?: GeminiModel;
  mathModel?: MathSolverModel;
  maxPages?: number;
  renderScale?: number;
  customPrompt?: string;
}

const GEMINI_MODELS: Array<{ id: GeminiModel; label: string; hint: string }> = [
  {
    id: 'gemini-3.7-flash',
    label: '🌟 Gemini 3.7 Flash (Mới Nhất 2026 / Siêu Nhanh)',
    hint: 'Thế hệ 3.7 mới nhất, tối ưu nhận diện công thức Toán và bố cục phức tạp',
  },
  {
    id: 'gemini-3.6-flash',
    label: '💥 Gemini 3.6 Flash (Mới ra mắt)',
    hint: 'Ưu tiên chất lượng OCR và độ chính xác cao',
  },
  {
    id: 'gemini-3.5-flash',
    label: '🌟 Gemini 3.5 Flash',
    hint: 'Chất lượng OCR cao và phân tích hình ảnh tốt',
  },
  {
    id: 'gemini-3.0-flash',
    label: '🚀 Gemini 3.0 Flash (Thế hệ 3.0)',
    hint: 'Tốc độ nhanh, phù hợp đa số tài liệu',
  },
  {
    id: 'gemini-3.1-flash-lite',
    label: '⚡ Gemini 3.1 Flash-Lite (Quota cao)',
    hint: 'Nhanh, tiết kiệm cho tài liệu nhiều trang',
  },
  {
    id: 'gemini-2.0-flash',
    label: '💎 Gemini 2.0 Flash (Ổn định, Đọc toán tốt)',
    hint: 'Model ổn định lâu năm, nhận diện LaTeX xuất sắc',
  },
  {
    id: 'gemini-1.5-flash',
    label: '🔷 Gemini 1.5 Flash (Chuẩn Google)',
    hint: 'Model kinh điển tốc độ cao',
  },
  {
    id: 'gemini-1.5-pro',
    label: '🧠 Gemini 1.5 Pro (Đọc đề chữ mờ / khó)',
    hint: 'Đọc kỹ, phù hợp bản scan mờ hoặc chữ viết tay',
  },
  {
    id: 'auto',
    label: '🔄 Tự động xoay vòng Model (Auto Fallback)',
    hint: 'Tự động thử lần lượt Gemini 3.7 → 3.5 → 3.0 → 2.0 khi gặp lỗi',
  },
];

export default function App() {
  const stored = useMemo(readStoredSettings, []);
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [pages, setPages] = useState<OcrPage[]>([]);
  const [content, setContent] = useState('');
  const [baseName, setBaseName] = useState('tai_lieu_ocr');

  const [rawApiKeyText, setRawApiKeyText] = useState(
    () => localStorage.getItem(API_KEYS_STORAGE) ?? localStorage.getItem(API_KEY_STORAGE) ?? '',
  );
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>('ocr');

  const [engine, setEngine] = useState<OcrEngine>(stored.engine ?? 'gemini');
  const [geminiModel, setGeminiModel] = useState<GeminiModel>(
    stored.geminiModel ?? 'gemini-3.7-flash',
  );
  const [mathModel, setMathModel] = useState<MathSolverModel>(
    stored.mathModel ?? 'gemini-3.7-flash',
  );

  const [maxPages, setMaxPages] = useState(stored.maxPages ?? 30);
  const [renderScale, setRenderScale] = useState(stored.renderScale ?? 2);
  const [customPrompt, setCustomPrompt] = useState(stored.customPrompt ?? '');
  const [isProcessing, setIsProcessing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, text: '' });
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('result');
  const [resultView, setResultView] = useState<ResultView>('split');
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);

  // License & Trial state
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [isLicenseModalOpen, setIsLicenseModalOpen] = useState(false);

  // Nạp trạng thái bản quyền từ Local Node Vault khi khởi động
  useEffect(() => {
    getLicenseStatus()
      .then((st) => setLicenseStatus(st))
      .catch((err) => console.error('Không tải được license status:', err));
  }, []);

  // Hàm kiểm tra và trừ 1 lượt tải file (áp dụng cho mọi định dạng)
  const handleRequireDownloadQuota = useCallback(
    async (formatName: string): Promise<boolean> => {
      try {
        const res = await consumeDownloadQuota(formatName);
        if (res.allowed) {
          const latest = await getLicenseStatus();
          setLicenseStatus(latest);
          if (!latest.isActivated && typeof res.remaining === 'number') {
            setNotice({
              kind: 'info',
              text: `Đã dùng 1 lượt tải (${formatName}). Bạn còn ${res.remaining}/${latest.trialMax} lượt dùng thử.`,
            });
          }
          return true;
        } else {
          const latest = await getLicenseStatus();
          setLicenseStatus(latest);
          setIsLicenseModalOpen(true);
          setNotice({
            kind: 'error',
            text:
              res.message ||
              'Bạn đã hết 5 lượt dùng thử. Vui lòng kích hoạt bản quyền để tiếp tục tải file.',
          });
          return false;
        }
      } catch (error) {
        console.error('Lỗi khi kiểm tra bản quyền tải file:', error);
        return true;
      }
    },
    [],
  );

  const apiKeys = useMemo(() => parseApiKeys(rawApiKeyText), [rawApiKeyText]);

  useEffect(() => {
    const value: StoredSettings = {
      engine,
      geminiModel,
      mathModel,
      maxPages,
      renderScale,
      customPrompt,
    };
    localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(value));
  }, [engine, geminiModel, mathModel, maxPages, renderScale, customPrompt]);

  function handleSaveApiSettings(
    newKeysText: string,
    newGeminiModel: GeminiModel,
    newMathModel: MathSolverModel,
  ) {
    setRawApiKeyText(newKeysText);
    setGeminiModel(newGeminiModel);
    setMathModel(newMathModel);

    localStorage.setItem(API_KEYS_STORAGE, newKeysText);
    const parsed = parseApiKeys(newKeysText);
    if (parsed[0]) {
      localStorage.setItem(API_KEY_STORAGE, parsed[0]);
    } else {
      localStorage.removeItem(API_KEY_STORAGE);
      localStorage.removeItem(API_KEYS_STORAGE);
    }

    setNotice({
      kind: 'success',
      text: `Đã lưu cài đặt API & Models (${parsed.length} key). Model OCR: ${newGeminiModel} | Giải toán: ${newMathModel}`,
    });
  }

  const setIncomingFiles = useCallback((incoming: File[]) => {
    const valid = incoming.filter(
      (file) => file.type === 'application/pdf' || file.type.startsWith('image/'),
    );
    if (valid.length === 0) {
      setNotice({ kind: 'error', text: 'Chỉ hỗ trợ PDF, PNG, JPG, JPEG và WebP.' });
      return;
    }

    const pdf = valid.find((file) => file.type === 'application/pdf');
    const selected = pdf ? [pdf] : valid.slice(0, MAX_IMAGE_FILES);
    setSourceFiles(selected);
    setPages([]);
    setContent('');
    setWorkspaceTab('result');
    setBaseName(safeBaseName(selected[0]?.name ?? 'tai_lieu_ocr'));
    setNotice({
      kind: 'info',
      text: pdf
        ? `Đã chọn PDF: ${pdf.name}.`
        : `Đã chọn ${selected.length} ảnh để OCR.`,
    });
  }, []);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      setIncomingFiles(acceptedFiles);
    },
    [setIncomingFiles],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    maxFiles: MAX_IMAGE_FILES,
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
    },
    disabled: isProcessing,
  });

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (files.length === 0) return;
      event.preventDefault();
      const normalized = files.map(
        (file, index) =>
          new File([file], file.name || `clipboard_${Date.now()}_${index + 1}.png`, {
            type: file.type || 'image/png',
          }),
      );
      setIncomingFiles(normalized);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [setIncomingFiles]);

  const normalizedContent = useMemo(() => normalizeAiMarkdown(content), [content]);
  const formulaCount = useMemo(
    () => countMathExpressions(normalizedContent),
    [normalizedContent],
  );
  const embeddedImageCount = useMemo(
    () => countEmbeddedImages(normalizedContent),
    [normalizedContent],
  );
  const pdfRenderBackendReady = isPdfRenderBackendConfigured();

  const selectedModel = engine === 'gemini' ? geminiModel : 'gemma-4-31b-it';
  const completedPages = pages.filter((page) => page.status === 'done').length;
  const failedPages = pages.filter((page) => page.status === 'error').length;

  async function startOcr() {
    if (sourceFiles.length === 0) {
      setNotice({ kind: 'error', text: 'Hãy chọn PDF hoặc ảnh trước khi OCR.' });
      return;
    }

    const keysToUse = apiKeys.length > 0 ? apiKeys : parseApiKeys(rawApiKeyText);
    if (keysToUse.length === 0) {
      setNotice({
        kind: 'error',
        text: 'Vui lòng cài đặt ít nhất 1 Gemini API Key trong phần "Cài đặt Gemini API & Models".',
      });
      setIsApiModalOpen(true);
      return;
    }

    setIsProcessing(true);
    setNotice({
      kind: 'info',
      text: `Đang gửi tài liệu gốc cho AI (${selectedModel}) với ${keysToUse.length} API Key...`,
    });
    setContent('');
    setPages([]);
    setWorkspaceTab('result');
    setProgress({ current: 0, total: 4, text: 'Đang đọc tệp gốc...' });

    try {
      const first = sourceFiles[0];
      const isPdf = first.type === 'application/pdf';
      let rendered = [] as Awaited<ReturnType<typeof renderPdfToImages>>;
      let imageWarning = '';

      if (isPdf && engine === 'gemma') {
        setProgress({
          current: 1,
          total: 4,
          text: 'Gemma cần ảnh trang: đang thử render PDF trước khi gọi API...',
        });
        rendered = await renderPdfToImages(first, {
          maxPages,
          scale: renderScale,
          jpegQuality: 0.86,
          onProgress: (current, total) =>
            setProgress({
              current: 1,
              total: 4,
              text: `Đang tạo ảnh trang cho Gemma: ${current}/${total}`,
            }),
        });
      }

      setProgress({
        current: 2,
        total: 4,
        text:
          isPdf && engine === 'gemini'
            ? `Đang gửi nguyên file PDF cho ${selectedModel}; chưa dùng PDF.js...`
            : `Đang gửi toàn bộ tài liệu trong một yêu cầu cho ${selectedModel}...`,
      });

      const rawMarkdown = await processOriginalDocument({
        apiKey: keysToUse[0] || '',
        apiKeys: keysToUse,
        engine,
        model: selectedModel,
        sourceFiles,
        renderedPages: rendered,
        maxPages,
        customPrompt,
        onText: (partialText) => setContent(partialText),
      });

      setProgress({ current: 3, total: 4, text: 'OCR đã xong. Đang xử lý hình minh họa nếu có...' });

      if (!isPdf && rendered.length === 0) {
        rendered = await imageFilesToPages(sourceFiles.slice(0, maxPages));
      }

      if (
        isPdf &&
        engine === 'gemini' &&
        rendered.length === 0 &&
        hasDocumentImageMarkers(rawMarkdown)
      ) {
        try {
          rendered = await renderPdfToImages(first, {
            maxPages,
            scale: renderScale,
            onProgress: (current, total) =>
              setProgress({
                current: 3,
                total: 4,
                text: `OCR đã xong; đang thử lấy ảnh trang ${current}/${total}...`,
              }),
          });
        } catch (renderError) {
          imageWarning = renderError instanceof Error ? renderError.message : String(renderError);
          console.warn('OCR đã thành công nhưng không render được PDF để cắt ảnh:', renderError);
        }
      }

      const pageImageMap = new Map(
        rendered.map((page) => [page.pageNumber, page.imageDataUrl] as const),
      );

      let finalMarkdown = rawMarkdown;
      if (engine === 'gemini') {
        if (pageImageMap.size > 0) {
          const refinedMarkdown = await refineDocumentImageMarkers({
            apiKey: keysToUse[0] || '',
            apiKeys: keysToUse,
            model: selectedModel,
            markdown: rawMarkdown,
            pageImages: pageImageMap,
            onProgress: (current, total, pageNumber) =>
              setProgress({
                current: 3,
                total: 4,
                text: `Đang định vị chính xác hình trên trang ${pageNumber} (${current}/${total})...`,
              }),
          });
          finalMarkdown = await replaceDocumentImageMarkers(refinedMarkdown, pageImageMap, first);
        } else {
          finalMarkdown = replaceUnresolvedImageMarkers(rawMarkdown);
        }
      }

      const pageMarkdown = splitMarkdownByPage(finalMarkdown);
      const markdownPageNumbers = [...pageMarkdown.keys()].sort((a, b) => a - b);
      const fallbackPageNumbers = markdownPageNumbers.length > 0 ? markdownPageNumbers : [1];

      const finishedPages: OcrPage[] =
        rendered.length > 0
          ? rendered.map((page, index) => ({
              id: `${Date.now()}-${index}`,
              pageNumber: page.pageNumber,
              sourceName: page.sourceName,
              imageDataUrl: page.imageDataUrl,
              markdown: pageMarkdown.get(page.pageNumber) ?? '',
              status: 'done',
            }))
          : fallbackPageNumbers.map((pageNumber, index) => ({
              id: `${Date.now()}-${index}`,
              pageNumber,
              sourceName: first.name,
              imageDataUrl: '',
              markdown: pageMarkdown.get(pageNumber) ?? '',
              status: 'done',
              error: imageWarning || undefined,
            }));

      setPages(finishedPages);
      setContent(finalMarkdown);
      setProgress({
        current: 4,
        total: 4,
        text: `Đã OCR toàn bộ tài liệu bằng ${selectedModel}`,
      });

      if (imageWarning) {
        setNotice({
          kind: 'info',
          text:
            `OCR văn bản và công thức đã hoàn tất bằng ${selectedModel}. ` +
            'Không lấy được ảnh trang bằng backend/PDF.js nên app giữ ghi chú thay thế; kết quả OCR vẫn có thể chỉnh sửa và xuất Word. ' +
            `Chi tiết: ${imageWarning}`,
        });
      } else {
        setNotice({
          kind: 'success',
          text:
            isPdf && engine === 'gemini'
              ? `OCR thành công: ${selectedModel} đã nhận nguyên file PDF; backend PyMuPDF/PDF.js cắt hình chính xác.`
              : `OCR thành công: toàn bộ ${finishedPages.length} trang được xử lý trong một yêu cầu ${selectedModel}.`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice({ kind: 'error', text: message });
      setProgress({ current: 0, total: 0, text: '' });
    } finally {
      setIsProcessing(false);
    }
  }

  async function copyResult() {
    if (!normalizedContent) return;
    try {
      await navigator.clipboard.writeText(normalizedContent);
      setNotice({ kind: 'success', text: 'Đã sao chép Markdown/LaTeX.' });
    } catch {
      setNotice({ kind: 'error', text: 'Trình duyệt không cho phép sao chép.' });
    }
  }

  function clearAll() {
    setSourceFiles([]);
    setPages([]);
    setContent('');
    setProgress({ current: 0, total: 0, text: '' });
    setNotice(null);
    setBaseName('tai_lieu_ocr');
  }

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-icon">
              <ScanText size={27} />
            </span>
            <span>
              <strong>MathOCR Studio</strong>
              <small>PDF/Image → Word Equation &amp; MathType</small>
            </span>
          </div>

          <div className="topbar-badges">
            {/* Nút trạng thái Bản Quyền & Dùng Thử */}
            <button
              type="button"
              className={`license-header-badge ${
                licenseStatus?.isActivated
                  ? licenseStatus.licenseType === 'lifetime'
                    ? 'is-pro-lifetime'
                    : 'is-pro-1year'
                  : (licenseStatus?.trialRemaining ?? 0) <= 0
                  ? 'is-expired'
                  : 'is-trial'
              }`}
              onClick={() => setIsLicenseModalOpen(true)}
              title="Quản lý bản quyền & Xem số lượt dùng thử"
            >
              {licenseStatus?.isActivated ? (
                licenseStatus.licenseType === 'lifetime' ? (
                  <>
                    <Crown size={15} className="text-purple-600" />
                    <span>Pro Vĩnh Viễn</span>
                  </>
                ) : (
                  <>
                    <Award size={15} className="text-blue-600" />
                    <span>Pro 1 Năm</span>
                  </>
                )
              ) : (licenseStatus?.trialRemaining ?? 0) <= 0 ? (
                <>
                  <AlertTriangle size={15} className="text-red-600" />
                  <span>Hết Lượt Tải (0/{licenseStatus?.trialMax || 5})</span>
                </>
              ) : (
                <>
                  <Gift size={15} className="text-amber-600" />
                  <span>Dùng Thử ({licenseStatus?.trialRemaining ?? 5}/{licenseStatus?.trialMax || 5})</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="api-settings-trigger-btn"
              onClick={() => setIsApiModalOpen(true)}
              title="Cài đặt Gemini API & Models"
            >
              <Settings size={16} />
              <span>Cài đặt API &amp; Models</span>
              <span className="key-pill">
                {apiKeys.length} Key{apiKeys.length > 1 ? 's' : ''}
              </span>
            </button>
            <span><Sparkles size={15} /> {geminiModel}</span>
            <span><Sigma size={15} /> Equation</span>
            <span><Braces size={15} /> MathType OLE</span>
          </div>
        </div>
      </header>

      {/* Main Page */}
      <main className="page-container">
        <section className="hero-card">
          <div className="hero-content">
            <span className="eyebrow"><WandSparkles size={16} /> OCR tài liệu Toán và bảng biểu</span>
            <h1>Chuyển PDF hoặc ảnh thành Word, giữ công thức và hình minh họa</h1>
            <p>
              Tải PDF/ảnh hoặc nhấn Ctrl+V để dán ảnh. Gemini 3.7 / 3.6 / 3.5 nhận nguyên file PDF trong một yêu cầu,
              tự động xoay vòng nhiều API Key khi gặp giới hạn hạn ngạch Quota.
            </p>
          </div>
        </section>

        {notice && (
          <div className={`notice notice-${notice.kind}`} role="status">
            {notice.kind === 'success' ? (
              <CheckCircle2 size={19} />
            ) : notice.kind === 'error' ? (
              <AlertCircle size={19} />
            ) : (
              <Info size={19} />
            )}
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Đóng thông báo">
              <X size={17} />
            </button>
          </div>
        )}

        {/* Mode Switcher */}
        <div className="mode-switcher-wrapper">
          <div className="mode-switcher">
            <button
              type="button"
              className={`mode-tab-btn ${appMode === 'ocr' ? 'active' : ''}`}
              onClick={() => setAppMode('ocr')}
            >
              <ScanText size={18} />
              <span>OCR PDF / Ảnh</span>
            </button>
            <button
              type="button"
              className={`mode-tab-btn ${appMode === 'latex' ? 'active' : ''}`}
              onClick={() => setAppMode('latex')}
            >
              <FileEdit size={18} />
              <span>Chuyển đổi File Word (.docx, .doc) &amp; LaTeX</span>
            </button>
          </div>
        </div>

        {appMode === 'ocr' ? (
          <div className={`main-grid ${settingsCollapsed ? 'settings-collapsed' : ''}`}>
          {/* Sidebar Settings */}
          <aside className="settings-column">
            <div className="card settings-card">
              <div className="card-title-row">
                <h2><Settings2 size={20} /> Thiết lập OCR</h2>
                <button
                  type="button"
                  className="icon-button collapse-button"
                  onClick={() => setSettingsCollapsed((value) => !value)}
                  title={settingsCollapsed ? 'Mở thiết lập' : 'Thu gọn thiết lập'}
                >
                  {settingsCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
                </button>
              </div>

              <div className="settings-content">
                {/* Gemini API & Models Quick Trigger Card */}
                <div className="field-group">
                  <label><KeyRound size={16} /> Gemini API &amp; Models</label>
                  <div
                    className="api-quick-card"
                    onClick={() => setIsApiModalOpen(true)}
                    title="Bấm để mở cửa sổ Cài đặt API và chọn Model"
                  >
                    <div className="api-quick-card-left">
                      <Settings size={20} style={{ color: 'var(--teal-700)' }} />
                      <div>
                        <strong>{apiKeys.length > 0 ? `Đã lưu ${apiKeys.length} API Key` : 'Chưa có API Key'}</strong>
                        <small>OCR: {geminiModel} | Toán: {mathModel}</small>
                      </div>
                    </div>
                    <span className="button button-light" style={{ minHeight: '30px', padding: '0 8px', fontSize: '0.72rem' }}>
                      Cài đặt
                    </span>
                  </div>
                </div>

                {/* Engine Selector */}
                <div className="field-group">
                  <label>Chế độ nhận dạng</label>
                  <div className="engine-grid">
                    <button
                      type="button"
                      className={`engine-card ${engine === 'gemini' ? 'active' : ''}`}
                      onClick={() => setEngine('gemini')}
                    >
                      <Sparkles size={21} />
                      <strong>Gemini + cắt ảnh</strong>
                      <small>Gửi nguyên PDF một lần, OCR công thức và cắt hình base64.</small>
                    </button>
                    <button
                      type="button"
                      className={`engine-card ${engine === 'gemma' ? 'active' : ''}`}
                      onClick={() => setEngine('gemma')}
                    >
                      <Table2 size={21} />
                      <strong>Gemma + bảng</strong>
                      <small>Một request cho toàn bộ trang, ưu tiên cấu trúc bảng Markdown.</small>
                    </button>
                  </div>
                </div>

                {/* Model Selector */}
                {engine === 'gemini' ? (
                  <div className="field-group">
                    <label htmlFor="model">Model Gemini OCR</label>
                    <select
                      id="model"
                      value={geminiModel}
                      onChange={(event) => setGeminiModel(event.target.value as GeminiModel)}
                    >
                      {GEMINI_MODELS.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                    <small className="field-note">
                      {GEMINI_MODELS.find((model) => model.id === geminiModel)?.hint}
                    </small>
                  </div>
                ) : (
                  <div className="model-fixed">
                    <Cpu size={17} />{' '}
                    <span>
                      <strong>gemma-4-31b-it</strong>
                      <small>Model Gemma cố định cho chế độ bảng.</small>
                    </span>
                  </div>
                )}

                <div className="settings-two-columns">
                  <div className="field-group">
                    <label htmlFor="max-pages">Số trang tối đa</label>
                    <input
                      id="max-pages"
                      type="number"
                      min={1}
                      max={100}
                      value={maxPages}
                      onChange={(event) =>
                        setMaxPages(clampNumber(event.target.value, 1, 100, 30))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="api-mode">Cách gửi API</label>
                    <input
                      id="api-mode"
                      value="1 lần / toàn bộ tài liệu"
                      readOnly
                      title="Không còn gọi API riêng cho từng trang"
                    />
                  </div>
                </div>

                <div className="field-group">
                  <label htmlFor="quality">Độ nét xem trước/cắt ảnh</label>
                  <select
                    id="quality"
                    value={renderScale}
                    onChange={(event) => setRenderScale(Number(event.target.value))}
                  >
                    <option value={1.5}>1.5× — nhẹ</option>
                    <option value={2}>2× — khuyên dùng</option>
                    <option value={2.5}>2.5× — công thức nhỏ</option>
                    <option value={3}>3× — rất nét</option>
                  </select>
                </div>

                <div className="field-group">
                  <label htmlFor="prompt">Prompt bổ sung</label>
                  <textarea
                    id="prompt"
                    className="prompt-textarea"
                    value={customPrompt}
                    onChange={(event) => setCustomPrompt(event.target.value)}
                    placeholder="Ví dụ: Giữ nguyên số thứ tự câu hỏi; tiêu đề in đậm; không dịch tiếng Anh..."
                  />
                  <small className="field-note">
                    Quy tắc LaTeX, bảng và marker cắt ảnh đã được app tự gắn vào prompt lõi.
                  </small>
                  <small
                    className={`backend-state ${
                      pdfRenderBackendReady ? 'ready' : 'missing'
                    }`}
                  >
                    {pdfRenderBackendReady
                      ? '✓ Backend PyMuPDF hardcode đã sẵn sàng: ảnh PDF sẽ được render và chèn vào xem trước/Word.'
                      : '⚠ Chưa hardcode URL PDF Render API thật: PDF đặc biệt có thể chỉ hiện ghi chú thay ảnh.'}
                  </small>
                </div>
              </div>
            </div>
          </aside>

          {/* Workspace Area */}
          <section className="work-column">
            <div className="card upload-card">
              <div className="card-title-row">
                <h2><FileUp size={20} /> Nguồn tài liệu</h2>
                {sourceFiles.length > 0 && (
                  <button
                    type="button"
                    className="button button-danger-ghost"
                    onClick={clearAll}
                    disabled={isProcessing}
                  >
                    <Trash2 size={16} /> Xóa
                  </button>
                )}
              </div>

              <div
                {...getRootProps()}
                className={`dropzone ${isDragActive ? 'active' : ''} ${
                  isProcessing ? 'disabled' : ''
                }`}
              >
                <input {...getInputProps()} />
                <span className="dropzone-icon">
                  <FileImage size={33} />
                </span>
                <strong>{isDragActive ? 'Thả file tại đây' : 'Kéo thả PDF hoặc ảnh'}</strong>
                <span>Nhấn để chọn file hoặc dùng Ctrl+V để dán ảnh từ clipboard</span>
                <small>
                  Một PDF gốc hoặc tối đa {MAX_IMAGE_FILES} ảnh PNG/JPG/WebP — chỉ một lần gọi API
                </small>
              </div>

              {sourceFiles.length > 0 && (
                <div className="file-list">
                  {sourceFiles.map((file, index) => (
                    <div className="file-chip" key={`${file.name}-${index}`}>
                      {file.type === 'application/pdf' ? (
                        <FileText size={17} />
                      ) : (
                        <FileImage size={17} />
                      )}
                      <span title={file.name}>{file.name}</span>
                      <small>{formatBytes(file.size)}</small>
                    </div>
                  ))}
                </div>
              )}

              <div className="run-row">
                <div className="filename-field">
                  <label htmlFor="filename">Tên file xuất</label>
                  <div>
                    <input
                      id="filename"
                      value={baseName}
                      onChange={(event) => setBaseName(event.target.value)}
                    />
                    <span>.docx</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="button button-primary run-button"
                  onClick={() => void startOcr()}
                  disabled={sourceFiles.length === 0 || isProcessing}
                >
                  {isProcessing ? (
                    <LoaderCircle className="spin" size={19} />
                  ) : (
                    <Play size={19} />
                  )}
                  {isProcessing
                    ? 'Đang OCR tệp gốc...'
                    : `OCR tệp gốc bằng ${engine === 'gemini' ? geminiModel : 'Gemma'}`}
                </button>
              </div>

              {(isProcessing || progress.total > 0) && (
                <div className="progress-box">
                  <div className="progress-heading">
                    <span>{progress.text}</span>
                    <b>
                      {progress.total
                        ? Math.round((progress.current / progress.total) * 100)
                        : 0}
                      %
                    </b>
                  </div>
                  <div className="progress-track">
                    <div
                      style={{
                        width: `${
                          progress.total
                            ? (progress.current / progress.total) * 100
                            : 4
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="card workspace-card">
              <div className="workspace-topbar">
                <div className="tabs">
                  <button
                    type="button"
                    className={workspaceTab === 'result' ? 'active' : ''}
                    onClick={() => setWorkspaceTab('result')}
                  >
                    <FileText size={17} /> Kết quả
                  </button>
                  <button
                    type="button"
                    className={workspaceTab === 'pages' ? 'active' : ''}
                    onClick={() => setWorkspaceTab('pages')}
                  >
                    <Images size={17} /> Trang gốc <span>{pages.length}</span>
                  </button>
                </div>

                <div className="workspace-actions">
                  <button
                    type="button"
                    className="button button-light"
                    onClick={() => void copyResult()}
                    disabled={!normalizedContent}
                  >
                    <Copy size={16} /> Sao chép
                  </button>
                  <button
                    type="button"
                    className="button button-light"
                    onClick={async () => {
                      const allowed = await handleRequireDownloadQuota('Markdown (.md)');
                      if (allowed) {
                        downloadText(normalizedContent, `${safeBaseName(baseName)}.md`);
                        setNotice({ kind: 'success', text: 'Đã tải xuống file Markdown.' });
                      }
                    }}
                    disabled={!normalizedContent}
                  >
                    <Download size={16} /> Markdown
                  </button>
                  <ExportMenu
                    content={normalizedContent}
                    baseName={baseName}
                    disabled={isProcessing}
                    onMessage={(message, isError) =>
                      setNotice({ kind: isError ? 'error' : 'success', text: message })
                    }
                    onRequireDownloadQuota={handleRequireDownloadQuota}
                  />
                </div>
              </div>

              <div className="stats-row">
                <span><b>{pages.length}</b> trang</span>
                <span><b>{completedPages}</b> hoàn tất</span>
                <span><b>{failedPages}</b> lỗi</span>
                <span><b>{formulaCount}</b> công thức</span>
                <span><b>{embeddedImageCount}</b> ảnh cắt</span>
                <span><b>{normalizedContent.length.toLocaleString('vi-VN')}</b> ký tự</span>
                <span className="model-badge">{selectedModel}</span>
              </div>

              {workspaceTab === 'result' ? (
                <div className="result-area">
                  <div className="view-switcher">
                    <button
                      type="button"
                      className={resultView === 'split' ? 'active' : ''}
                      onClick={() => setResultView('split')}
                    >
                      Chia đôi
                    </button>
                    <button
                      type="button"
                      className={resultView === 'editor' ? 'active' : ''}
                      onClick={() => setResultView('editor')}
                    >
                      Chỉnh sửa
                    </button>
                    <button
                      type="button"
                      className={resultView === 'preview' ? 'active' : ''}
                      onClick={() => setResultView('preview')}
                    >
                      Xem trước
                    </button>
                  </div>
                  <div className={`editor-grid view-${resultView}`}>
                    {resultView !== 'preview' && (
                      <section className="editor-panel">
                        <div className="panel-heading">
                          <span><Clipboard size={17} /> Markdown/LaTeX</span>
                          <small>Có thể chỉnh trực tiếp trước khi xuất Word</small>
                        </div>
                        <textarea
                          value={content}
                          onChange={(event) => setContent(event.target.value)}
                          spellCheck={false}
                          placeholder="Kết quả OCR sẽ xuất hiện ở đây..."
                        />
                      </section>
                    )}
                    {resultView !== 'editor' && (
                      <section className="preview-panel">
                        <div className="panel-heading">
                          <span><Sparkles size={17} /> Xem trước</span>
                          <small>LIVE</small>
                        </div>
                        <div className="preview-scroll">
                          <MarkdownPreview content={normalizedContent} />
                        </div>
                      </section>
                    )}
                  </div>
                </div>
              ) : (
                <div className="pages-grid">
                  {pages.length === 0 ? (
                    <div className="empty-state">
                      <Images size={44} />
                      <strong>Chưa có trang nào</strong>
                      <span>Chọn PDF/ảnh và bắt đầu OCR để xem trang gốc.</span>
                    </div>
                  ) : (
                    pages.map((page) => (
                      <article className="page-card" key={page.id}>
                        <div className="page-card-head">
                          <span>Trang {page.pageNumber}</span>
                          <PageStatusBadge page={page} />
                        </div>
                        {page.imageDataUrl ? (
                          <img
                            src={page.imageDataUrl}
                            alt={`Trang ${page.pageNumber}`}
                            loading="lazy"
                          />
                        ) : (
                          <div className="page-image-unavailable">
                            <FileText size={34} />
                            <strong>OCR trang {page.pageNumber} đã hoàn tất</strong>
                            <span>Không tạo được ảnh xem trước từ PDF này.</span>
                          </div>
                        )}
                        {page.error && (
                          <div className="page-error" title={page.error}>
                            {page.error}
                          </div>
                        )}
                      </article>
                    ))
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
        ) : (
          <LatexDirectConverter
            apiKeys={apiKeys}
            geminiModel={geminiModel}
            mathModel={mathModel}
            onMessage={(message, isError) =>
              setNotice({ kind: isError ? 'error' : 'success', text: message })
            }
            onOpenApiSettings={() => setIsApiModalOpen(true)}
            onRequireDownloadQuota={handleRequireDownloadQuota}
          />
        )}

        <footer className="footer-bar">
          <span>Equation/OMML: Pandoc API hardcode</span>
          <span>MathType OLE: MathType API hardcode</span>
          <span>PDF Gemini gửi nguyên file, hỗ trợ nhiều API Key &amp; tự động chuyển đổi</span>
        </footer>
      </main>

      {/* Api & Models Modal Dialog */}
      <ApiSettingsModal
        isOpen={isApiModalOpen}
        onClose={() => setIsApiModalOpen(false)}
        rawApiKeyText={rawApiKeyText}
        onSave={handleSaveApiSettings}
        currentGeminiModel={geminiModel}
        currentMathModel={mathModel}
      />

      {/* License & Activation Modal Dialog */}
      <LicenseModal
        isOpen={isLicenseModalOpen}
        onClose={() => setIsLicenseModalOpen(false)}
        status={licenseStatus}
        onStatusUpdated={(newStatus) => setLicenseStatus(newStatus)}
        onMessage={(msg, isErr) =>
          setNotice({ kind: isErr ? 'error' : 'success', text: msg })
        }
      />
    </div>
  );
}

function PageStatusBadge({ page }: { page: OcrPage }) {
  if (page.status === 'processing')
    return (
      <span className="status status-processing">
        <LoaderCircle className="spin" size={13} /> Đang OCR
      </span>
    );
  if (page.status === 'done')
    return (
      <span className="status status-done">
        <CheckCircle2 size={13} /> Xong
      </span>
    );
  if (page.status === 'error')
    return (
      <span className="status status-error">
        <AlertCircle size={13} /> Lỗi
      </span>
    );
  return <span className="status status-waiting">Chờ</span>;
}

function readStoredSettings(): StoredSettings {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_STORAGE) ?? '{}') as StoredSettings;
  } catch {
    return {};
  }
}

function clampNumber(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
