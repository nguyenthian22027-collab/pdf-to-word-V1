import {
  formatMachineId,
  generateLicenseKey,
  verifyLicenseKey,
  type LicenseStatus,
  type LicenseVaultData,
} from './licenseEngine';

const API_BASE = '';
const WEB_VAULT_STORAGE_KEY = 'mathocr_web_license_vault_v1';
const LEGACY_FALLBACK_HWID = 'MTH-LOCAL-HOST-DEV0';

/**
 * Sinh mã máy duy nhất cho trình duyệt khi chạy trên Web tĩnh (Vercel)
 */
function generateBrowserMachineId(): string {
  try {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Browser';
    const lang = typeof navigator !== 'undefined' ? navigator.language : 'vi';
    const screenRes =
      typeof window !== 'undefined' && window.screen
        ? `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`
        : '1920x1080x24';
    const timezone =
      typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Ho_Chi_Minh';
    const randomPart = Math.random().toString(36).substring(2, 12);
    const raw = `${userAgent}__${lang}__${screenRes}__${timezone}__${randomPart}`;
    return formatMachineId(raw);
  } catch {
    return `MTH-WEB-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  }
}

/**
 * Đọc Vault từ localStorage của trình duyệt
 */
function readWebVault(): LicenseVaultData {
  const defaultVault: LicenseVaultData = {
    version: 1,
    machineId: generateBrowserMachineId(),
    isActivated: false,
    licenseType: 'trial',
    trialUsed: 0,
    trialMax: 5,
    lastSeenTimestamp: Date.now(),
  };

  if (typeof window === 'undefined' || !window.localStorage) {
    return defaultVault;
  }

  try {
    const raw = localStorage.getItem(WEB_VAULT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.machineId) {
        return {
          ...defaultVault,
          ...parsed,
          trialUsed: typeof parsed.trialUsed === 'number' ? parsed.trialUsed : 0,
          trialMax: typeof parsed.trialMax === 'number' ? parsed.trialMax : 5,
          lastSeenTimestamp: Date.now(),
        };
      }
    }
  } catch (err) {
    console.warn('[LicenseClient] Lỗi đọc Web Vault từ localStorage:', err);
  }

  // Khởi tạo mới nếu chưa có
  saveWebVault(defaultVault);
  return defaultVault;
}

/**
 * Lưu Vault vào localStorage của trình duyệt
 */
function saveWebVault(vault: LicenseVaultData): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(WEB_VAULT_STORAGE_KEY, JSON.stringify(vault));
  } catch (err) {
    console.warn('[LicenseClient] Không lưu được Web Vault vào localStorage:', err);
  }
}

/**
 * Chuyển đổi dữ liệu Vault thành đối tượng trạng thái hiển thị LicenseStatus
 */
function getStatusFromWebVault(vault: LicenseVaultData): LicenseStatus {
  const now = Date.now();
  let isActivated = Boolean(vault.isActivated);
  let isExpired = false;
  let licenseTypeText = 'Gói Dùng Thử';

  if (isActivated) {
    if (vault.licenseType === 'lifetime') {
      licenseTypeText = 'Bản Pro Vĩnh Viễn';
    } else if (vault.licenseType === '1year') {
      if (vault.expiresAt && now > vault.expiresAt) {
        isExpired = true;
        isActivated = false;
        licenseTypeText = 'Bản 1 Năm (Đã Hết Hạn)';
      } else {
        licenseTypeText = 'Bản Pro 1 Năm';
      }
    }
  }

  const trialRemaining = Math.max(0, vault.trialMax - vault.trialUsed);
  if (!isActivated && trialRemaining <= 0) {
    isExpired = true;
    licenseTypeText = 'Hết Lượt Dùng Thử';
  }

  const formatTime = (ts?: number) => {
    if (!ts) return undefined;
    const d = new Date(ts);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1)
      .toString()
      .padStart(2, '0')}/${d.getFullYear()}`;
  };

  return {
    machineId: vault.machineId,
    isActivated,
    licenseType: vault.licenseType,
    licenseTypeText,
    trialRemaining,
    trialUsed: vault.trialUsed,
    trialMax: vault.trialMax,
    isExpired,
    expiresAt: vault.expiresAt,
    expiresAtFormatted: formatTime(vault.expiresAt),
    activatedAtFormatted: formatTime(vault.activatedAt),
  };
}

/**
 * Gọi HTTP an toàn, kiểm tra Content-Type JSON trước khi parse, tránh lỗi HTML crash (như lỗi 404 Vercel)
 */
async function safeFetchJson<T = any>(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data?: T }> {
  try {
    const res = await fetch(url, init);
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      return { ok: false, status: res.status };
    }
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * Lấy trạng thái bản quyền & số lượt dùng thử hiện tại:
 * - Ưu tiên kết nối Local Server (nếu đang chạy trên localhost)
 * - Tự động fallback sang Web Storage (localStorage) khi chạy trên Web tĩnh/Vercel
 */
export async function getLicenseStatus(): Promise<LicenseStatus> {
  // 1. Thử gọi Local Node Server trước (nếu có server chạy)
  const res = await safeFetchJson<{ status: LicenseStatus }>(`${API_BASE}/api/license/status`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (res.ok && res.data?.status) {
    return res.data.status;
  }

  // 2. Fallback sang Web Storage Vault khi chạy trên Vercel / Web tĩnh
  const vault = readWebVault();
  return getStatusFromWebVault(vault);
}

/**
 * Kiểm tra & trừ 1 lượt tải file (Áp dụng cho mọi hình thức: Word Equation, MathType, .doc, .md)
 */
export async function consumeDownloadQuota(
  formatName: string
): Promise<{ success: boolean; allowed: boolean; remaining?: number; message?: string; reason?: string }> {
  // 1. Thử gửi lên Local Server trước
  const res = await safeFetchJson<{
    success: boolean;
    allowed: boolean;
    remaining?: number;
    message?: string;
    reason?: string;
  }>(`${API_BASE}/api/license/consume-download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ formatName }),
  });

  if (res.ok && res.data) {
    return res.data;
  }

  // 2. Xử lý trên Web Storage Vault
  const vault = readWebVault();
  const now = Date.now();

  // Kiểm tra nếu đã kích hoạt bản quyền còn hiệu lực
  const isLifetime = vault.isActivated && vault.licenseType === 'lifetime';
  const isOneYearValid =
    vault.isActivated && vault.licenseType === '1year' && (!vault.expiresAt || vault.expiresAt > now);

  if (isLifetime || isOneYearValid) {
    return {
      success: true,
      allowed: true,
      remaining: 999999,
      message: 'Bản quyền không giới hạn.',
    };
  }

  // Kiểm tra lượt dùng thử
  const remainingBefore = vault.trialMax - vault.trialUsed;
  if (remainingBefore > 0) {
    vault.trialUsed += 1;
    saveWebVault(vault);
    const remainingAfter = vault.trialMax - vault.trialUsed;
    return {
      success: true,
      allowed: true,
      remaining: remainingAfter,
      message: `Đã dùng 1 lượt tải (${formatName}). Còn lại ${remainingAfter}/${vault.trialMax} lượt.`,
    };
  }

  return {
    success: false,
    allowed: false,
    remaining: 0,
    reason: 'EXPIRED',
    message: 'Bạn đã sử dụng hết lượt dùng thử. Vui lòng kích hoạt bản quyền để tiếp tục tải file.',
  };
}

/**
 * Gửi Mã Kích Hoạt (1 Năm / Vĩnh Viễn / Gia Hạn):
 * - Nếu có Local Server -> Gửi lên Server
 * - Nếu chạy trên Web tĩnh (Vercel) -> Kích hoạt trực tiếp trên trình duyệt & lưu vào localStorage
 */
export async function activateLicenseKey(
  key: string
): Promise<{ success: boolean; message: string; status?: LicenseStatus }> {
  const cleanKey = (key || '').trim().toUpperCase();
  if (!cleanKey) {
    return { success: false, message: 'Vui lòng nhập mã kích hoạt.' };
  }

  // 1. Thử gửi lên Local Server trước (nếu đang chạy chế độ Localhost)
  const res = await safeFetchJson<{ success: boolean; message: string; status?: LicenseStatus }>(
    `${API_BASE}/api/license/activate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key: cleanKey }),
    }
  );

  if (res.ok && res.data) {
    return res.data;
  }

  // 2. Nếu không có Server (trên Vercel/Web tĩnh) -> Kích hoạt trực tiếp trên Web Vault (Client-side)
  const vault = readWebVault();

  // Kiểm tra mã với Machine ID của browser hiện tại
  let verification = verifyLicenseKey(cleanKey, vault.machineId);

  // Khả năng tương thích ngược đặc biệt:
  // Kiểm tra thêm với mã MTH-LOCAL-HOST-DEV0 nếu key chưa khớp (hỗ trợ khách hàng đã tạo key theo mã fallback cũ trên Vercel)
  if (!verification.valid) {
    const fallbackVerification = verifyLicenseKey(cleanKey, LEGACY_FALLBACK_HWID);
    if (fallbackVerification.valid) {
      verification = fallbackVerification;
      vault.machineId = LEGACY_FALLBACK_HWID; // Gán mã máy khớp với key đã cấp
    }
  }

  if (!verification.valid) {
    return {
      success: false,
      message: verification.message || 'Mã kích hoạt không hợp lệ hoặc không khớp với mã máy này.',
    };
  }

  const now = Date.now();

  if (verification.type === 'lifetime') {
    vault.isActivated = true;
    vault.licenseType = 'lifetime';
    vault.licenseKey = cleanKey;
    vault.activatedAt = now;
    delete vault.expiresAt;
  } else if (verification.type === '1year') {
    vault.isActivated = true;
    vault.licenseType = '1year';
    vault.licenseKey = cleanKey;
    vault.activatedAt = now;
    const baseTime = vault.expiresAt && vault.expiresAt > now ? vault.expiresAt : now;
    vault.expiresAt = baseTime + (verification.durationDays || 365) * 24 * 60 * 60 * 1000;
  } else if (verification.type === 'extend') {
    const extra = verification.extraTrials || 5;
    vault.trialMax += extra;
  }

  saveWebVault(vault);
  const newStatus = getStatusFromWebVault(vault);

  return {
    success: true,
    message: verification.message || 'Kích hoạt bản quyền thành công!',
    status: newStatus,
  };
}

/**
 * Sinh mã kích hoạt nội bộ (khi cần Admin Keygen trên giao diện)
 */
export async function generateAdminKey(
  hwid: string,
  type: '1YEAR' | 'LIFETIME' | 'EXTEND',
  val = 5
): Promise<{ success: boolean; key?: string; message?: string }> {
  // 1. Thử gửi lên Local Server trước
  const res = await safeFetchJson<{ success: boolean; key?: string; message?: string }>(
    `${API_BASE}/api/license/admin-generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ hwid, type, val }),
    }
  );

  if (res.ok && res.data?.key) {
    return res.data;
  }

  // 2. Fallback tính toán trực tiếp bằng cryptographic engine
  try {
    const key = generateLicenseKey(hwid, type, val);
    return { success: true, key };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: msg };
  }
}
