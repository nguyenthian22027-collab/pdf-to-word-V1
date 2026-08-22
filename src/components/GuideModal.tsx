import React, { useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  ExternalLink,
  FileCode,
  FileEdit,
  FileText,
  HelpCircle,
  KeyRound,
  Keyboard,
  Lightbulb,
  Play,
  Settings,
  Sparkles,
  Wand2,
  X,
  Zap,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onOpenApiSettings?: () => void;
}

type GuideTab = 'pdf-ocr' | 'chat-latex' | 'mathtype-tips';

export function GuideModal({ isOpen, onClose, onOpenApiSettings }: Props) {
  const [activeTab, setActiveTab] = useState<GuideTab>('pdf-ocr');

  if (!isOpen) return null;

  return (
    <div className="guide-modal-overlay" onClick={onClose}>
      <div
        className="guide-modal-content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Modal Header */}
        <div className="guide-modal-header">
          <div className="guide-modal-title">
            <span className="guide-modal-title-icon">
              <BookOpen size={22} />
            </span>
            <div>
              <h3>Hướng Dẫn Sử Dụng Chi Tiết</h3>
              <small>Học cách sử dụng nhanh tất cả tính năng của MathConverter Pro</small>
            </div>
          </div>
          <button
            type="button"
            className="guide-modal-close-btn"
            onClick={onClose}
            aria-label="Đóng hướng dẫn"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Tab Navigation */}
        <div className="guide-tabs-bar">
          <button
            type="button"
            className={`guide-tab-btn ${activeTab === 'pdf-ocr' ? 'active' : ''}`}
            onClick={() => setActiveTab('pdf-ocr')}
          >
            <KeyRound size={16} />
            <span>1. Nhập API &amp; Chuyển PDF/Ảnh</span>
          </button>
          <button
            type="button"
            className={`guide-tab-btn ${activeTab === 'chat-latex' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat-latex')}
          >
            <Bot size={16} />
            <span>2. Copy từ ChatGPT/Gemini sang Word</span>
          </button>
          <button
            type="button"
            className={`guide-tab-btn ${activeTab === 'mathtype-tips' ? 'active' : ''}`}
            onClick={() => setActiveTab('mathtype-tips')}
          >
            <Keyboard size={16} />
            <span>3. Mẹo sửa lỗi EMBED trong Word</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="guide-modal-body">
          {/* TAB 1: PDF/IMAGE OCR & API KEY */}
          {activeTab === 'pdf-ocr' && (
            <div className="guide-section">
              <div className="guide-intro-banner">
                <Sparkles size={20} className="text-indigo-600" />
                <div>
                  <h4>Chuyển đổi tài liệu PDF &amp; Ảnh sang Word bằng Gemini AI</h4>
                  <p>
                    Để phần mềm có thể nhận diện công thức Toán, bảng biểu và tự động cắt hình minh họa,
                    bạn chỉ cần lấy <strong>Gemini API Key miễn phí từ Google</strong>.
                  </p>
                </div>
              </div>

              <div className="guide-steps-list">
                {/* Step 1 */}
                <div className="guide-step-card">
                  <div className="guide-step-badge">Bước 1</div>
                  <div className="guide-step-content">
                    <h5>Lấy API Key Google Gemini miễn phí</h5>
                    <p>
                      Truy cập trang tạo khóa chính thức của Google tại{' '}
                      <a
                        href="https://aistudio.google.com/app/apikey"
                        target="_blank"
                        rel="noreferrer"
                        className="guide-link"
                      >
                        Google AI Studio &rarr; Get API Key <ExternalLink size={13} style={{ display: 'inline' }} />
                      </a>
                    </p>
                    <div className="guide-tip-box">
                      <Lightbulb size={16} />
                      <span>
                        Đăng nhập tài khoản Google &rarr; Nhấn nút <strong>Create API Key</strong> &rarr; Sao chép chuỗi khóa bắt đầu bằng chữ <code className="guide-code">AIzaSy...</code>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="guide-step-card">
                  <div className="guide-step-badge">Bước 2</div>
                  <div className="guide-step-content">
                    <h5>Nhập API Key vào phần mềm</h5>
                    <p>
                      Nhấn vào nút <strong>"⚙ Thiết lập OCR &amp; API"</strong> ở góc trên thanh Header của phần mềm, sau đó dán chuỗi API Key vào ô danh sách và nhấn <strong>Lưu Thiết Lập</strong>.
                    </p>
                    {onOpenApiSettings && (
                      <button
                        type="button"
                        className="button button-light guide-action-btn"
                        onClick={() => {
                          onClose();
                          onOpenApiSettings();
                        }}
                      >
                        <Settings size={15} /> Mở cửa sổ Thiết lập OCR &amp; API ngay
                      </button>
                    )}
                    <div className="guide-tip-box info">
                      <Sparkles size={16} />
                      <span>
                        <strong>Mẹo hay:</strong> Bạn có thể dán nhiều API Key (mỗi key 1 dòng). Phần mềm sẽ tự động xoay vòng qua key khác khi một key chạm giới hạn hạn ngạch Quota!
                      </span>
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="guide-step-card">
                  <div className="guide-step-badge">Bước 3</div>
                  <div className="guide-step-content">
                    <h5>Tải file và Xuất sang Word</h5>
                    <ul className="guide-bullet-list">
                      <li>Kéo thả file PDF / Ảnh vào khung tải tài liệu hoặc nhấn <kbd className="guide-kbd">Ctrl + V</kbd> để dán ảnh chụp màn hình trực tiếp.</li>
                      <li>Nhấn nút <strong>"Bắt đầu chuyển đổi"</strong>.</li>
                      <li>Sau khi xử lý xong, nhấn <strong>"Xuất Word Equation (.docx)"</strong> hoặc <strong>"Xuất Word MathType OLE"</strong> để tải file Word về máy.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: COPY FROM CHATGPT / GEMINI TO WORD */}
          {activeTab === 'chat-latex' && (
            <div className="guide-section">
              <div className="guide-intro-banner">
                <Bot size={20} className="text-indigo-600" />
                <div>
                  <h4>Cách chuyển đổi nội dung copy từ ChatGPT / Gemini / DeepSeek sang Word</h4>
                  <p>
                    Khi bạn hỏi bài tập Toán trên ChatGPT, Gemini, Claude hoặc DeepSeek, AI thường trả về các công thức dạng mã LaTeX (ví dụ: <code className="guide-code">{'$x = \\frac{-b \\pm \\sqrt{\\Delta}}{2a}$'}</code>). Tính năng này giúp biến các mã đó thành công thức Word thật 100%!
                  </p>
                </div>
              </div>

              <div className="guide-steps-list">
                {/* Step 1 */}
                <div className="guide-step-card">
                  <div className="guide-step-badge">Bước 1</div>
                  <div className="guide-step-content">
                    <h5>Sao chép câu trả lời từ AI Chat</h5>
                    <p>
                      Trên giao diện ChatGPT / Gemini / DeepSeek, nhấn nút <strong>Copy (Sao chép)</strong> toàn bộ lời giải hoặc đoạn văn bản có chứa công thức Toán học.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="guide-step-card">
                  <div className="guide-step-badge">Bước 2</div>
                  <div className="guide-step-content">
                    <h5>Mở Tab "Chuyển đổi File Word &amp; LaTeX"</h5>
                    <p>
                      Trên thanh chuyển chế độ của phần mềm, bấm vào tab <strong>"Chuyển đổi File Word (.docx, .doc) &amp; LaTeX"</strong>.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="guide-step-card">
                  <div className="guide-step-badge">Bước 3</div>
                  <div className="guide-step-content">
                    <h5>Dán nội dung vào ô soạn thảo</h5>
                    <p>
                      Dán nội dung vừa copy vào ô bên trái (hoặc nhấn nút <strong>"Dán từ Clipboard"</strong>). Khung bên phải sẽ tự động hiển thị xem trước công thức Toán học chuẩn xác theo thời gian thực!
                    </p>
                    <div className="guide-tip-box success">
                      <Wand2 size={16} />
                      <span>
                        <strong>Tự động sửa lỗi:</strong> Nếu công thức AI tạo ra bị lỗi cú pháp, hãy nhấn nút <strong>"✨ AI Tối Ưu &amp; Sửa Lỗi LaTeX"</strong> để Gemini tự động rà soát và chuẩn hóa toàn bộ công thức cho bạn.
                      </span>
                    </div>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="guide-step-card">
                  <div className="guide-step-badge">Bước 4</div>
                  <div className="guide-step-content">
                    <h5>Xuất ra file Word (.docx)</h5>
                    <p>
                      Nhấn nút <strong>"Xuất Word (.docx)"</strong> (công thức dạng Equation chuẩn Word) hoặc <strong>"Xuất Word MathType OLE"</strong> (công thức MathType thật) ở góc dưới cùng bên phải để tải file về máy.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MATHTYPE TIPS & EMBED FIX */}
          {activeTab === 'mathtype-tips' && (
            <div className="guide-section">
              <div className="guide-intro-banner">
                <Keyboard size={20} className="text-indigo-600" />
                <div>
                  <h4>Mẹo sửa hiện tượng chữ {`{ EMBED Equation.DSMT4 }`} trong Word</h4>
                  <p>
                    Khi mở file Word MathType mà bạn thấy xuất hiện dòng chữ <code className="guide-code">{`{ EMBED Equation.DSMT4 }`}</code> thay vì hình vẽ công thức, đừng lo lắng! File hoàn toàn bình thường và không bị lỗi.
                  </p>
                </div>
              </div>

              <div className="guide-steps-list">
                {/* Method 1 */}
                <div className="guide-step-card">
                  <div className="guide-step-badge">Cách 1</div>
                  <div className="guide-step-content">
                    <h5>Bấm phím tắt trên bàn phím (Nhanh nhất - 1 giây)</h5>
                    <p>
                      Trong cửa sổ Microsoft Word đang mở file, bạn chỉ cần nhấn tổ hợp phím:
                    </p>
                    <div className="guide-shortcut-box">
                      <kbd className="guide-kbd">Alt</kbd> + <kbd className="guide-kbd">F9</kbd>
                      <span className="guide-shortcut-note">(Đối với laptop có phím Fn: nhấn <kbd className="guide-kbd">Fn</kbd> + <kbd className="guide-kbd">Alt</kbd> + <kbd className="guide-kbd">F9</kbd>)</span>
                    </div>
                    <p style={{ marginTop: '8px', color: '#166534', fontWeight: 700 }}>
                      ✓ Ngay lập tức toàn bộ mã kỹ thuật sẽ biến thành công thức MathType sắc nét!
                    </p>
                  </div>
                </div>

                {/* Method 2 */}
                <div className="guide-step-card">
                  <div className="guide-step-badge">Cách 2</div>
                  <div className="guide-step-content">
                    <h5>Tắt vĩnh viễn trong Cài đặt của Microsoft Word</h5>
                    <p>Để Microsoft Word luôn luôn hiển thị công thức và không bao giờ hiện mã trường nữa:</p>
                    <ol className="guide-numbered-list">
                      <li>Trên Word, vào menu <strong>File</strong> (Tệp) &rarr; Chọn <strong>Options</strong> (Tùy chọn) ở góc dưới cùng bên trái.</li>
                      <li>Trong bảng cài đặt hiện ra, chọn mục <strong>Advanced</strong> (Nâng cao).</li>
                      <li>Cuộn xuống phần <strong>Show document content</strong> (Hiển thị nội dung tài liệu).</li>
                      <li><strong>BỎ TÍCH</strong> ở ô: <strong>"Show field codes instead of their values"</strong> *(Hiển thị mã trường thay vì giá trị)*.</li>
                      <li>Nhấn <strong>OK</strong> để lưu lại.</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="guide-modal-footer">
          <span className="guide-footer-hint">
            <HelpCircle size={15} /> Cần hỗ trợ thêm? Liên hệ Zalo qua cửa sổ Bản quyền
          </span>
          <button
            type="button"
            className="button button-primary"
            onClick={onClose}
          >
            Đã Hiểu &amp; Bắt Đầu Dùng
          </button>
        </div>
      </div>
    </div>
  );
}
