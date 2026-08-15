# AIOMT OCR PDF/Image — Web v1.3 + PyMuPDF Crop v2.1

Ứng dụng React + TypeScript + Vite giao diện teal, OCR PDF/ảnh và xuất Word Equation hoặc MathType OLE.

## Tính năng

- Tải PDF hoặc tối đa 30 ảnh PNG/JPG/JPEG/WebP.
- Dán ảnh bằng Ctrl+V.
- Gemini API key nhập trên giao diện và lưu trong `localStorage`.
- Gemini gửi nguyên PDF trong một request; `maxOutputTokens: 65_536`.
- OCR LaTeX, bảng Markdown và marker hình theo tọa độ 0–1000.
- Gemini lần 2 nhìn riêng ảnh trang để định vị lại bbox.
- Backend PyMuPDF cắt trực tiếp từ file gốc bằng `/api/crop-document`.
- Tự chừa biên riêng cho đồ thị và hình học để hạn chế lẹm đầu mũi tên, tên trục, tên điểm, cạnh và nét đứt.
- Không dò vùng đậm nhất và không dịch tâm bbox, tránh nhảy sang bảng hoặc đoạn văn gần đó.
- Hình xuất hiện trực tiếp trong tab xem trước và được nhúng vào Word.
- Bấm hình để phóng to, thu nhỏ hoặc tải riêng.
- Xuất Word giữ LaTeX, Equation/OMML và MathType OLE.
- Không kèm `package-lock.json`, `node_modules` hoặc `dist`.

## Chạy frontend

```bash
npm install
npm run dev
```

Kiểm tra production:

```bash
npm run build
```

## Triển khai backend PyMuPDF

Thư mục `pdf-render-backend` là backend FastAPI độc lập.

Trên Render:

1. Tạo Web Service từ GitHub.
2. Root Directory: `pdf-render-backend`.
3. Runtime: Docker.
4. Sau khi deploy, kiểm tra:

```text
https://TEN-DICH-VU.onrender.com/health
```

Kết quả:

```json
{"ok":true,"version":"2.1.0","crop":true,"edgeSafePadding":true}
```

## API backend hardcode (không dùng biến môi trường)

Ba URL backend được cấu hình trực tiếp trong `src/config/apiConfig.ts`:

```ts
const HARD_CODED_API = {
  pdfRender: 'https://TEN-DICH-VU.onrender.com',
  pandoc: 'https://TEN-PANDOC/convert',
  mathType: 'https://TEN-MATHTYPE',
} as const;
```

- `pdfRender`: URL gốc backend PyMuPDF; app tự nối `/api/render-pdf` và `/api/crop-document`.
- `pandoc`: URL đầy đủ endpoint nhận `POST { markdown }`.
- `mathType`: URL gốc backend MathType; app tự nối `/api/convert-markdown`.

Không cần khai báo biến môi trường trên Vercel. Khi đổi máy chủ, chỉ sửa 3 chuỗi trên rồi build/redeploy frontend.

## Luồng xử lý hình

```text
PDF gốc
→ Gemini OCR + mô tả/vị trí hình
→ PyMuPDF render trang PNG
→ Gemini lần 2 hiệu chỉnh bbox
→ backend cắt trực tiếp từ PDF gốc + chừa biên theo loại hình
→ preview trên web
→ nhúng vào Word
```
