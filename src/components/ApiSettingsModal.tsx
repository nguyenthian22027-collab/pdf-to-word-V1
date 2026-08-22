import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Info,
  KeyRound,
  Layers,
  Lightbulb,
  LoaderCircle,
  MessageSquareCode,
  Settings,
  Sparkles,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import type { ApiKeyHealthResult, GeminiModel, MathSolverModel } from '../types';
import {
  checkMultipleApiKeysHealth,
  parseApiKeys,
} from '../services/apiHealthService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  rawApiKeyText: string;
  onSave: (
    apiKeysText: string,
    geminiModel: GeminiModel,
    mathModel: MathSolverModel,
    maxPages?: number,
    customPrompt?: string,
  ) => void;
  currentGeminiModel: GeminiModel;
  currentMathModel?: MathSolverModel;
  currentMaxPages?: number;
  currentCustomPrompt?: string;
}

export const OCR_MODEL_OPTIONS: Array<{ id: GeminiModel; label: string }> = [
  { id: 'gemini-3.7-flash', label: '🌟 gemini-3.7-flash (Mới Nhất 2026 / Siêu Nhanh & Chuẩn)' },
  { id: 'gemini-3.5-flash', label: '🌟 gemini-3.5-flash (Thế hệ mới 2026)' },
  { id: 'gemini-3.0-flash', label: '🚀 gemini-3.0-flash (Thế hệ 3.0 Siêu Nhanh)' },
  { id: 'gemini-3.1-flash-lite', label: '⚡ gemini-3.1-flash-lite (Hạn ngạch Quota cực cao)' },
  { id: 'gemini-3.6-flash', label: '💥 gemini-3.6-flash (Mới ra mắt)' },
  { id: 'gemini-2.0-flash', label: '💎 gemini-2.0-flash (Ổn định, Đọc toán cực tốt)' },
  { id: 'gemini-1.5-flash', label: '🔷 gemini-1.5-flash (Chuẩn Google)' },
  { id: 'gemini-1.5-pro', label: '🧠 gemini-1.5-pro (Đọc đề chữ mờ / khó)' },
  { id: 'auto', label: '🔄 Tự động xoay vòng Model (Auto Fallback)' },
];

export const MATH_MODEL_OPTIONS: Array<{ id: MathSolverModel; label: string }> = [
  { id: 'gemini-3.7-flash', label: 'gemini-3.7-flash' },
  { id: 'gemini-3.6-flash', label: 'gemini-3.6-flash' },
  { id: 'gemini-3.5-flash', label: 'gemini-3.5-flash' },
  { id: 'gemini-3.0-flash', label: 'gemini-3.0-flash' },
  { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
  { id: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
];

export function ApiSettingsModal({
  isOpen,
  onClose,
  rawApiKeyText,
  onSave,
  currentGeminiModel,
  currentMathModel = 'gemini-3.7-flash',
  currentMaxPages = 30,
  currentCustomPrompt = '',
}: Props) {
  const [apiKeyInput, setApiKeyInput] = useState(rawApiKeyText);
  const [selectedOcrModel, setSelectedOcrModel] = useState<GeminiModel>(currentGeminiModel);
  const [selectedMathModel, setSelectedMathModel] = useState<MathSolverModel>(currentMathModel);
  const [selectedMaxPages, setSelectedMaxPages] = useState<number>(currentMaxPages);
  const [selectedCustomPrompt, setSelectedCustomPrompt] = useState<string>(currentCustomPrompt);

  const [isChecking, setIsChecking] = useState(false);
  const [healthResults, setHealthResults] = useState<ApiKeyHealthResult[] | null>(null);

  useEffect(() => {
    if (isOpen) {
      setApiKeyInput(rawApiKeyText);
      setSelectedOcrModel(currentGeminiModel);
      setSelectedMathModel(currentMathModel);
      setSelectedMaxPages(currentMaxPages);
      setSelectedCustomPrompt(currentCustomPrompt);
      setHealthResults(null);
    }
  }, [isOpen, rawApiKeyText, currentGeminiModel, currentMathModel, currentMaxPages, currentCustomPrompt]);

  const parsedKeys = useMemo(() => parseApiKeys(apiKeyInput), [apiKeyInput]);
  const keyCount = parsedKeys.length;

  if (!isOpen) return null;

  async function handleHealthCheck() {
    if (parsedKeys.length === 0) {
      setHealthResults([
        {
          keyIndex: 0,
          maskedKey: '(Trống)',
          fullKey: '',
          status: 'auth_error',
          message: 'Vui lòng nhập ít nhất 1 API key để kiểm tra.',
        },
      ]);
      return;
    }

    setIsChecking(true);
    setHealthResults(null);

    try {
      const results = await checkMultipleApiKeysHealth(
        parsedKeys,
        selectedOcrModel === 'auto' ? 'gemini-2.0-flash' : selectedOcrModel,
      );
      setHealthResults(results);
    } catch (error) {
      setHealthResults([
        {
          keyIndex: 0,
          maskedKey: 'Lỗi kiểm tra',
          fullKey: '',
          status: 'network_error',
          message: error instanceof Error ? error.message : 'Không thể thực hiện kiểm tra API.',
        },
      ]);
    } finally {
      setIsChecking(false);
    }
  }

  function handleSave() {
    onSave(
      apiKeyInput.trim(),
      selectedOcrModel,
      selectedMathModel,
      selectedMaxPages,
      selectedCustomPrompt,
    );
    onClose();
  }

  return (
    <div className="api-modal-overlay" onClick={onClose}>
      <div
        className="api-modal-content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="api-modal-header">
          <div className="api-modal-title">
            <span className="api-modal-title-icon">
              <Settings size={22} />
            </span>
            <h3>Thiết lập OCR &amp; Gemini API</h3>
          </div>
          <div className="api-modal-header-right">
            <span className={`api-key-badge ${keyCount > 0 ? 'badge-has-keys' : 'badge-empty'}`}>
              {keyCount} Key{keyCount > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              className="api-modal-close-btn"
              onClick={onClose}
              aria-label="Đóng"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="api-modal-body">
          {/* Info callout note */}
          <div className="api-notice-box">
            <div className="api-notice-title">
              <Lightbulb size={18} className="api-notice-icon" />
              <strong>Lưu ý về định dạng API Key Google Gemini:</strong>
            </div>
            <p className="api-notice-text">
              API Key chính thức từ <strong>Google AI Studio (aistudio.google.com)</strong> luôn bắt đầu bằng chữ{' '}
              <code className="api-code-highlight">AIzaSy...</code>
            </p>
            <p className="api-notice-subtext">
              (Lấy key miễn phí tại{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="api-link"
              >
                Google AI Studio &rarr; Get API Key <ExternalLink size={12} style={{ display: 'inline' }} />
              </a>{' '}
              để nhận hạn ngạch Quota cao nhất).
            </p>
          </div>

          {/* Multiple API Keys Textarea */}
          <div className="api-field-block">
            <div className="api-field-label-row">
              <label htmlFor="gemini-api-keys-input" className="api-field-label">
                <KeyRound size={16} /> Danh sách Gemini API Keys (AIzaSy...):
              </label>
              {keyCount > 0 && (
                <span className="api-key-valid-indicator">
                  ✓ Đã nhận diện {keyCount} key
                </span>
              )}
            </div>
            <textarea
              id="gemini-api-keys-input"
              className="api-keys-textarea"
              rows={3}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={`AIzaSy...\nAIzaSy... (Nhập nhiều key, mỗi key 1 dòng hoặc cách nhau dấu phẩy để tự động xoay vòng)`}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {/* 2 Columns: Model OCR & Model Giải toán */}
          <div className="api-models-grid">
            {/* Column 1: Model OCR */}
            <div className="api-field-block">
              <label htmlFor="model-ocr-select" className="api-field-label">
                <Sparkles size={16} /> Model OCR Nhận diện:
              </label>
              <div className="api-select-wrapper">
                <select
                  id="model-ocr-select"
                  className="api-model-select"
                  value={selectedOcrModel}
                  onChange={(e) => setSelectedOcrModel(e.target.value as GeminiModel)}
                >
                  {OCR_MODEL_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Column 2: Model Giải toán / Tối ưu */}
            <div className="api-field-block">
              <label htmlFor="model-math-select" className="api-field-label">
                <Zap size={16} /> Model Giải toán / Tối ưu:
              </label>
              <div className="api-select-wrapper">
                <select
                  id="model-math-select"
                  className="api-model-select"
                  value={selectedMathModel}
                  onChange={(e) => setSelectedMathModel(e.target.value as MathSolverModel)}
                >
                  {MATH_MODEL_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Max Pages */}
          <div className="api-field-block">
            <label htmlFor="modal-max-pages" className="api-field-label">
              <Layers size={16} /> Số trang tối đa xử lý mỗi lượt:
            </label>
            <input
              id="modal-max-pages"
              type="number"
              min={1}
              max={100}
              value={selectedMaxPages}
              onChange={(e) => setSelectedMaxPages(Math.max(1, Math.min(100, Number(e.target.value) || 30)))}
            />
          </div>

          {/* Custom Prompt */}
          <div className="api-field-block">
            <label htmlFor="modal-custom-prompt" className="api-field-label">
              <MessageSquareCode size={16} /> Prompt bổ sung cho AI (tùy chọn):
            </label>
            <textarea
              id="modal-custom-prompt"
              className="prompt-textarea"
              rows={2}
              value={selectedCustomPrompt}
              onChange={(e) => setSelectedCustomPrompt(e.target.value)}
              placeholder="Ví dụ: Giữ nguyên số thứ tự câu hỏi; in đậm đáp án; không dịch tiếng Anh..."
            />
            <small className="field-note">
              Quy tắc LaTeX, bảng biểu và marker cắt ảnh được tự động gắn vào prompt lõi.
            </small>
          </div>

          {/* Health check results */}
          {healthResults && (
            <div className="api-health-results">
              <div className="api-health-heading">
                <Info size={16} /> Kết quả kiểm tra kết nối API:
              </div>
              <div className="api-health-list">
                {healthResults.map((res) => (
                  <div
                    key={res.keyIndex}
                    className={`api-health-item ${
                      res.status === 'success'
                        ? 'item-ok'
                        : res.status === 'rate_limit'
                        ? 'item-rate'
                        : res.status === 'auth_error'
                        ? 'item-auth'
                        : 'item-error'
                    }`}
                  >
                    <div className="api-health-item-status">
                      {res.status === 'success' ? (
                        <CheckCircle2 size={16} className="status-icon-ok" />
                      ) : res.status === 'rate_limit' ? (
                        <AlertTriangle size={16} className="status-icon-rate" />
                      ) : res.status === 'network_error' ? (
                        <WifiOff size={16} className="status-icon-net" />
                      ) : (
                        <AlertCircle size={16} className="status-icon-auth" />
                      )}
                      <strong>Key #{res.keyIndex + 1} ({res.maskedKey}):</strong>
                    </div>
                    <span className="api-health-item-msg">{res.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="api-modal-footer">
          <button
            type="button"
            className="api-btn-check"
            onClick={handleHealthCheck}
            disabled={isChecking}
          >
            {isChecking ? (
              <>
                <LoaderCircle size={15} className="spin" /> Đang kiểm tra...
              </>
            ) : (
              <>
                <CheckCircle2 size={15} /> Kiểm tra API Key
              </>
            )}
          </button>

          <div className="api-modal-footer-actions">
            <button
              type="button"
              className="api-btn-close"
              onClick={onClose}
            >
              Hủy
            </button>
            <button
              type="button"
              className="api-btn-save"
              onClick={handleSave}
            >
              Lưu Thiết Lập
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
