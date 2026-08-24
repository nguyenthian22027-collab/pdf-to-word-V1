# 🚀 Google Gemini API Toolkit (Multi-Key, Ping Test & Auto-Failover)

Module đóng gói trọn gói toàn bộ hệ thống API Gemini để sử dụng cho dự án khác (ví dụ: `D:\tao-phieu-hoc-tap-den-trang`).

---

## 📦 Cách tích hợp vào dự án `D:\tao-phieu-hoc-tap-den-trang`

### Bước 1: Cài đặt thư viện phụ thuộc
Mở terminal tại thư mục `D:\tao-phieu-hoc-tap-den-trang` và chạy:
```bash
npm install @google/genai lucide-react
```

### Bước 2: Sao chép thư mục
Copy toàn bộ thư mục `gemini-api-toolkit` này vào `D:\tao-phieu-hoc-tap-den-trang/src/modules/`

---

## 💻 Cách sử dụng trong code

### 1. Hiển thị Modal Cài đặt API
```tsx
import React, { useState } from 'react';
import { ApiSettingsModal, GeminiModel } from './modules/gemini-api-toolkit';

export function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [apiKeysText, setApiKeysText] = useState(localStorage.getItem('gemini_api_keys') || '');
  const [model, setModel] = useState<GeminiModel>((localStorage.getItem('gemini_model') as GeminiModel) || 'auto');

  const handleSave = (newKeys: string, newModel: GeminiModel) => {
    setApiKeysText(newKeys);
    setModel(newModel);
    localStorage.setItem('gemini_api_keys', newKeys);
    localStorage.setItem('gemini_model', newModel);
  };

  return (
    <div>
      <button onClick={() => setIsModalOpen(true)}>⚙️ Cài đặt API Keys</button>

      <ApiSettingsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        rawApiKeyText={apiKeysText}
        currentGeminiModel={model}
        onSave={handleSave}
      />
    </div>
  );
}
```

### 2. Gọi AI tạo nội dung phiếu học tập (Tự động xoay vòng Key & Model)
```typescript
import { callGeminiWithFailover } from './modules/gemini-api-toolkit';

async function generatePhieuHocTap(promptText: string) {
  const apiKeysText = localStorage.getItem('gemini_api_keys') || '';
  const model = (localStorage.getItem('gemini_model') as any) || 'auto';

  try {
    const result = await callGeminiWithFailover({
      prompt: promptText,
      apiKeysText: apiKeysText,
      model: model,
      systemInstruction: 'Bạn là chuyên gia tạo phiếu học tập đen trắng cho học sinh...',
      onStreamText: (partialText) => {
        console.log('Đang nhận dữ liệu stream:', partialText);
      }
    });

    console.log('Hoàn thành:', result);
    return result;
  } catch (error) {
    console.error('Lỗi khi gọi AI:', error);
    alert(`Lỗi: ${error}`);
  }
}
```
