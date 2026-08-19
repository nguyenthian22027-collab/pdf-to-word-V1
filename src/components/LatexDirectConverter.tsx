import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Braces,
  CheckCircle2,
  Clipboard,
  ClipboardPaste,
  Copy,
  Download,
  FileDown,
  FileEdit,
  FileText,
  FileUp,
  ImagePlus,
  Info,
  LoaderCircle,
  RotateCcw,
  Sigma,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { MarkdownPreview } from './MarkdownPreview';
import { aiOptimizeAndFixLatex } from '../services/aiService';
import {
  countEmbeddedImages,
  countMathExpressions,
  downloadText,
  normalizeAiMarkdown,
  safeBaseName,
} from '../services/content';
import { readDocumentOrTextFile } from '../services/docParserService';
import type { GeminiModel, MathSolverModel } from '../types';

interface Props {
  apiKeys: string[];
  geminiModel: GeminiModel;
  mathModel: MathSolverModel;
  onMessage: (message: string, isError?: boolean) => void;
  onOpenApiSettings: () => void;
  onRequireDownloadQuota?: (formatName: string) => Promise<boolean>;
}

type ViewMode = 'split' | 'editor' | 'preview';

const SAMPLE_LATEX = `# ĐỀ KIỂM TRA ĐẠI SỐ VÀ HÌNH HỌC 2026

**Câu 1 (2.0 điểm):** Cho hàm số $y = f(x) = \\frac{2x + 1}{x - 1}$.
a) Tìm tập xác định và tính đạo hàm $f'(x) = \\frac{-3}{(x-1)^2}$.
b) Tính tích phân $I = \\int_{0}^{1} \\sqrt{1 - x^2} \\, dx = \\frac{\\pi}{4}$.

**Câu 2 (2.0 điểm):** Giải phương trình và hệ phương trình sau:
$$
\\begin{cases}
2x + 3y = 7 \\\\
x^2 - y^2 = 3
\\end{cases}
$$

**Câu 3 (2.0 điểm):** Cho ma trận và biểu thức giới hạn:
$$
A = \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}, \\quad \\lim_{x \\to 0} \\frac{\\sin(3x)}{x} = 3
$$

| STT | Biểu thức | Kết quả | Ghi chú |
| :---: | :--- | :---: | :--- |
| 1 | $\\Delta = b^2 - 4ac$ | $\\ge 0$ | Phương trình có nghiệm |
| 2 | $S = \\sum_{i=1}^{n} i^2$ | $\\frac{n(n+1)(2n+1)}{6}$ | Tổng bình phương |
`;

export function LatexDirectConverter({
  apiKeys,
  geminiModel,
  mathModel,
  onMessage,
  onOpenApiSettings,
  onRequireDownloadQuota,
}: Props) {
  const [content, setContent] = useState('');
  const [baseName, setBaseName] = useState('tai_lieu_chuyen_doi');
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [isAiOptimizing, setIsAiOptimizing] = useState(false);
  const [autoAiOptimize, setAutoAiOptimize] = useState(true);
  const [isExporting, setIsExporting] = useState<'equation' | 'mathtype' | ''>('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const normalizedContent = useMemo(() => normalizeAiMarkdown(content), [content]);

  const stats = useMemo(() => {
    const text = normalizedContent.trim();
    const chars = text.length;
    const words = text ? text.split(/\s+/).length : 0;
    const formulas = countMathExpressions(normalizedContent);
    const tables = (normalizedContent.match(/\|[\s\S]*?\|[\s\S]*?\n\|(?:\s*---+\s*\|)+/g) ?? []).length;
    const images = countEmbeddedImages(normalizedContent);
    return { chars, words, formulas, tables, images };
  }, [normalizedContent]);

  // AI Sửa lỗi, Chuẩn hóa công thức và Tái tạo bảng biểu
  const runAiOptimization = useCallback(
    async (textToOptimize: string) => {
      if (!textToOptimize.trim()) {
        onMessage('Vui lòng nhập hoặc tải nội dung văn bản trước khi chuẩn hóa.', true);
        return;
      }

      if (apiKeys.length === 0) {
        onMessage('Vui lòng cài đặt Gemini API key trước khi sử dụng AI.', true);
        onOpenApiSettings();
        return;
      }

      setIsAiOptimizing(true);
      onMessage(`AI (${geminiModel}) đang phân tích tài liệu, chuẩn hóa công thức và tái tạo bảng biểu...`);

      try {
        const optimized = await aiOptimizeAndFixLatex({
          apiKeys,
          model: geminiModel,
          content: textToOptimize,
        });

        setContent(optimized);
        onMessage('✨ AI đã chuẩn hóa xong: công thức LaTeX và bảng biểu đã được phục hồi chính xác!');
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        onMessage(`Lỗi AI chuẩn hóa: ${err}`, true);
      } finally {
        setIsAiOptimizing(false);
      }
    },
    [apiKeys, geminiModel, onMessage, onOpenApiSettings],
  );

  // Xử lý nạp file văn bản / Word
  const processIncomingFile = useCallback(
    async (file: File) => {
      setIsReadingFile(true);
      try {
        const result = await readDocumentOrTextFile(file);
        setContent(result.content);
        setBaseName(safeBaseName(result.filename));
        const typeLabel =
          result.fileType === 'docx'
            ? 'Word (.docx)'
            : result.fileType === 'doc'
            ? 'Word (.doc)'
            : 'Văn bản';

        if (result.fileType === 'doc') {
          onMessage(
            `Đã nạp tệp Word (.doc): ${result.filename}. Lưu ý: Bạn nên lưu/chuyển tệp sang .docx để giữ nguyên vẹn bảng biểu và hình ảnh tốt nhất.`,
          );
        } else {
          onMessage(
            `Đã nạp tệp ${typeLabel}: ${result.filename} (${result.stats.characters.toLocaleString('vi-VN')} ký tự, ${result.stats.mathCount} công thức).`,
          );
        }

        // Tự động kích hoạt AI nhận diện bảng biểu & công thức giống luồng OCR nếu có API key
        if (apiKeys.length > 0 && autoAiOptimize && result.content.trim()) {
          setTimeout(() => {
            void runAiOptimization(result.content);
          }, 100);
        }
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error);
        onMessage(`Lỗi đọc file: ${err}`, true);
      } finally {
        setIsReadingFile(false);
      }
    },
    [apiKeys.length, autoAiOptimize, onMessage, runAiOptimization],
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        void processIncomingFile(acceptedFiles[0]);
      }
    },
    [processIncomingFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
      'text/x-tex': ['.tex', '.latex'],
    },
    disabled: isReadingFile || isAiOptimizing,
  });

  // Chèn ảnh dạng Base64 vào vị trí con trỏ trong textarea
  const insertImageBase64 = useCallback((dataUrl: string, alt = 'Hình ảnh') => {
    const markdownImg = `\n\n![${alt}](${dataUrl})\n\n`;
    setContent((prev) => {
      const textarea = textareaRef.current;
      if (!textarea) return prev + markdownImg;
      const start = textarea.selectionStart || prev.length;
      const end = textarea.selectionEnd || prev.length;
      return prev.substring(0, start) + markdownImg + prev.substring(end);
    });
  }, []);

  // Xử lý khi người dùng chọn file ảnh từ máy tính
  function handleImageFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      insertImageBase64(dataUrl, file.name.replace(/\.[^/.]+$/, ''));
      onMessage(`Đã chèn hình ảnh: ${file.name}`);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // Bắt sự kiện Paste trực tiếp vào khung Soạn thảo (hỗ trợ dán cả ảnh và chữ)
  const handleTextareaPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = event.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            event.preventDefault();
            const blob = items[i].getAsFile();
            if (blob) {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                insertImageBase64(dataUrl, 'Ảnh dán');
                onMessage('Đã dán và nhúng hình ảnh thành công!');
              };
              reader.readAsDataURL(blob);
            }
            return;
          }
        }
      }
    },
    [insertImageBase64, onMessage],
  );

  // Dán từ Clipboard qua nút bấm
  async function handlePasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        onMessage('Clipboard trống hoặc không chứa văn bản.', true);
        return;
      }
      const normalized = normalizeAiMarkdown(text);
      setContent(normalized);
      onMessage('Đã dán văn bản từ Clipboard và chuẩn hóa công thức thành công!');
    } catch {
      onMessage('Trình duyệt không cho phép đọc Clipboard. Bạn hãy nhấn Ctrl+V trực tiếp vào ô văn bản.', true);
    }
  }

  // AI Sửa lỗi & Chuẩn hóa LaTeX bằng tay
  function handleManualAiOptimize() {
    void runAiOptimization(content);
  }

  // Chèn mẫu LaTeX
  function handleInsertSample() {
    setContent(SAMPLE_LATEX);
    setBaseName('de_kiem_tra_toan_mau');
    onMessage('Đã nạp đề mẫu Toán học chứa công thức LaTeX và bảng Markdown.');
  }

  // Xuất Word Equation
  async function handleExportEquation() {
    if (!normalizedContent.trim()) return;
    if (onRequireDownloadQuota) {
      const allowed = await onRequireDownloadQuota('Word Equation (.docx)');
      if (!allowed) return;
    }
    setIsExporting('equation');
    const name = `${safeBaseName(baseName)}_equation.docx`;
    try {
      const { exportMarkdownToEquationDocx } = await import('../services/docxExportService');
      await exportMarkdownToEquationDocx(normalizedContent, name);
      onMessage(`Đã xuất Word Equation (OMML) thành công: ${name}`);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      onMessage(`Không xuất được Word Equation: ${err}`, true);
    } finally {
      setIsExporting('');
    }
  }

  // Xuất Word MathType
  async function handleExportMathType() {
    if (!normalizedContent.trim()) return;
    if (onRequireDownloadQuota) {
      const allowed = await onRequireDownloadQuota('Word MathType (.docx)');
      if (!allowed) return;
    }
    setIsExporting('mathtype');
    const name = `${safeBaseName(baseName)}_mathtype.docx`;
    try {
      const { exportMathTypeDocx } = await import('../services/mathtypeExport');
      const res = await exportMathTypeDocx(normalizedContent, name);
      onMessage(
        `Đã xuất Word MathType OLE thành công: ${res.converted} công thức${
          res.failed > 0 ? `, ${res.failed} lỗi` : ''
        }.`,
        res.failed > 0,
      );
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      onMessage(`Không xuất được Word MathType: ${err}`, true);
    } finally {
      setIsExporting('');
    }
  }

  // Xuất Word MathType (.doc) siêu tương thích offline giống Chuyen_Doi_PDF_Toan_Hoc.html
  async function handleExportHtmlMathTypeDoc() {
    if (!normalizedContent.trim()) return;
    if (onRequireDownloadQuota) {
      const allowed = await onRequireDownloadQuota('Word MathType (.doc)');
      if (!allowed) return;
    }
    const name = `${safeBaseName(baseName)}_MathType_LaTeX.doc`;
    try {
      const { exportHtmlMathTypeDoc } = await import('../services/docxExportService');
      exportHtmlMathTypeDoc(normalizedContent, name);
      onMessage(`Đã xuất file Word MathType (.doc) siêu tương thích thành công: ${name}`);
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      onMessage(`Không xuất được Word .doc: ${err}`, true);
    }
  }

  // Tải file Markdown (.md)
  async function handleDownloadMd() {
    if (!normalizedContent.trim()) return;
    if (onRequireDownloadQuota) {
      const allowed = await onRequireDownloadQuota('Markdown LaTeX (.md)');
      if (!allowed) return;
    }
    downloadText(normalizedContent, `${safeBaseName(baseName)}.md`);
    onMessage(`Đã tải xuống file .md thành công.`);
  }

  // Sao chép kết quả
  async function handleCopyContent() {
    if (!normalizedContent) return;
    try {
      await navigator.clipboard.writeText(normalizedContent);
      onMessage('Đã sao chép nội dung Markdown / LaTeX vào bộ nhớ tạm.');
    } catch {
      onMessage('Không thể sao chép vào bộ nhớ tạm.', true);
    }
  }

  return (
    <div className="latex-converter-container">
      {/* Top Banner / Upload Zone */}
      <div className="latex-dropzone-card">
        <div className="latex-dropzone-header">
          <div className="latex-dropzone-title">
            <FileEdit size={22} className="text-teal" />
            <div>
              <h3>Tải tệp Word (.docx, .doc) hoặc Dán văn bản LaTeX</h3>
              <p>Hỗ trợ copy từ ChatGPT, Gemini, Overleaf, Word và tự động chuyển đổi sang Word Equation / MathType</p>
            </div>
          </div>
          <div className="latex-quick-actions">
            <input
              type="file"
              ref={imageInputRef}
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleImageFileSelected}
            />
            <button
              type="button"
              className="button button-light"
              onClick={() => imageInputRef.current?.click()}
              title="Chèn tệp hình ảnh từ máy tính vào tài liệu"
            >
              <ImagePlus size={16} /> Chèn hình ảnh
            </button>
            <button
              type="button"
              className="button button-light"
              onClick={handlePasteFromClipboard}
              title="Dán văn bản hoặc hình ảnh trong Clipboard (Ctrl + V)"
            >
              <ClipboardPaste size={16} /> Dán từ Clipboard
            </button>
            <button
              type="button"
              className="button button-light"
              onClick={handleInsertSample}
              title="Nạp đề Toán mẫu có công thức LaTeX để thử nghiệm"
            >
              <Sparkles size={16} /> Mẫu thử nghiệm
            </button>
          </div>
        </div>

        {/* Drag Drop Area */}
        <div
          {...getRootProps()}
          className={`latex-dropzone ${isDragActive ? 'active' : ''} ${
            isReadingFile ? 'disabled' : ''
          }`}
        >
          <input {...getInputProps()} />
          <span className="dropzone-icon">
            {isReadingFile ? (
              <LoaderCircle className="spin" size={28} />
            ) : (
              <FileUp size={28} />
            )}
          </span>
          <div className="latex-dropzone-text">
            <strong>
              {isDragActive
                ? 'Thả tệp tại đây'
                : isReadingFile
                ? 'Đang đọc và phân tích tệp tài liệu...'
                : 'Kéo thả file Word (.docx, .doc) hoặc file văn bản (.txt, .md, .tex)'}
            </strong>
            <span>Nhấn để duyệt file trên máy tính hoặc dán trực tiếp nội dung vào khung bên dưới</span>
          </div>
        </div>

        {/* Khuyến nghị định dạng .docx */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          marginTop: '12px',
          borderRadius: '8px',
          background: 'rgba(2, 132, 199, 0.07)',
          border: '1px solid rgba(2, 132, 199, 0.22)',
          color: '#0369a1',
          fontSize: '13px',
          lineHeight: '1.45'
        }}>
          <Info size={18} style={{ flexShrink: 0, color: '#0284c7' }} />
          <span>
            <strong>Khuyến nghị:</strong> Bạn nên nạp tệp định dạng <strong>.docx</strong> (Word chuẩn hiện đại) để hệ thống trích xuất và bảo toàn 100% vị trí bảng biểu, hình vẽ và công thức toán học tốt nhất (vượt trội hơn so với tệp <strong>.doc</strong> cũ).
          </span>
        </div>
      </div>

      {/* Workspace Panel: Editor & Live Preview */}
      <div className="card latex-workspace-card">
        {/* Workspace Toolbar */}
        <div className="latex-workspace-toolbar">
          <div className="latex-toolbar-left">
            <button
              type="button"
              className={`button ${isAiOptimizing ? 'button-primary' : 'button-ai'}`}
              onClick={handleManualAiOptimize}
              disabled={isAiOptimizing || !content.trim()}
              title="Dùng Gemini 3.7 tự động nhận diện và tái tạo bảng biểu, chuẩn hóa công thức LaTeX (tương tự luồng OCR)"
            >
              {isAiOptimizing ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Wand2 size={16} />
              )}
              {isAiOptimizing ? 'AI đang tái tạo...' : '✨ AI Chuẩn hóa & Tái tạo bảng biểu'}
            </button>

            <label className="checkbox-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', color: 'var(--text-muted, #64748b)' }}>
              <input
                type="checkbox"
                checked={autoAiOptimize}
                onChange={(e) => setAutoAiOptimize(e.target.checked)}
              />
              <span>Tự động AI khi nạp tệp</span>
            </label>

            {content.trim() && (
              <button
                type="button"
                className="button button-danger-ghost"
                onClick={() => {
                  setContent('');
                  onMessage('Đã xóa nội dung.');
                }}
                title="Xóa trắng khung soạn thảo"
              >
                <Trash2 size={15} /> Xóa
              </button>
            )}
          </div>

          <div className="latex-toolbar-right">
            <div className="view-switcher" style={{ margin: 0 }}>
              <button
                type="button"
                className={viewMode === 'split' ? 'active' : ''}
                onClick={() => setViewMode('split')}
              >
                Chia đôi
              </button>
              <button
                type="button"
                className={viewMode === 'editor' ? 'active' : ''}
                onClick={() => setViewMode('editor')}
              >
                Soạn thảo
              </button>
              <button
                type="button"
                className={viewMode === 'preview' ? 'active' : ''}
                onClick={() => setViewMode('preview')}
              >
                Xem trước
              </button>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="stats-row">
          <span><b>{stats.formulas}</b> công thức LaTeX</span>
          <span><b>{stats.tables}</b> bảng biểu</span>
          {stats.images > 0 && <span><b>{stats.images}</b> hình ảnh</span>}
          <span><b>{stats.words.toLocaleString('vi-VN')}</b> từ</span>
          <span><b>{stats.chars.toLocaleString('vi-VN')}</b> ký tự</span>
          <span className="model-badge">AI: {geminiModel}</span>
        </div>

        {/* Editor Grid */}
        <div className={`latex-editor-grid view-${viewMode}`}>
          {viewMode !== 'preview' && (
            <section className="editor-panel">
              <div className="panel-heading">
                <span><FileText size={17} /> Soạn thảo / Mã nguồn LaTeX</span>
                <small>Nhập, dán văn bản hoặc Ctrl+V dán ảnh trực tiếp</small>
              </div>
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onPaste={handleTextareaPaste}
                placeholder={`Dán văn bản có công thức toán $...$ hoặc $$...$$ vào đây (hoặc Ctrl+V dán ảnh)...\nVí dụ: Cho hàm số $y = f(x) = \\frac{1}{x}$ và tích phân $\\int_0^1 x^2 dx$`}
                spellCheck={false}
                className="latex-source-textarea"
              />
            </section>
          )}

          {viewMode !== 'editor' && (
            <section className="preview-panel">
              <div className="panel-heading">
                <span><Sparkles size={17} /> Xem trước công thức (LIVE KaTeX)</span>
                <small>Kết quả công thức hiển thị tức thì</small>
              </div>
              <div className="preview-scroll">
                {normalizedContent.trim() ? (
                  <MarkdownPreview content={normalizedContent} />
                ) : (
                  <div className="empty-preview-hint">
                    <Sigma size={48} className="empty-hint-icon" />
                    <strong>Chưa có nội dung xem trước</strong>
                    <span>Hãy dán văn bản chứa công thức hoặc kéo thả file .docx, .doc, .txt vào đây.</span>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Export Footer Bar */}
        <div className="latex-export-footer">
          <div className="filename-field" style={{ minWidth: '260px' }}>
            <label htmlFor="latex-filename">Tên tệp Word xuất ra</label>
            <div>
              <input
                id="latex-filename"
                value={baseName}
                onChange={(e) => setBaseName(e.target.value)}
              />
              <span>.docx</span>
            </div>
          </div>

          <div className="latex-export-buttons">
            <button
              type="button"
              className="button button-light"
              onClick={handleCopyContent}
              disabled={!normalizedContent.trim()}
              title="Sao chép toàn bộ văn bản Markdown/LaTeX"
            >
              <Copy size={16} /> Sao chép
            </button>

            <button
              type="button"
              className="button button-light"
              onClick={() => void handleDownloadMd()}
              disabled={!normalizedContent.trim()}
              title="Tải tệp .md"
            >
              <Download size={16} /> File .md
            </button>

            {/* Word Equation Button */}
            <button
              type="button"
              className="button button-primary btn-export-equation"
              onClick={() => void handleExportEquation()}
              disabled={Boolean(isExporting) || !normalizedContent.trim()}
              title="Xuất sang Word với công thức chuẩn Equation (OMML)"
            >
              {isExporting === 'equation' ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Sigma size={18} />
              )}
              {isExporting === 'equation' ? 'Đang tạo Word...' : 'Xuất Word Equation'}
            </button>

            {/* Word MathType DOCX Button */}
            <button
              type="button"
              className="button btn-export-mathtype"
              onClick={() => void handleExportMathType()}
              disabled={Boolean(isExporting) || !normalizedContent.trim()}
              title="Xuất sang Word (.docx) với công thức MathType OLE thật"
            >
              {isExporting === 'mathtype' ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Braces size={18} />
              )}
              {isExporting === 'mathtype' ? 'Đang tạo Word...' : 'Xuất Word MathType (.docx)'}
            </button>

            {/* Word MathType DOC Button (Chuyen_Doi_PDF_Toan_Hoc.html style) */}
            <button
              type="button"
              className="button button-light"
              style={{ borderColor: 'var(--blue-500, #3b82f6)', color: 'var(--blue-700, #1d4ed8)', fontWeight: 600 }}
              onClick={handleExportHtmlMathTypeDoc}
              disabled={!normalizedContent.trim()}
              title="Xuất sang Word (.doc) siêu tương thích (chạy offline, giữ nguyên bảng biểu và công thức toán $...$)"
            >
              <FileDown size={18} /> Xuất Word (.doc) MathType
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
