import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  formatMachineId,
  generateLicenseKey,
  verifyLicenseKey,
  type LicenseStatus,
  type LicenseType,
  type LicenseVaultData,
} from './licenseEngine';

// Đường dẫn thư mục lưu trữ Vault cấp hệ điều hành (Đồng bộ mọi trình duyệt trên máy)
function getVaultFilePath(): string {
  let appDataDir = '';
  if (process.platform === 'win32') {
    appDataDir = process.env.APPDATA || process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  } else if (process.platform === 'darwin') {
    appDataDir = path.join(os.homedir(), 'Library', 'Application Support');
  } else {
    appDataDir = path.join(os.homedir(), '.config');
  }

  const targetDir = path.join(appDataDir, 'MathOCR_Studio');
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch {
      // Bỏ qua nếu đã tồn tại
    }
  }

  return path.join(targetDir, 'license_vault.json');
}

// Lấy định danh phần cứng máy tính (Motherboard UUID + CPU ID)
let cachedHardwareId = '';

export function getHardwareIdentifier(): string {
  if (cachedHardwareId) return cachedHardwareId;

  let rawHwid = '';
  try {
    if (process.platform === 'win32') {
      // Lấy UUID máy tính qua PowerShell
      const psCommand = `(Get-CimInstance Win32_ComputerSystemProduct).UUID + '_' + (Get-CimInstance Win32_Processor).ProcessorId`;
      const output = execSync(`powershell -NoProfile -Command "${psCommand}"`, {
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      });
      rawHwid = output.trim();
    } else if (process.platform === 'darwin') {
      const output = execSync(`ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID`, {
        encoding: 'utf8',
        timeout: 3000,
      });
      rawHwid = output.trim();
    } else {
      if (fs.existsSync('/etc/machine-id')) {
        rawHwid = fs.readFileSync('/etc/machine-id', 'utf8').trim();
      } else if (fs.existsSync('/var/lib/dbus/machine-id')) {
        rawHwid = fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
      }
    }
  } catch {
    // Fallback nếu lệnh hệ thống bị chặn
  }

  if (!rawHwid || rawHwid.length < 5) {
    const interfaces = os.networkInterfaces();
    let macStr = '';
    for (const name of Object.keys(interfaces)) {
      const ifaceList = interfaces[name];
      if (ifaceList) {
        for (const iface of ifaceList) {
          if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
            macStr += iface.mac;
            break;
          }
        }
      }
    }
    rawHwid = `${os.hostname()}_${os.platform()}_${macStr || os.userInfo().username}`;
  }

  cachedHardwareId = formatMachineId(rawHwid);
  return cachedHardwareId;
}

// Đọc và khởi tạo Vault dữ liệu
function readVault(): LicenseVaultData {
  const filePath = getVaultFilePath();
  const machineId = getHardwareIdentifier();
  const defaultVault: LicenseVaultData = {
    version: 1,
    machineId,
    isActivated: false,
    licenseType: 'trial',
    trialUsed: 0,
    trialMax: 5,
    lastSeenTimestamp: Date.now(),
  };

  if (!fs.existsSync(filePath)) {
    saveVault(defaultVault);
    return defaultVault;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content) as LicenseVaultData;
    if (!data.machineId || data.machineId !== machineId) {
      data.machineId = machineId;
    }
    if (typeof data.trialUsed !== 'number') data.trialUsed = 0;
    if (typeof data.trialMax !== 'number') data.trialMax = 5;
    data.lastSeenTimestamp = Math.max(data.lastSeenTimestamp || 0, Date.now());
    return data;
  } catch {
    saveVault(defaultVault);
    return defaultVault;
  }
}

function saveVault(data: LicenseVaultData): void {
  const filePath = getVaultFilePath();
  try {
    data.lastSeenTimestamp = Date.now();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[MathOCR License] Error saving vault:', err);
  }
}

// Chuyển đổi dữ liệu Vault sang Trạng thái công khai cho UI
function getStatusFromVault(vault: LicenseVaultData): LicenseStatus {
  const now = Date.now();
  let isExpired = false;
  let isActivated = vault.isActivated;
  let licenseTypeText = 'Gói Dùng Thử';

  if (vault.isActivated) {
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

// Đọc Request Body từ IncomingMessage
function parseBody<T = any>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: any): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(data));
}

/**
 * Xử lý các API endpoint liên quan đến bản quyền (/api/license/*)
 */
export async function handleLicenseApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url || '';
  if (!url.startsWith('/api/license')) {
    return false;
  }

  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return true;
  }

  const cleanUrl = url.split('?')[0];

  try {
    // 1. GET /api/license/status - Lấy trạng thái bản quyền & lượt tải hiện tại
    if (req.method === 'GET' && cleanUrl === '/api/license/status') {
      const vault = readVault();
      const status = getStatusFromVault(vault);
      sendJson(res, 200, { success: true, status });
      return true;
    }

    // 2. POST /api/license/consume-download - Kiểm tra & trừ 1 lượt tải file
    if (req.method === 'POST' && cleanUrl === '/api/license/consume-download') {
      const body = await parseBody<{ formatName?: string }>(req);
      const vault = readVault();
      const status = getStatusFromVault(vault);

      // Nếu đã có bản quyền Pro (1 năm còn hạn hoặc vĩnh viễn) -> Cho phép tải không giới hạn
      if (status.isActivated && !status.isExpired) {
        sendJson(res, 200, {
          success: true,
          allowed: true,
          isActivated: true,
          remaining: 999999,
          message: 'Tài khoản Pro: Tải file không giới hạn.',
        });
        return true;
      }

      // Nếu là bản dùng thử
      if (status.trialRemaining > 0) {
        vault.trialUsed += 1;
        saveVault(vault);
        const newRemaining = Math.max(0, vault.trialMax - vault.trialUsed);

        sendJson(res, 200, {
          success: true,
          allowed: true,
          isActivated: false,
          remaining: newRemaining,
          trialMax: vault.trialMax,
          message: `Đã sử dụng 1 lượt dùng thử (${body.formatName || 'Xuất file'}). Bạn còn ${newRemaining}/${vault.trialMax} lượt.`,
        });
        return true;
      }

      // Hết lượt dùng thử -> Chặn tải
      sendJson(res, 403, {
        success: false,
        allowed: false,
        isActivated: false,
        remaining: 0,
        reason: 'EXPIRED',
        message: 'Bạn đã sử dụng hết 5 lượt dùng thử. Vui lòng kích hoạt bản quyền để tiếp tục tải file.',
      });
      return true;
    }

    // 3. POST /api/license/activate - Nhập mã kích hoạt (1 năm / Vĩnh viễn / Gia hạn)
    if (req.method === 'POST' && cleanUrl === '/api/license/activate') {
      const body = await parseBody<{ key: string }>(req);
      const vault = readVault();
      const verification = verifyLicenseKey(body.key, vault.machineId);

      if (!verification.valid) {
        sendJson(res, 400, {
          success: false,
          message: verification.message || 'Mã kích hoạt không hợp lệ.',
        });
        return true;
      }

      const now = Date.now();

      if (verification.type === 'lifetime') {
        vault.isActivated = true;
        vault.licenseType = 'lifetime';
        vault.activatedAt = now;
        vault.licenseKey = body.key.trim().toUpperCase();
        delete vault.expiresAt;
      } else if (verification.type === '1year') {
        vault.isActivated = true;
        vault.licenseType = '1year';
        vault.activatedAt = now;
        vault.licenseKey = body.key.trim().toUpperCase();
        // Cộng thêm 365 ngày kể từ ngày kích hoạt (hoặc nối dài nếu đang có hạn)
        const baseTime = vault.expiresAt && vault.expiresAt > now ? vault.expiresAt : now;
        vault.expiresAt = baseTime + (verification.durationDays || 365) * 24 * 60 * 60 * 1000;
      } else if (verification.type === 'extend') {
        const extra = verification.extraTrials || 5;
        vault.trialMax += extra;
      }

      saveVault(vault);
      const newStatus = getStatusFromVault(vault);

      sendJson(res, 200, {
        success: true,
        message: verification.message,
        status: newStatus,
      });
      return true;
    }

    // 4. POST /api/license/admin-generate - Endpoint sinh mã nội bộ cho Admin
    if (req.method === 'POST' && cleanUrl === '/api/license/admin-generate') {
      const body = await parseBody<{
        hwid: string;
        type: '1YEAR' | 'LIFETIME' | 'EXTEND';
        val?: number;
      }>(req);

      if (!body.hwid || !body.type) {
        sendJson(res, 400, { success: false, message: 'Thiếu thông tin hwid hoặc type.' });
        return true;
      }

      const key = generateLicenseKey(body.hwid, body.type, body.val || 5);
      sendJson(res, 200, {
        success: true,
        key,
        hwid: body.hwid,
        type: body.type,
      });
      return true;
    }
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { success: false, message: `Lỗi xử lý bản quyền: ${err}` });
    return true;
  }

  return false;
}
