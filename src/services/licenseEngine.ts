/**
 * License Cryptographic Engine
 * Quản lý thuật toán sinh mã máy, băm chữ ký số và xác thực bản quyền.
 */

// Secret key salt dùng riêng cho MathOCR Studio (Giữ bảo mật trong codebase)
export const MASTER_SECRET_SALT = 'MathOCR_Studio_Secure_2026_@Keygen#Secret$X9!';

export type LicenseType = 'trial' | '1year' | 'lifetime';

export interface LicenseVaultData {
  version: number;
  machineId: string;
  isActivated: boolean;
  licenseType: LicenseType;
  activatedAt?: number;
  expiresAt?: number; // timestamp ms (dành cho gói 1 năm)
  licenseKey?: string;
  trialUsed: number;
  trialMax: number; // Mặc định 5, có thể tăng lên khi nhập mã gia hạn
  lastSeenTimestamp: number;
}

export interface LicenseStatus {
  machineId: string;
  isActivated: boolean;
  licenseType: LicenseType;
  licenseTypeText: string;
  trialRemaining: number;
  trialUsed: number;
  trialMax: number;
  isExpired: boolean;
  expiresAt?: number;
  expiresAtFormatted?: string;
  activatedAtFormatted?: string;
}

// Băm chuỗi đơn giản tương thích cả Browser & Node.js
export function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  // Thêm vòng đảo bit để tăng độ phân tán
  let h2 = 5381;
  for (let i = input.length - 1; i >= 0; i--) {
    h2 = (h2 * 33) ^ input.charCodeAt(i);
    h2 |= 0;
  }
  const hex1 = Math.abs(hash).toString(16).padStart(8, '0').toUpperCase();
  const hex2 = Math.abs(h2).toString(16).padStart(8, '0').toUpperCase();
  return hex1 + hex2;
}

/**
 * Chuẩn hóa chuỗi phần cứng thô thành Mã Máy chuẩn: MTH-XXXX-XXXX-XXXX
 */
export function formatMachineId(rawHardwareString: string): string {
  const clean = (rawHardwareString || '').trim() || 'DEFAULT_HARDWARE_NODE';
  const hashed = simpleHash(`${clean}_${MASTER_SECRET_SALT}`);
  // Định dạng MTH-XXXX-XXXX-XXXX (12 ký tự hex)
  return `MTH-${hashed.substring(0, 4)}-${hashed.substring(4, 8)}-${hashed.substring(8, 12)}`;
}

/**
 * Sinh mã kích hoạt từ Mã Máy và Loại Bản Quyền
 * @param machineId Mã máy của khách (VD: MTH-7B4E-91CA-D820)
 * @param type Loại bản quyền: '1YEAR' | 'LIFETIME' | 'EXTEND'
 * @param extraVal Số lượt thêm (khi type === 'EXTEND', vd: 5, 10) hoặc số ngày (khi type === '1YEAR')
 */
export function generateLicenseKey(
  machineId: string,
  type: '1YEAR' | 'LIFETIME' | 'EXTEND',
  extraVal = 5
): string {
  const normHwid = machineId.trim().toUpperCase();
  let prefix = 'LIFE';
  let payloadParam = 'INF';

  if (type === '1YEAR') {
    prefix = 'PRO1Y';
    payloadParam = `${extraVal || 365}D`;
  } else if (type === 'EXTEND') {
    const trials = extraVal || 5;
    prefix = `EXT${trials.toString().padStart(2, '0')}`;
    payloadParam = `${trials}T`;
  }

  // Tạo signature dựa trên HWID + TYPE + PAYLOAD + SECRET
  const signInput = `${normHwid}#${prefix}#${payloadParam}#${MASTER_SECRET_SALT}`;
  const signHash = simpleHash(signInput);

  // Cấu trúc Key: PREFIX-XXXX-YYYY-ZZZZ-SIGN (Dễ nhìn, chuẩn công nghiệp)
  const part1 = normHwid.replace(/[^A-Z0-9]/g, '').substring(3, 7) || 'AAAA';
  const part2 = normHwid.replace(/[^A-Z0-9]/g, '').substring(7, 11) || 'BBBB';
  const part3 = signHash.substring(0, 4);
  const part4 = signHash.substring(4, 8);

  return `${prefix}-${part1}-${part2}-${part3}-${part4}`;
}

/**
 * Xác thực Mã Kích Hoạt nhập vào từ giao diện
 */
export interface VerificationResult {
  valid: boolean;
  type?: '1year' | 'lifetime' | 'extend';
  extraTrials?: number;
  durationDays?: number;
  message?: string;
}

export function verifyLicenseKey(
  inputKey: string,
  currentMachineId: string
): VerificationResult {
  if (!inputKey || typeof inputKey !== 'string') {
    return { valid: false, message: 'Vui lòng nhập mã kích hoạt.' };
  }

  const cleanKey = inputKey.trim().toUpperCase().replace(/\s+/g, '');
  const parts = cleanKey.split('-');

  if (parts.length !== 5) {
    return {
      valid: false,
      message: 'Định dạng mã kích hoạt không đúng (Ví dụ: PRO1Y-XXXX-XXXX-XXXX-XXXX)',
    };
  }

  const [prefix] = parts;
  const normHwid = currentMachineId.trim().toUpperCase();

  // Kiểm tra Gói Vĩnh Viễn
  if (prefix === 'LIFE') {
    const expectedKey = generateLicenseKey(normHwid, 'LIFETIME');
    if (cleanKey === expectedKey) {
      return { valid: true, type: 'lifetime', message: 'Kích hoạt Gói Pro Vĩnh Viễn thành công!' };
    }
  }

  // Kiểm tra Gói 1 Năm
  if (prefix === 'PRO1Y') {
    const expectedKey = generateLicenseKey(normHwid, '1YEAR', 365);
    if (cleanKey === expectedKey) {
      return {
        valid: true,
        type: '1year',
        durationDays: 365,
        message: 'Kích hoạt Gói Pro 1 Năm thành công (Thời hạn 365 ngày)!',
      };
    }
  }

  // Kiểm tra Mã Gia Hạn Dùng Thử (EXT05, EXT10, EXT20, v.v.)
  if (prefix.startsWith('EXT')) {
    const trialsCount = parseInt(prefix.replace('EXT', ''), 10) || 5;
    const expectedKey = generateLicenseKey(normHwid, 'EXTEND', trialsCount);
    if (cleanKey === expectedKey) {
      return {
        valid: true,
        type: 'extend',
        extraTrials: trialsCount,
        message: `Gia hạn thành công thêm +${trialsCount} lượt dùng thử!`,
      };
    }
  }

  return {
    valid: false,
    message: 'Mã kích hoạt không hợp lệ hoặc không thuộc về Mã Máy này!',
  };
}
