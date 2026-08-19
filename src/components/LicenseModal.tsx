import React, { useState } from 'react';
import {
  AlertTriangle,
  Award,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Crown,
  Download,
  Gift,
  HelpCircle,
  KeyRound,
  LoaderCircle,
  MessageCircle,
  QrCode,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import type { LicenseStatus } from '../services/licenseEngine';
import { activateLicenseKey } from '../services/licenseClient';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  status: LicenseStatus | null;
  onStatusUpdated: (newStatus: LicenseStatus) => void;
  onMessage: (msg: string, isError?: boolean) => void;
  forceRequired?: boolean;
}

export function LicenseModal({
  isOpen,
  onClose,
  status,
  onStatusUpdated,
  onMessage,
  forceRequired,
}: Props) {
  const [activationKey, setActivationKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const machineId = status?.machineId || 'MTH-LOADING...';
  const isActivated = Boolean(status?.isActivated && !status?.isExpired);
  const trialRemaining = status?.trialRemaining ?? 0;
  const trialMax = status?.trialMax ?? 5;
  const isTrialExpired = !isActivated && trialRemaining <= 0;

  async function handleCopyMachineId() {
    try {
      await navigator.clipboard.writeText(machineId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      onMessage('Đã sao chép Mã Máy vào bộ nhớ tạm!');
    } catch {
      onMessage('Không thể sao chép tự động, bạn hãy bôi đen và copy thủ công nhé.', true);
    }
  }

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    if (!activationKey.trim()) {
      setErrorMsg('Vui lòng nhập mã kích hoạt.');
      return;
    }

    setErrorMsg('');
    setSuccessMsg('');
    setIsSubmitting(true);

    try {
      const res = await activateLicenseKey(activationKey);
      if (res.success && res.status) {
        setSuccessMsg(res.message || 'Kích hoạt thành công!');
        onStatusUpdated(res.status);
        onMessage(res.message || 'Kích hoạt bản quyền thành công!');
        setActivationKey('');
        setTimeout(() => {
          setSuccessMsg('');
          if (!forceRequired) onClose();
        }, 2000);
      } else {
        setErrorMsg(res.message || 'Mã kích hoạt không đúng hoặc không khớp với mã máy này.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Lỗi kết nối máy chủ: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="license-modal-overlay" onClick={(e) => {
      if (e.target === e.currentTarget && !forceRequired) onClose();
    }}>
      <div className="license-modal-card">
        {/* Header */}
        <div className="license-modal-header">
          <div className="license-header-title">
            <div className="license-icon-badge">
              <ShieldCheck size={26} className="text-emerald-600" />
            </div>
            <div>
              <h3>Bản Quyền &amp; Kích Hoạt Ứng Dụng</h3>
              <p>Ứng dụng: <strong>pdf-to-word-mathtype</strong> (Chuyển đổi PDF sang Word Equation &amp; MathType)</p>
            </div>
          </div>
          {!forceRequired && (
            <button
              type="button"
              className="license-close-btn"
              onClick={onClose}
              title="Đóng cửa sổ"
            >
              <X size={20} />
            </button>
          )}
        </div>

        <div className="license-modal-body">
          {/* Trạng thái hiện tại */}
          <div className={`license-status-banner ${isActivated ? 'is-pro' : isTrialExpired ? 'is-expired' : 'is-trial'}`}>
            <div className="license-status-content">
              {isActivated ? (
                <>
                  <div className="license-status-icon pro-glow">
                    {status?.licenseType === 'lifetime' ? <Crown size={24} /> : <Award size={24} />}
                  </div>
                  <div>
                    <h4>{status?.licenseTypeText || 'Bản Quyền Pro'}</h4>
                    <p>
                      {status?.licenseType === 'lifetime'
                        ? 'Bạn đang sở hữu bản quyền Vĩnh Viễn cho ứng dụng pdf-to-word-mathtype (Sử dụng không giới hạn).'
                        : `Hạn sử dụng ứng dụng pdf-to-word-mathtype đến ngày: ${status?.expiresAtFormatted || '1 năm'}.`}
                    </p>
                  </div>
                </>
              ) : isTrialExpired ? (
                <>
                  <div className="license-status-icon expired-glow">
                    <AlertTriangle size={24} />
                  </div>
                  <div>
                    <h4>Đã Hết Lượt Dùng Thử (0/{trialMax})</h4>
                    <p>Bạn đã sử dụng hết lượt tải về của ứng dụng pdf-to-word-mathtype. Vui lòng kích hoạt bản quyền để tiếp tục xuất file.</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="license-status-icon trial-glow">
                    <Gift size={24} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4>Gói Dùng Thử Miễn Phí</h4>
                      <span className="trial-counter-badge font-bold">
                        Còn {trialRemaining}/{trialMax} lượt tải
                      </span>
                    </div>
                    <div className="license-progress-bar">
                      <div
                        className="license-progress-fill"
                        style={{ width: `${Math.min(100, (trialRemaining / trialMax) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Ứng dụng pdf-to-word-mathtype hỗ trợ toàn bộ định dạng: Word Equation, MathType (.docx, .doc) và Markdown LaTeX.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Machine ID Box */}
          <div className="license-hwid-card">
            <div className="license-hwid-header">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5 text-sm">
                <KeyRound size={16} className="text-indigo-600" />
                Mã Máy Của Bạn (Hardware ID):
              </span>
              <span className="text-xs text-slate-400">Dùng để tạo mã kích hoạt</span>
            </div>
            <div className="license-hwid-box">
              <input
                type="text"
                readOnly
                value={machineId}
                className="license-hwid-input"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                type="button"
                className={`license-copy-btn ${copied ? 'copied' : ''}`}
                onClick={handleCopyMachineId}
              >
                {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                {copied ? 'Đã Copy' : 'Copy Mã Máy'}
              </button>
            </div>
            <p className="license-hwid-hint">
              💡 Hãy copy Mã Máy này và gửi qua Zalo <strong>0988.250.112</strong> để nhận mã kích hoạt cho ứng dụng <strong>pdf-to-word-mathtype</strong>.
            </p>
          </div>

          {/* Form nhập Mã kích hoạt */}
          <form onSubmit={handleActivate} className="license-activate-form">
            <label className="block text-sm font-bold text-slate-700 mb-1.5 flex items-center justify-between">
              <span>Nhập Mã Kích Hoạt (Hoặc Mã Gia Hạn):</span>
              <span className="text-xs text-indigo-600 font-normal">Hỗ trợ PRO1Y-, LIFE-, EXT...</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={activationKey}
                onChange={(e) => setActivationKey(e.target.value.toUpperCase())}
                placeholder="VD: PRO1Y-XXXX-XXXX-XXXX-XXXX hoặc LIFE-..."
                className="license-key-input"
                disabled={isSubmitting}
              />
              <button
                type="submit"
                className="license-submit-btn"
                disabled={isSubmitting || !activationKey.trim()}
              >
                {isSubmitting ? (
                  <LoaderCircle size={18} className="spin" />
                ) : (
                  <Sparkles size={18} />
                )}
                {isSubmitting ? 'Đang kiểm tra...' : 'Kích Hoạt'}
              </button>
            </div>

            {errorMsg && (
              <div className="license-alert error">
                <AlertTriangle size={16} />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="license-alert success">
                <CheckCircle2 size={16} />
                <span>{successMsg}</span>
              </div>
            )}
          </form>

          {/* Bảng Các Gói Bản Quyền */}
          <div className="license-pricing-section">
            <h4 className="license-section-title">
              <Crown size={18} className="text-amber-500" />
              Các Gói Bản Quyền Ứng Dụng pdf-to-word-mathtype
            </h4>
            <div className="license-pricing-grid">
              {/* Gói 1 Năm */}
              <div className="license-plan-card">
                <div className="license-plan-badge">GÓI 1 NĂM</div>
                <h5>Gói Pro 1 Năm</h5>
                <p className="text-xs text-slate-500 mb-3 mt-1">Sử dụng đầy đủ tính năng trong 365 ngày</p>
                <ul className="license-plan-features">
                  <li><Check size={14} /> Xuất Word Equation &amp; MathType <strong>không giới hạn</strong></li>
                  <li><Check size={14} /> Sử dụng đầy đủ các Model Gemini mới nhất</li>
                  <li><Check size={14} /> Thời hạn sử dụng 365 ngày</li>
                  <li><Check size={14} /> Hỗ trợ kỹ thuật 24/7</li>
                </ul>
              </div>

              {/* Gói Vĩnh Viễn */}
              <div className="license-plan-card featured">
                <div className="license-plan-badge highlight">PHỔ BIẾN NHẤT</div>
                <h5>Gói Pro Vĩnh Viễn</h5>
                <p className="text-xs text-indigo-600 font-medium mb-3 mt-1">Mở khóa trọn đời theo máy tính</p>
                <ul className="license-plan-features">
                  <li><Check size={14} /> <strong>Mở khóa trọn đời</strong> theo máy tính</li>
                  <li><Check size={14} /> Tải file không giới hạn mãi mãi</li>
                  <li><Check size={14} /> Miễn phí nâng cấp tất cả phiên bản mới</li>
                  <li><Check size={14} /> Hỗ trợ ưu tiên qua Zalo / Teamviewer</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Thông tin thanh toán & Zalo Admin */}
          <div className="license-payment-box">
            <div className="license-payment-header">
              <CreditCard size={18} className="text-blue-600" />
              <span>Thông Tin Nhận Mã Kích Hoạt Ứng Dụng pdf-to-word-mathtype:</span>
            </div>
            <div className="license-payment-details">
              <div className="payment-bank-info">
                <div className="bank-row">
                  <span className="bank-label">Ngân Hàng:</span>
                  <span className="bank-val font-bold text-blue-700">MB Bank (Quân Đội)</span>
                </div>
                <div className="bank-row">
                  <span className="bank-label">Số Tài Khoản:</span>
                  <span className="bank-val font-bold font-mono text-emerald-700 text-base">0988250112</span>
                </div>
                <div className="bank-row">
                  <span className="bank-label">Chủ Tài Khoản:</span>
                  <span className="bank-val font-semibold">NGUYEN VAN THIEN</span>
                </div>
                <div className="bank-row">
                  <span className="bank-label">Nội Dung:</span>
                  <span className="bank-val font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-indigo-700">
                    MathOCR {machineId.substring(0, 8)}
                  </span>
                </div>
              </div>

              <div className="payment-zalo-cta">
                <a
                  href="https://zalo.me/0988250112"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-primary zalo-btn"
                >
                  <MessageCircle size={18} />
                  Nhắn Zalo: 0988.250.112
                </a>
                <span className="text-[11px] text-slate-500 text-center block mt-1.5">
                  (Gửi biên lai & Mã máy qua Zalo để nhận mã trong 1 phút)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="license-modal-footer">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck size={15} className="text-emerald-500" />
            <span>Mã kích hoạt gắn liền với phần cứng thiết bị và đồng bộ trên mọi trình duyệt.</span>
          </div>
          {!forceRequired && (
            <button
              type="button"
              className="button button-light"
              onClick={onClose}
            >
              Đóng
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
