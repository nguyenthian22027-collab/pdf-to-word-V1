#!/usr/bin/env node
/**
 * Công cụ sinh mã kích hoạt bản quyền dành riêng cho:
 * ỨNG DỤNG: pdf-to-word-mathtype (Chuyển đổi PDF sang Word Equation & MathType)
 * Admin: Zalo 0988250112 (Nguyen Van Thien)
 */

import readline from 'readline';

const MASTER_SECRET_SALT = 'MathOCR_Studio_Secure_2026_@Keygen#Secret$X9!';

function simpleHash(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  let h2 = 5381;
  for (let i = input.length - 1; i >= 0; i--) {
    h2 = (h2 * 33) ^ input.charCodeAt(i);
    h2 |= 0;
  }
  const hex1 = Math.abs(hash).toString(16).padStart(8, '0').toUpperCase();
  const hex2 = Math.abs(h2).toString(16).padStart(8, '0').toUpperCase();
  return hex1 + hex2;
}

function generateLicenseKey(machineId, type, extraVal = 5) {
  const normHwid = (machineId || '').trim().toUpperCase();
  let prefix = 'LIFE';
  let payloadParam = 'INF';

  if (type === '1YEAR' || type === '1year' || type === '1y') {
    prefix = 'PRO1Y';
    payloadParam = `${extraVal || 365}D`;
  } else if (type === 'EXTEND' || type === 'extend' || type === 'trial') {
    const trials = extraVal || 5;
    prefix = `EXT${trials.toString().padStart(2, '0')}`;
    payloadParam = `${trials}T`;
  }

  const signInput = `${normHwid}#${prefix}#${payloadParam}#${MASTER_SECRET_SALT}`;
  const signHash = simpleHash(signInput);

  const part1 = normHwid.replace(/[^A-Z0-9]/g, '').substring(3, 7) || 'AAAA';
  const part2 = normHwid.replace(/[^A-Z0-9]/g, '').substring(7, 11) || 'BBBB';
  const part3 = signHash.substring(0, 4);
  const part4 = signHash.substring(4, 8);

  return `${prefix}-${part1}-${part2}-${part3}-${part4}`;
}

// Xử lý tham số dòng lệnh nếu có (vd: node keygen.js --hwid MTH-XXXX-XXXX --type 1year)
const args = process.argv.slice(2);
function getArg(flag) {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
}

const argHwid = getArg('--hwid') || getArg('-h');
const argType = getArg('--type') || getArg('-t');
const argVal = parseInt(getArg('--val') || getArg('-v') || '5', 10);

if (argHwid && argType) {
  const key = generateLicenseKey(argHwid, argType, argVal);
  console.log(`\n========================================================================`);
  console.log(`ỨNG DỤNG:      pdf-to-word-mathtype`);
  console.log(`MÃ MÁY KHÁCH:  ${argHwid.toUpperCase()}`);
  console.log(`LOẠI GÓI:      ${argType.toUpperCase()}`);
  console.log(`MÃ KÍCH HOẠT:  ${key}`);
  console.log(`========================================================================\n`);
  process.exit(0);
}

// Chế độ tương tác hỏi đáp trực tiếp (Interactive CLI)
console.clear();
console.log(`========================================================================`);
console.log(`   💎 CÔNG CỤ TẠO MÃ KÍCH HOẠT BẢN QUYỀN 💎   `);
console.log(`   ỨNG DỤNG: pdf-to-word-mathtype (Chuyển PDF sang Word Equation & MathType)`);
console.log(`   Admin hỗ trợ: Zalo 0988.250.112 (Nguyen Van Thien)`);
console.log(`========================================================================\n`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('👉 Bước 1: Nhập Mã Máy của khách hàng (VD: MTH-8A2F-9C1D-4E7B): ', (hwidInput) => {
  const hwid = hwidInput.trim().toUpperCase();
  if (!hwid || hwid.length < 5) {
    console.log('\n❌ [LỖI] Mã máy không hợp lệ. Vui lòng thử lại!');
    rl.close();
    return;
  }

  console.log('\n👉 Bước 2: Chọn loại gói bản quyền cho ứng dụng pdf-to-word-mathtype:');
  console.log('   [1] Gói Pro 1 Năm (Sử dụng không giới hạn 365 ngày)');
  console.log('   [2] Gói Pro Vĩnh Viễn (Mở khóa trọn đời theo máy tính)');
  console.log('   [3] Gia Hạn Dùng Thử (+5 lượt tải)');
  console.log('   [4] Gia Hạn Dùng Thử (+10 lượt tải)');

  rl.question('\nNhập lựa chọn của bạn (1/2/3/4) [Mặc định: 1]: ', (choice) => {
    let type = '1YEAR';
    let label = 'Bản Pro 1 Năm (365 Ngày)';
    let val = 365;

    const c = choice.trim();
    if (c === '2') {
      type = 'LIFETIME';
      label = 'Bản Pro Vĩnh Viễn (Trọn Đời)';
      val = 0;
    } else if (c === '3') {
      type = 'EXTEND';
      label = 'Gia Hạn Dùng Thử (+5 Lượt Tải)';
      val = 5;
    } else if (c === '4') {
      type = 'EXTEND';
      label = 'Gia Hạn Dùng Thử (+10 Lượt Tải)';
      val = 10;
    }

    const key = generateLicenseKey(hwid, type, val);

    console.log('\n' + '─'.repeat(72));
    console.log(`🎉 TẠO MÃ KÍCH HOẠT THÀNH CÔNG CHO ỨNG DỤNG: pdf-to-word-mathtype`);
    console.log('─'.repeat(72));
    console.log(`📱 Ứng dụng:         pdf-to-word-mathtype`);
    console.log(`📌 Mã Máy Khách:     ${hwid}`);
    console.log(`📦 Loại Bản Quyền:    ${label}`);
    console.log(`🔑 MÃ KÍCH HOẠT:     \x1b[32m\x1b[1m${key}\x1b[0m`);
    console.log('─'.repeat(72));
    console.log(`💡 Mẫu tin nhắn gửi khách qua Zalo:`);
    console.log(`"Dưới đây là mã kích hoạt cho ứng dụng pdf-to-word-mathtype của bạn:`);
    console.log(`Mã: ${key}`);
    console.log(`Bạn bấm vào nút [Dùng thử/Bản quyền] trên web và dán mã vào để mở khóa nhé!"`);
    console.log('─'.repeat(72) + '\n');

    rl.close();
  });
});
