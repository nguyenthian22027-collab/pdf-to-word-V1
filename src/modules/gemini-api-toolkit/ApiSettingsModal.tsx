import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Lightbulb,
  LoaderCircle,
  Settings,
  Sparkles,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import type { ApiKeyHealthResult, GeminiModel } from './types';
import { checkMultipleApiKeysHealth, parseApiKeys } from './apiHealthService';
import './ApiSettingsModal.css';

export const OCR_MODEL_OPTIONS: Array<{ id: GeminiModel; label: string }> = [
  { id: 'gemini-3.7-flash', label: '🌟 gemini-3.7-flash (Mới Nhất / Siêu Nhanh & Chuẩn)' },
  { id: 'gemini-3.5-flash', label: '🌟 gemini-3.5-flash (Thế hệ 3.5)' },
  { id: 'gemini-3.0-flash', label: '🚀 gemini-3.0-flash (Thế hệ 3.0 Siêu Nhanh)' },
  { id: 'gemini-3.1-flash-lite', label: '⚡ gemini-3.1-flash-lite (Hạn ngạch Quota cực cao)' },
  { id: 'gemini-3.6-flash', label: '💥 gemini-3.6-flash (Tối ưu)' },
  { id: 'gemini-2.0-flash', label: '💎 gemini-2.0-flash (Ổn định, Đọc tài liệu cực tốt)' },
  { id: 'gemini-1.5-flash', label: '🔷 gemini-1.5-flash (Chuẩn Google)' },
  { id: 'gemini-1.5-pro', label: '🧠 gemini-1.5-pro (Độ chính xác cao)' },
  { id: 'auto', label: '🔄 Tự động xoay vòng Model (Auto Failover)' },
];

export interface ApiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  rawApiKeyText: string;
  currentGeminiModel: GeminiModel;
  onSave: (apiKeysText: string, geminiModel: GeminiModel) => void;
}

export function ApiSettingsModal({
  isOpen,
  onClose,
  rawApiKeyText,
  currentGeminiModel,
  onSave,
}: ApiSettingsModalProps) {
  const [apiKeyInput, setApiKeyInput] = useState(rawApiKeyText);
  const [selectedOcrModel, setSelectedOcrModel] = useState<GeminiModel>(currentGeminiModel);
  const [isChecking, setIsChecking] = useState(false);
  const [healthResults, setHealthResults] = useState<ApiKeyHealthResult[] | null>(null);

  useEffect(() => {
    if (isOpen) {
      setApiKeyInput(rawApiKeyText);
      setSelectedOcrModel(currentGeminiModel);
      setHealthResults(null);
    }
  }, [isOpen, rawApiKeyText, currentGeminiModel]);

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
    onSave(apiKeyInput.trim(), selectedOcrModel);
    onClose();
  }

  return (
    <div className="gemini-api-modal-overlay" onClick={onClose}>
      <div
        className="gemini-api-modal-content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="gemini-api-modal-header">
          <div className="gemini-api-modal-title">
            <span className="gemini-api-modal-title-icon">
              <Settings size={20} />
            </span>
            <h3>Thiết lập Google Gemini API</h3>
          </div>
          <div className="gemini-api-modal-header-right">
            <span className={`gemini-api-key-badge ${keyCount > 0 ? 'gemini-badge-has-keys' : 'gemini-badge-empty'}`}>
              {keyCount} Key{keyCount > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              className="gemini-api-modal-close-btn"
              onClick={onClose}
              aria-label="Đóng"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="gemini-api-modal-body">
          {/* Info callout note */}
          <div className="gemini-api-notice-box">
            <div className="gemini-api-notice-title">
              <Lightbulb size={18} />
              <strong>Lưu ý về API Key Google Gemini:</strong>
            </div>
            <p className="gemini-api-notice-text">
              Key chính thức từ <strong>Google AI Studio</strong> bắt đầu bằng <code className="gemini-api-code-highlight">AIzaSy...</code>
            </p>
            <p className="gemini-api-notice-subtext">
              Lấy key miễn phí tại{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="gemini-api-link"
              >
                Google AI Studio &rarr; Get API Key <ExternalLink size={12} style={{ display: 'inline' }} />
              </a>
            </p>
          </div>

          {/* Multiple API Keys Textarea */}
          <div className="gemini-api-field-block">
            <div className="gemini-api-field-label-row">
              <label htmlFor="gemini-api-keys-input" className="gemini-api-field-label">
                <KeyRound size={16} /> Danh sách Gemini API Keys:
              </label>
              {keyCount > 0 && (
                <span className="gemini-api-key-valid-indicator">
                  ✓ Đã nhận diện {keyCount} key
                </span>
              )}
            </div>
            <textarea
              id="gemini-api-keys-input"
              className="gemini-api-keys-textarea"
              rows={3}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={`AIzaSy...\nAIzaSy... (Nhập nhiều key, mỗi key 1 dòng hoặc cách nhau dấu phẩy)`}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          {/* Model Selection */}
          <div className="gemini-api-models-grid">
            <div className="gemini-api-field-block">
              <label htmlFor="gemini-model-select" className="gemini-api-field-label">
                <Sparkles size={16} /> Chọn Model AI:
              </label>
              <div className="gemini-api-select-wrapper">
                <select
                  id="gemini-model-select"
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
          </div>

          {/* Ping Test Section */}
          <div className="gemini-api-health-section">
            <button
              type="button"
              className="gemini-api-health-btn"
              onClick={handleHealthCheck}
              disabled={isChecking || keyCount === 0}
            >
              {isChecking ? (
                <LoaderCircle size={16} className="gemini-spin" />
              ) : (
                <Zap size={16} />
              )}
              {isChecking ? 'Đang kiểm tra kết nối...' : 'Kiểm tra hoạt động API (Ping Test)'}
            </button>

            {healthResults && (
              <div className="gemini-api-health-results-table">
                {healthResults.map((res, idx) => (
                  <div
                    key={idx}
                    className={`gemini-api-health-item ${
                      res.status === 'success'
                        ? 'status-success'
                        : res.status === 'rate_limit'
                        ? 'status-rate_limit'
                        : 'status-error'
                    }`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {res.status === 'success' && <CheckCircle2 size={16} color="#16a34a" />}
                      {res.status === 'rate_limit' && <AlertTriangle size={16} color="#d97706" />}
                      {res.status === 'auth_error' && <AlertCircle size={16} color="#dc2626" />}
                      {res.status === 'network_error' && <WifiOff size={16} color="#dc2626" />}
                      <strong>Key #{res.keyIndex + 1} ({res.maskedKey})</strong>
                    </div>
                    <span>{res.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="gemini-api-modal-footer">
          <button type="button" className="gemini-btn-secondary" onClick={onClose}>
            Hủy
          </button>
          <button type="button" className="gemini-btn-primary" onClick={handleSave}>
            Lưu Cài Đặt
          </button>
        </div>
      </div>
    </div>
  );
}
