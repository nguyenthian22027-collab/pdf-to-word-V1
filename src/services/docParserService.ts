import JSZip from 'jszip';
import { normalizeAiMarkdown } from './content';

export interface ParsedDocumentResult {
  content: string;
  filename: string;
  fileType: 'docx' | 'doc' | 'text' | 'unknown';
  stats: {
    words: number;
    characters: number;
    mathCount: number;
    tableCount: number;
  };
}

/** Chuyển Uint8Array sang Base64 an toàn cho file lớn */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/** Lấy MIME type từ đuôi file ảnh */
function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'emf':
    case 'wmf':
      return 'image/png';
    default:
      return 'image/png';
  }
}

/**
 * Chuyển đổi dữ liệu nhị phân của ảnh trong Word thành Data URL hiển thị được 100% trên trình duyệt
 */
function convertMediaBytesToBrowserDataUrl(bytes: Uint8Array, filename: string): string {
  const len = bytes.byteLength;
  if (len < 4) return '';

  // 1. Kiểm tra trực tiếp các Magic Bytes phổ biến
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    len >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return `data:image/png;base64,${uint8ArrayToBase64(bytes)}`;
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return `data:image/jpeg;base64,${uint8ArrayToBase64(bytes)}`;
  }

  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return `data:image/gif;base64,${uint8ArrayToBase64(bytes)}`;
  }

  // BMP: 42 4D
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return `data:image/bmp;base64,${uint8ArrayToBase64(bytes)}`;
  }

  // WebP: RIFF ... WEBP
  if (
    len >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return `data:image/webp;base64,${uint8ArrayToBase64(bytes)}`;
  }

  // 2. Nếu là EMF/WMF hoặc file nhúng phức tạp của Word, quét tìm luồng PNG hoặc JPEG nhúng bên trong
  for (let i = 0; i < len - 8; i++) {
    // Quét tìm PNG
    if (
      bytes[i] === 0x89 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x4e &&
      bytes[i + 3] === 0x47 &&
      bytes[i + 4] === 0x0d &&
      bytes[i + 5] === 0x0a &&
      bytes[i + 6] === 0x1a &&
      bytes[i + 7] === 0x0a
    ) {
      let end = -1;
      for (let j = i + 8; j < Math.min(len - 7, i + 20 * 1024 * 1024); j++) {
        if (
          bytes[j] === 0x49 &&
          bytes[j + 1] === 0x45 &&
          bytes[j + 2] === 0x4e &&
          bytes[j + 3] === 0x44
        ) {
          end = j + 8;
          break;
        }
      }
      if (end > i && end - i > 64) {
        const pngSub = bytes.subarray(i, end);
        return `data:image/png;base64,${uint8ArrayToBase64(pngSub)}`;
      }
    }

    // Quét tìm JPEG
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      let end = -1;
      for (let j = i + 4; j < Math.min(len - 1, i + 20 * 1024 * 1024); j++) {
        if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
          end = j + 2;
          break;
        }
      }
      if (end > i && end - i > 64) {
        const jpgSub = bytes.subarray(i, end);
        return `data:image/jpeg;base64,${uint8ArrayToBase64(jpgSub)}`;
      }
    }
  }

  // 3. Fallback theo đuôi mở rộng thông thường
  const mime = getMimeTypeFromFilename(filename);
  return `data:${mime};base64,${uint8ArrayToBase64(bytes)}`;
}

/**
 * Đọc toàn bộ quan hệ (relationships) từ word/_rels/document.xml.rels
 * và nạp các tệp ảnh trong word/media/ thành Base64 Data URL.
 */
async function loadDocxMediaMap(zip: JSZip): Promise<Map<string, string>> {
  const mediaMap = new Map<string, string>();
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    try {
      const relsXml = await relsFile.async('string');
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(relsXml, 'application/xml');
      const relElements = xmlDoc.getElementsByTagName('Relationship');

      for (let i = 0; i < relElements.length; i++) {
        const rel = relElements[i];
        const id = rel.getAttribute('Id') || '';
        const type = rel.getAttribute('Type') || '';
        const target = rel.getAttribute('Target') || '';

        if (!id || !target) continue;

        // Kiểm tra nếu là quan hệ hình ảnh
        if (type.includes('/image') || target.match(/\.(png|jpe?g|gif|svg|webp|bmp|emf|wmf)$/i)) {
          let zipPath = target;
          if (zipPath.startsWith('/')) {
            zipPath = zipPath.slice(1);
          } else if (zipPath.startsWith('../')) {
            zipPath = zipPath.replace(/^\.\.\//, '');
          } else if (!zipPath.startsWith('word/')) {
            zipPath = `word/${zipPath}`;
          }

          let fileInZip = zip.file(zipPath);
          if (!fileInZip) {
            const baseName = target.split('/').pop();
            if (baseName) {
              fileInZip = zip.file(`word/media/${baseName}`) || zip.file(baseName);
            }
          }

          if (fileInZip) {
            const bytes = await fileInZip.async('uint8array');
            const dataUrl = convertMediaBytesToBrowserDataUrl(bytes, target);
            if (dataUrl) {
              mediaMap.set(id, dataUrl);
              const fileName = target.split('/').pop();
              if (fileName) {
                mediaMap.set(fileName, dataUrl);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('Không thể đọc file word/_rels/document.xml.rels:', err);
    }
  }

  // Đọc thêm trực tiếp tất cả file trong word/media/ nếu chưa được map
  const mediaFiles = Object.keys(zip.files).filter((path) => path.startsWith('word/media/'));
  for (const path of mediaFiles) {
    const file = zip.file(path);
    if (file) {
      const fileName = path.split('/').pop() || '';
      if (fileName && !mediaMap.has(fileName)) {
        const bytes = await file.async('uint8array');
        const dataUrl = convertMediaBytesToBrowserDataUrl(bytes, fileName);
        if (dataUrl) {
          mediaMap.set(fileName, dataUrl);
        }
      }
    }
  }

  return mediaMap;
}

/**
 * Trích xuất ID hình ảnh từ một Element (w:drawing, w:pict, a:blip, v:imagedata...)
 */
function extractImageRelIds(element: Element): string[] {
  const ids: string[] = [];

  // Tìm trong a:blip và mọi tag blip
  const blips = [
    ...Array.from(element.getElementsByTagName('a:blip')),
    ...Array.from(element.getElementsByTagNameNS('*', 'blip')),
  ];
  for (const blip of blips) {
    const embed =
      blip.getAttribute('r:embed') ||
      blip.getAttribute('r:link') ||
      blip.getAttribute('embed') ||
      blip.getAttribute('link');
    if (embed && !ids.includes(embed)) ids.push(embed);
  }

  // Tìm trong v:imagedata và mọi tag imagedata
  const imageDatas = [
    ...Array.from(element.getElementsByTagName('v:imagedata')),
    ...Array.from(element.getElementsByTagNameNS('*', 'imagedata')),
  ];
  for (const imgData of imageDatas) {
    const id =
      imgData.getAttribute('r:id') ||
      imgData.getAttribute('r:href') ||
      imgData.getAttribute('id') ||
      imgData.getAttribute('src');
    if (id && !ids.includes(id)) ids.push(id);
  }

  // Tìm các thuộc tính r:embed, r:id, embed hoặc tên file bất kỳ trong mọi thẻ con
  const allElements = element.getElementsByTagName('*');
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];
    for (let a = 0; a < el.attributes.length; a++) {
      const attr = el.attributes[a];
      if (
        (attr.name.toLowerCase().endsWith(':embed') ||
          attr.name.toLowerCase().endsWith(':id') ||
          attr.name.toLowerCase() === 'embed' ||
          attr.name.toLowerCase() === 'r:embed') &&
        attr.value &&
        !ids.includes(attr.value)
      ) {
        ids.push(attr.value);
      }

      if (attr.value && attr.value.match(/\.(png|jpe?g|gif|svg|webp|bmp|emf|wmf)$/i)) {
        const baseName = attr.value.split('/').pop()?.split('\\').pop();
        if (baseName && !ids.includes(baseName)) {
          ids.push(baseName);
        }
      }
    }
  }

  return ids;
}

/**
 * Đọc và trích xuất nội dung văn bản, bảng biểu, công thức toán và hình ảnh từ file .docx
 */
export async function parseDocxFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const documentXmlFile = zip.file('word/document.xml');
  if (!documentXmlFile) {
    throw new Error('File .docx không hợp lệ (thiếu word/document.xml).');
  }

  const mediaMap = await loadDocxMediaMap(zip);
  const xmlText = await documentXmlFile.async('string');
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

  const body = xmlDoc.getElementsByTagName('w:body')[0];
  if (!body) {
    throw new Error('Không tìm thấy nội dung văn bản trong file .docx.');
  }

  const markdownBlocks: string[] = [];

  for (let i = 0; i < body.childNodes.length; i++) {
    const node = body.childNodes[i];
    const nodeName = node.nodeName.toLowerCase();

    if (nodeName === 'w:p') {
      // Đoạn văn
      const paraText = parseParagraphNode(node as Element, mediaMap);
      if (paraText.trim()) {
        markdownBlocks.push(paraText.trim());
      }
    } else if (nodeName === 'w:tbl') {
      // Bảng biểu
      const tableMarkdown = parseTableNode(node as Element, mediaMap);
      if (tableMarkdown.trim()) {
        markdownBlocks.push(tableMarkdown.trim());
      }
    }
  }

  return normalizeAiMarkdown(markdownBlocks.join('\n\n'));
}

/**
 * Xử lý từng đoạn văn trong file Word XML (hỗ trợ text, công thức, và hình ảnh nhúng)
 */
function parseParagraphNode(pNode: Element, mediaMap: Map<string, string>, isInsideTable = false): string {
  let result = '';

  for (let i = 0; i < pNode.childNodes.length; i++) {
    const child = pNode.childNodes[i];
    const name = child.nodeName.toLowerCase();

    if (name === 'w:r') {
      // Text run hoặc có chứa drawing bên trong
      const text = extractTextFromRun(child as Element, mediaMap, isInsideTable);
      result += text;
    } else if (name === 'w:drawing' || name === 'w:pict' || name === 'mc:alternatecontent') {
      // Hình vẽ / sơ đồ nằm trực tiếp trong w:p
      const imageIds = extractImageRelIds(child as Element);
      for (const id of imageIds) {
        const dataUrl = mediaMap.get(id);
        if (dataUrl) {
          result += isInsideTable
            ? `<br>![Hình ảnh](${dataUrl})<br>`
            : `\n\n![Hình ảnh](${dataUrl})\n\n`;
        }
      }
    } else if (name === 'm:omath') {
      // Công thức toán inline
      const mathText = extractMathFromOMath(child as Element);
      if (mathText.trim()) {
        let cleaned = mathText.trim();
        if (isInsideTable) {
          cleaned = cleaned.replace(/\|/g, '\\vert ');
        }
        result += cleaned.startsWith('$') ? cleaned : `$${cleaned}$`;
      }
    } else if (name === 'm:omathpara') {
      // Công thức toán block riêng dòng
      const mathText = extractMathFromOMath(child as Element);
      if (mathText.trim()) {
        let cleaned = mathText.trim();
        if (isInsideTable) {
          cleaned = cleaned.replace(/\|/g, '\\vert ');
          result += `$${cleaned}$`;
        } else {
          result += cleaned.startsWith('$$') ? cleaned : `\n\n$$\n${cleaned}\n$$\n\n`;
        }
      }
    } else if (name === 'w:hyperlink') {
      // Hyperlink
      const linkText = child.textContent ?? '';
      result += linkText;
    }
  }

  return result;
}

/**
 * Trích xuất text và hình ảnh từ run <w:r>
 */
function extractTextFromRun(
  runNode: Element,
  mediaMap: Map<string, string>,
  isInsideTable = false,
): string {
  let runText = '';
  const isBold = runNode.getElementsByTagName('w:b').length > 0;
  const isItalic = runNode.getElementsByTagName('w:i').length > 0;

  // Kiểm tra xem trong w:r có chứa hình ảnh hay không
  const imageIds = extractImageRelIds(runNode);
  let imageMarkdown = '';
  for (const id of imageIds) {
    const dataUrl = mediaMap.get(id);
    if (dataUrl) {
      imageMarkdown += isInsideTable
        ? `<br>![Hình ảnh](${dataUrl})<br>`
        : `\n\n![Hình ảnh](${dataUrl})\n\n`;
    }
  }

  for (let i = 0; i < runNode.childNodes.length; i++) {
    const node = runNode.childNodes[i];
    const name = node.nodeName.toLowerCase();

    if (name === 'w:t') {
      runText += node.textContent ?? '';
    } else if (name === 'w:br' || name === 'w:cr') {
      runText += isInsideTable ? '<br>' : '\n';
    } else if (name === 'w:tab') {
      runText += '    ';
    }
  }

  let formattedText = runText;
  if (runText) {
    if (isInsideTable) {
      formattedText = formattedText.replace(/\|/g, '\\|');
    }
    if (isBold && isItalic) formattedText = `***${formattedText}***`;
    else if (isBold) formattedText = `**${formattedText}**`;
    else if (isItalic) formattedText = `*${formattedText}*`;
  }

  return `${formattedText}${imageMarkdown}`;
}

/**
 * Trích xuất công thức từ <m:oMath>
 */
function extractMathFromOMath(mathNode: Element): string {
  const mTexts = mathNode.getElementsByTagName('m:t');
  const parts: string[] = [];
  for (let i = 0; i < mTexts.length; i++) {
    parts.push(mTexts[i].textContent ?? '');
  }
  return parts.join(' ');
}

/**
 * Chuyển đổi bảng Word <w:tbl> sang bảng Markdown, giữ nguyên toàn bộ đoạn văn,
 * ngắt dòng bằng <br>, công thức và hình ảnh trong từng ô.
 */
function parseTableNode(tblNode: Element, mediaMap: Map<string, string>): string {
  const rows = tblNode.getElementsByTagName('w:tr');
  if (rows.length === 0) return '';

  const tableData: string[][] = [];
  let maxCols = 0;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const cells = row.getElementsByTagName('w:tc');
    const rowData: string[] = [];

    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
      const paragraphs = cell.getElementsByTagName('w:p');
      const cellParagraphs: string[] = [];

      for (let p = 0; p < paragraphs.length; p++) {
        const text = parseParagraphNode(paragraphs[p], mediaMap, true);
        if (text.trim()) {
          cellParagraphs.push(text.trim());
        }
      }

      // Giữ ngắt dòng giữa các đoạn văn trong ô bằng <br>
      const cellContent = cellParagraphs
        .join('<br>')
        .replace(/\n+/g, '<br>')
        .replace(/(?:<br>\s*)+/g, '<br>')
        .replace(/^<br>|<br>$/g, '')
        .trim();

      rowData.push(cellContent || ' ');
    }

    maxCols = Math.max(maxCols, rowData.length);
    tableData.push(rowData);
  }

  if (tableData.length === 0 || maxCols === 0) return '';

  // Đồng đều số cột
  for (const row of tableData) {
    while (row.length < maxCols) {
      row.push(' ');
    }
  }

  const mdLines: string[] = [];
  // Hàng tiêu đề (Hàng đầu tiên)
  mdLines.push(`| ${tableData[0].join(' | ')} |`);
  // Hàng phân cách
  mdLines.push(`| ${Array(maxCols).fill('---').join(' | ')} |`);

  // Các hàng nội dung
  for (let r = 1; r < tableData.length; r++) {
    mdLines.push(`| ${tableData[r].join(' | ')} |`);
  }

  return mdLines.join('\n');
}

/**
 * Giải mã cấu trúc OLE2 Compound File của tệp Word 97-2003 (.doc)
 */
function parseOleCompoundFile(bytes: Uint8Array): {
  getStreamBytes: (startSector: number, size: number) => Uint8Array;
  findStream: (name: string) => { startSector: number; size: number } | null;
} | null {
  if (bytes.byteLength < 512) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Kiểm tra OLE2 Header magic bytes
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== magic[i]) return null;
  }

  const sectorShift = view.getUint16(0x1e, true);
  const sectorSize = 1 << sectorShift;
  const csectFat = view.getUint32(0x2c, true);
  const sectDirStart = view.getUint32(0x30, true);

  // Đọc bảng phân bổ file FAT
  const fat: number[] = [];
  const fatSectorCount = Math.min(csectFat, 109);
  for (let i = 0; i < fatSectorCount; i++) {
    const fatSec = view.getUint32(0x4c + i * 4, true);
    if (fatSec >= 0xfffffffe) break;
    const secOffset = (fatSec + 1) * sectorSize;
    for (let j = 0; j < sectorSize / 4; j++) {
      if (secOffset + j * 4 + 4 <= bytes.byteLength) {
        fat.push(view.getUint32(secOffset + j * 4, true));
      }
    }
  }

  function getStreamBytes(startSector: number, size: number): Uint8Array {
    const chunks: Uint8Array[] = [];
    let sec = startSector;
    let total = 0;
    while (sec < 0xfffffffe && sec < fat.length && total < size) {
      const offset = (sec + 1) * sectorSize;
      const readLen = Math.min(sectorSize, size - total);
      if (offset + readLen <= bytes.byteLength) {
        chunks.push(bytes.subarray(offset, offset + readLen));
        total += readLen;
      }
      sec = fat[sec];
    }
    const result = new Uint8Array(total);
    let p = 0;
    for (const chunk of chunks) {
      result.set(chunk, p);
      p += chunk.byteLength;
    }
    return result;
  }

  // Đọc Directory Stream
  const dirBytes = getStreamBytes(sectDirStart, 128 * 1024);
  const dirView = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);

  function findStream(targetName: string): { startSector: number; size: number } | null {
    const normTarget = targetName.toLowerCase();
    for (let i = 0; i < Math.floor(dirBytes.byteLength / 128); i++) {
      const entryOffset = i * 128;
      const nameLen = dirView.getUint16(entryOffset + 0x40, true);
      if (nameLen === 0) continue;
      let name = '';
      for (let j = 0; j < Math.max(0, nameLen - 2); j += 2) {
        name += String.fromCharCode(dirView.getUint16(entryOffset + j, true));
      }
      if (name.toLowerCase() === normTarget) {
        const startSector = dirView.getUint32(entryOffset + 0x74, true);
        const size = dirView.getUint32(entryOffset + 0x78, true);
        return { startSector, size };
      }
    }
    return null;
  }

  return { getStreamBytes, findStream };
}

/**
 * Trích xuất luồng văn bản từ WordDocument stream của file .doc
 */
function extractTextFromWordDocStream(streamBytes: Uint8Array): string {
  if (streamBytes.byteLength < 512) return '';
  const view = new DataView(streamBytes.buffer, streamBytes.byteOffset, streamBytes.byteLength);
  const fcMin = Math.min(view.getUint32(0x18, true), streamBytes.byteLength - 2);

  let text16 = '';
  // Đọc văn bản UTF-16LE từ vị trí fcMin
  for (let i = fcMin; i < streamBytes.byteLength - 1; i += 2) {
    const code = view.getUint16(i, true);
    if (code === 0) continue;
    if (code === 0x07) {
      text16 += '\x07';
    } else if (code === 0x0d || code === 0x0a) {
      text16 += '\n';
    } else if (code === 0x0c) {
      text16 += '\n\n';
    } else if (code === 0x09) {
      text16 += '\t';
    } else if (code >= 0x20) {
      text16 += String.fromCharCode(code);
    }
  }

  // Nếu text16 ngắn hoặc rỗng, thử đọc luồng 8-bit
  if (text16.length < 20) {
    let text8 = '';
    for (let i = fcMin; i < streamBytes.byteLength; i++) {
      const b = streamBytes[i];
      if (b === 0) continue;
      if (b === 0x07) {
        text8 += '\x07';
      } else if (b === 0x0d || b === 0x0a) {
        text8 += '\n';
      } else if (b === 0x09) {
        text8 += '\t';
      } else if (b >= 0x20) {
        text8 += String.fromCharCode(b);
      }
    }
    if (text8.length > text16.length) return text8;
  }

  return text16;
}

/**
 * Chuyển đổi toàn diện các thẻ hình ảnh trong Word HTML (img, v:imagedata, v:shape) sang cú pháp Markdown
 */
function convertHtmlImagesToMarkdown(htmlText: string, isInsideTable = false): string {
  let result = htmlText;

  // 1. Chuyển đổi thẻ <v:imagedata ... src="..."> của Word VML
  result = result.replace(/<v:imagedata[^>]+src=["']([^"']+)["'][^>]*>/gi, (_match, src) => {
    return isInsideTable ? `<br>![Hình ảnh](${src})<br>` : `\n\n![Hình ảnh](${src})\n\n`;
  });

  // 2. Chuyển đổi thẻ <img ...> với mọi thứ tự thuộc tính (src, alt, style...)
  result = result.replace(/<img\b([^>]*?)>/gi, (_match, attrs) => {
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch || !srcMatch[1]) return '';
    const src = srcMatch[1];
    const altMatch = attrs.match(/\balt=["']([^"']*)["']/i);
    const alt = altMatch ? altMatch[1] || 'Hình ảnh' : 'Hình ảnh';
    return isInsideTable ? `<br>![${alt}](${src})<br>` : `\n\n![${alt}](${src})\n\n`;
  });

  return result;
}

/**
 * Giải mã tài liệu Word lưu dưới dạng HTML (HTML-based Word document như file xuất từ Chuyen_Doi_PDF_Toan_Hoc.html)
 */
export function parseHtmlWordDocument(rawContent: string): string | null {
  if (!rawContent) return null;
  const isHtml =
    rawContent.includes('<html') ||
    rawContent.includes('<table') ||
    rawContent.includes('<body') ||
    rawContent.includes('xmlns:w=') ||
    rawContent.includes('WordSection1') ||
    rawContent.includes('class="word-table"');

  if (!isHtml) return null;

  // 1. Giải mã các Entity ký tự tiếng Việt dạng &#...; hoặc &#x...;
  let decoded = rawContent
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Dọn dẹp thẻ <head>, <style>, <xml>, <script> TRƯỚC (giữ lại nội dung văn bản và bảng)
  decoded = decoded.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
  decoded = decoded.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  decoded = decoded.replace(/<xml[^>]*>[\s\S]*?<\/xml>/gi, '');
  decoded = decoded.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // 2. Chuyển đổi các bảng <table...> ... </table> thành Markdown Table (BẢO TOÀN HÌNH ẢNH TRONG Ô)
  decoded = decoded.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_tableMatch, tableInner: string) => {
    const rows: string[][] = [];
    const trMatches = tableInner.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

    for (const tr of trMatches) {
      const cells: string[] = [];
      const cellMatches = tr.match(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi) || [];

      for (const cell of cellMatches) {
        // Trích xuất hình ảnh trong ô TRƯỚC khi dọn dẹp các thẻ HTML khác
        let cellContent = convertHtmlImagesToMarkdown(cell, true);

        cellContent = cellContent
          .replace(/<(?:td|th)[^>]*>/gi, '')
          .replace(/<\/(?:td|th)>/gi, '')
          .replace(/<p[^>]*>/gi, '')
          .replace(/<\/p>/gi, '<br>')
          .replace(/<br\s*\/?>/gi, '<br>')
          .replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, '**$1**')
          .replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, '*$1*')
          .replace(/<(?!\/?(?:br)\b)[^>]+>/g, '') // Xóa các thẻ HTML khác, bảo toàn <br> và cú pháp ảnh Markdown
          .replace(/\|/g, '\\|')
          .replace(/(?:<br>\s*)+/g, '<br>')
          .replace(/^<br>|<br>$/g, '')
          .trim();

        cells.push(cellContent || ' ');
      }

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length === 0) return '';

    let maxCols = 0;
    for (const r of rows) {
      maxCols = Math.max(maxCols, r.length);
    }
    for (const r of rows) {
      while (r.length < maxCols) r.push(' ');
    }

    const md: string[] = [];
    md.push(`| ${rows[0].join(' | ')} |`);
    md.push(`| ${Array(maxCols).fill(':---:').join(' | ')} |`);
    for (let i = 1; i < rows.length; i++) {
      md.push(`| ${rows[i].join(' | ')} |`);
    }

    return `\n\n${md.join('\n')}\n\n`;
  });

  // 3. Chuyển đổi toàn bộ hình ảnh còn lại ngoài bảng
  decoded = convertHtmlImagesToMarkdown(decoded, false);

  // 4. Chuyển đổi các thẻ in đậm <b>, <strong> thành **...**
  decoded = decoded.replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, '**$1**');
  decoded = decoded.replace(/<(?:i|em)[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, '*$1*');

  // 5. Xử lý đoạn văn <p>, <br>, <div>
  decoded = decoded.replace(/<p[^>]*>/gi, '\n');
  decoded = decoded.replace(/<\/p>/gi, '\n');
  decoded = decoded.replace(/<br\s*\/?>/gi, '\n');
  decoded = decoded.replace(/<div[^>]*>/gi, '\n');
  decoded = decoded.replace(/<\/div>/gi, '\n');
  decoded = decoded.replace(/<[^>]+>/g, '');

  return normalizeAiMarkdown(decoded);
}

/**
 * Trích xuất toàn bộ ảnh PNG, JPEG nhúng trong dữ liệu nhị phân của tệp Word 97-2003 (.doc)
 */
function extractImagesFromDocBinary(bytes: Uint8Array): string[] {
  const images: string[] = [];
  const len = bytes.byteLength;
  let i = 0;

  while (i < len - 8) {
    // 1. Nhận diện PNG: Magic bytes 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
    if (
      bytes[i] === 0x89 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x4e &&
      bytes[i + 3] === 0x47 &&
      bytes[i + 4] === 0x0d &&
      bytes[i + 5] === 0x0a &&
      bytes[i + 6] === 0x1a &&
      bytes[i + 7] === 0x0a
    ) {
      const start = i;
      let end = -1;
      for (let j = start + 8; j < Math.min(len - 7, start + 20 * 1024 * 1024); j++) {
        if (
          bytes[j] === 0x49 &&
          bytes[j + 1] === 0x45 &&
          bytes[j + 2] === 0x4e &&
          bytes[j + 3] === 0x44
        ) {
          end = j + 8; // IEND + 4 bytes CRC
          break;
        }
      }
      if (end > start && end - start > 100) {
        const pngBytes = bytes.subarray(start, end);
        const base64 = uint8ArrayToBase64(pngBytes);
        images.push(`data:image/png;base64,${base64}`);
        i = end;
        continue;
      }
    }

    // 2. Nhận diện JPEG: Magic bytes 0xFF 0xD8 0xFF
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      const start = i;
      let end = -1;
      for (let j = start + 4; j < Math.min(len - 1, start + 20 * 1024 * 1024); j++) {
        if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
          end = j + 2;
          break;
        }
      }
      if (end > start && end - start > 100) {
        const jpgBytes = bytes.subarray(start, end);
        const base64 = uint8ArrayToBase64(jpgBytes);
        images.push(`data:image/jpeg;base64,${base64}`);
        i = end;
        continue;
      }
    }

    i++;
  }

  return images;
}

/**
 * Đọc và trích xuất chuỗi văn bản và bảng biểu từ định dạng Word (.doc)
 */
export async function parseDocFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // 1. Kiểm tra trước xem có phải là tài liệu Word dạng HTML hay không (như file xuất từ Chuyen_Doi_PDF_Toan_Hoc.html)
  const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
  const rawUtf8 = utf8Decoder.decode(bytes);
  const htmlDocResult = parseHtmlWordDocument(rawUtf8);
  if (htmlDocResult && htmlDocResult.trim().length > 10) {
    return htmlDocResult;
  }

  // 2. Thử trích xuất qua bộ phân tích OLE2 Compound File (Word 97-2003 Binary)
  const ole = parseOleCompoundFile(bytes);
  if (ole) {
    const wordDocStream = ole.findStream('WordDocument');
    if (wordDocStream) {
      const streamBytes = ole.getStreamBytes(wordDocStream.startSector, wordDocStream.size);
      const extracted = extractTextFromWordDocStream(streamBytes);
      if (extracted.trim().length > 10) {
        const md = extractMeaningfulTextChunks(extracted);
        if (md.trim()) {
          const binaryImages = extractImagesFromDocBinary(bytes);
          let finalMd = md;
          if (binaryImages.length > 0) {
            finalMd += '\n\n' + binaryImages.map((img) => `![Hình ảnh](${img})`).join('\n\n');
          }
          return normalizeAiMarkdown(finalMd);
        }
      }
    }
  }

  // 3. Fallback: giải mã chuỗi UTF-16LE / UTF-8
  const utf16Decoder = new TextDecoder('utf-16le', { fatal: false });
  const rawUtf16 = utf16Decoder.decode(bytes);

  const utf16Chunks = extractMeaningfulTextChunks(rawUtf16);
  const utf8Chunks = extractMeaningfulTextChunks(rawUtf8);

  let bestText = utf16Chunks.length > utf8Chunks.length ? utf16Chunks : utf8Chunks;

  if (!bestText.trim()) {
    throw new Error(
      'Không trích xuất được văn bản từ file .doc. Khuyến nghị mở file bằng Microsoft Word và Lưu dưới dạng (.docx) để đạt độ chuẩn xác tối đa.',
    );
  }

  const binaryImages = extractImagesFromDocBinary(bytes);
  if (binaryImages.length > 0) {
    bestText += '\n\n' + binaryImages.map((img) => `![Hình ảnh](${img})`).join('\n\n');
  }

  return normalizeAiMarkdown(bestText);
}

function extractMeaningfulTextChunks(raw: string): string {
  // Thay thế ký tự ngắt ô \x07 (ASCII 7) của Word 97-2003 bằng token phân cách ô
  const preprocessed = raw.replace(/\x07/g, ' __DOC_CELL_SEP__ ');

  // Tách văn bản theo các dòng đoạn văn (giữ nguyên token phân cách ô)
  const rawLines = preprocessed.split(/[\r\n\x00-\x06\x08\x0B\x0C\x0E-\x1F]+/);

  const blocks: string[] = [];
  let pendingTableRows: string[][] = [];

  function flushPendingTable() {
    if (pendingTableRows.length === 0) return;

    let maxCols = 0;
    for (const r of pendingTableRows) {
      maxCols = Math.max(maxCols, r.length);
    }

    if (maxCols >= 2) {
      // Đồng đều số cột cho từng hàng
      for (const r of pendingTableRows) {
        while (r.length < maxCols) {
          r.push(' ');
        }
      }

      const mdLines: string[] = [];
      mdLines.push(`| ${pendingTableRows[0].join(' | ')} |`);
      mdLines.push(`| ${Array(maxCols).fill(':---:').join(' | ')} |`);
      for (let i = 1; i < pendingTableRows.length; i++) {
        mdLines.push(`| ${pendingTableRows[i].join(' | ')} |`);
      }
      blocks.push(mdLines.join('\n'));
    } else {
      // Nếu chỉ có 1 cột thì đẩy ra như text bình thường
      for (const r of pendingTableRows) {
        const line = r.join(' ').trim();
        if (line) blocks.push(line);
      }
    }

    pendingTableRows = [];
  }

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Kiểm tra xem dòng này có chứa token phân cách ô bảng hay không
    if (trimmed.includes('__DOC_CELL_SEP__') || (trimmed.includes('\t') && trimmed.split('\t').length >= 3)) {
      const rawCells = trimmed.includes('__DOC_CELL_SEP__')
        ? trimmed.split('__DOC_CELL_SEP__')
        : trimmed.split('\t');

      const cleanCells = rawCells.map((cell) =>
        cell
          .replace(/[^\p{L}\p{N}\p{P}\p{Z}\p{S}\n\r]/gu, '')
          .replace(/\|/g, '\\|')
          .trim(),
      );

      // Cắt bỏ các ô rỗng thừa ở đầu và đuôi do ký tự phân cách ô cuối dòng
      while (cleanCells.length > 0 && cleanCells[cleanCells.length - 1] === '') {
        cleanCells.pop();
      }
      while (cleanCells.length > 0 && cleanCells[0] === '') {
        cleanCells.shift();
      }

      if (cleanCells.length >= 2) {
        pendingTableRows.push(cleanCells.map((c) => c || ' '));
        continue;
      }
    }

    // Nếu không phải là hàng bảng, kết xuất bảng đang chờ trước đó (nếu có)
    flushPendingTable();

    // Làm sạch dòng văn bản thông thường
    const cleanLine = trimmed
      .replace(/__DOC_CELL_SEP__/g, ' ')
      .replace(/[^\p{L}\p{N}\p{P}\p{Z}\p{S}\n\r]/gu, '')
      .trim();

    if (cleanLine.length >= 2 && /[\p{L}\p{N}$]/u.test(cleanLine)) {
      blocks.push(cleanLine);
    }
  }

  // Kết xuất bảng cuối cùng nếu có
  flushPendingTable();

  return blocks.join('\n\n');
}

/**
 * Hàm tổng hợp nhận diện và đọc file tài liệu (.docx, .doc, .txt, .md, .tex)
 */
export async function readDocumentOrTextFile(file: File): Promise<ParsedDocumentResult> {
  const name = file.name;
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();

  let content = '';
  let fileType: ParsedDocumentResult['fileType'] = 'unknown';

  if (ext === '.docx') {
    fileType = 'docx';
    content = await parseDocxFile(file);
  } else if (ext === '.doc') {
    fileType = 'doc';
    content = await parseDocFile(file);
  } else if (ext === '.txt' || ext === '.md' || ext === '.tex' || ext === '.latex') {
    fileType = 'text';
    content = await file.text();
    content = normalizeAiMarkdown(content);
  } else {
    fileType = 'text';
    content = await file.text();
    content = normalizeAiMarkdown(content);
  }

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const characters = content.length;
  const displayMath = content.match(/\$\$[\s\S]*?\$\$/g)?.length ?? 0;
  const inlineMath = content.replace(/\$\$[\s\S]*?\$\$/g, '').match(/\$(?!\s)(?:\\.|[^$\n])+?\$/g)?.length ?? 0;
  const tableCount = (content.match(/\|[\s\S]*?\|[\s\S]*?\n\|(?:\s*---+\s*\|)+/g) ?? []).length;

  return {
    content,
    filename: name,
    fileType,
    stats: {
      words,
      characters,
      mathCount: displayMath + inlineMath,
      tableCount,
    },
  };
}
