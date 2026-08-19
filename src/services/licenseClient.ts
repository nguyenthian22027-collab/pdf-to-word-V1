import type { LicenseStatus } from './licenseEngine';

const API_BASE = '';

/**
 * Lấy trạng thái bản quyền & số lượt dùng thử hiện tại từ Local Server
 */
export async function getLicenseStatus(): Promise<LicenseStatus> {
  try {
    const res = await fetch(`${API_BASE}/api/license/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    const data = await res.json();
    return data.status;
  } catch (error) {
    console.warn('[LicenseClient] Không kết nối được local license server, dùng fallback client:', error);
    // Fallback nếu chạy ở môi trường web tĩnh
    return {
      machineId: 'MTH-LOCAL-HOST-DEV0',
      isActivated: false,
      licenseType: 'trial',
      licenseTypeText: 'Gói Dùng Thử',
      trialRemaining: 5,
      trialUsed: 0,
      trialMax: 5,
      isExpired: false,
    };
  }
}

/**
 * Kiểm tra & trừ 1 lượt tải file (Áp dụng cho mọi hình thức: Word Equation, MathType, .doc, .md)
 * @param formatName Tên định dạng đang tải (VD: "Word Equation", "Word MathType", "Markdown .md")
 */
export async function consumeDownloadQuota(
  formatName: string
): Promise<{ success: boolean; allowed: boolean; remaining?: number; message?: string; reason?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/license/consume-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formatName }),
    });
    const data = await res.json();
    return data;
  } catch (error) {
    console.warn('[LicenseClient] Lỗi kết nối khi trừ lượt tải:', error);
    return {
      success: true,
      allowed: true,
      remaining: 5,
      message: 'Đang chạy chế độ ngoại tuyến.',
    };
  }
}

/**
 * Gửi Mã Kích Hoạt (1 Năm / Vĩnh Viễn / Gia Hạn) lên Server để kích hoạt
 */
export async function activateLicenseKey(
  key: string
): Promise<{ success: boolean; message: string; status?: LicenseStatus }> {
  try {
    const res = await fetch(`${API_BASE}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key.trim().toUpperCase() }),
    });
    const data = await res.json();
    return data;
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Không thể kết nối đến máy chủ kích hoạt: ${err}`,
    };
  }
}

/**
 * Sinh mã kích hoạt nội bộ (khi cần Admin Keygen trên giao diện)
 */
export async function generateAdminKey(
  hwid: string,
  type: '1YEAR' | 'LIFETIME' | 'EXTEND',
  val = 5
): Promise<{ success: boolean; key?: string; message?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/license/admin-generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hwid, type, val }),
    });
    const data = await res.json();
    return data;
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return { success: false, message: err };
  }
}
