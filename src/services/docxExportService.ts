import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { PANDOC_API_URL, isHardcodedApiConfigured } from '../config/apiConfig';
import { fixBrokenMarkdownTables } from './content';

// API Pandoc chuyển Markdown ($...$) -> DOCX với công thức Equation/OMML thật.
// URL được hardcode tập trung trong src/config/apiConfig.ts; không dùng biến môi trường.
export function getConfiguredPandocApiUrl(): string {
  if (!isHardcodedApiConfigured(PANDOC_API_URL)) {
    throw new Error(
      'Chưa hardcode URL Pandoc thật trong src/config/apiConfig.ts.'
    );
  }
  return PANDOC_API_URL;
}

export function splitRawToParagraphs(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.split(/\n{1,}/).map((x) => x.trim()).filter(Boolean);
}

/** Xuất DOCX thô (không công thức) bằng thư viện docx — dùng làm fallback. */
export async function exportRawLatexDocx(raw: string, filename = 'edited_latex.docx') {
  const paragraphs = splitRawToParagraphs(raw);

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs.length
          ? paragraphs.map((p) => new Paragraph({ children: [new TextRun(p)] }))
          : [new Paragraph({ children: [new TextRun('')] })],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}

// ── Chế độ LaTeX: giữ nguyên $...$ dưới dạng văn bản trong .docx (offline) ─────

/** Tách **in đậm** trong 1 dòng, giữ nguyên $...$ là văn bản. */
function markdownLineToRuns(line: string, bold = false): TextRun[] {
  const runs: TextRun[] = [];
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== '');
  for (const part of parts) {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    } else {
      runs.push(new TextRun({ text: part, bold }));
    }
  }
  if (runs.length === 0) runs.push(new TextRun({ text: '', bold }));
  return runs;
}

/**
 * Xuất .docx GIỮ NGUYÊN công thức LaTeX ($...$) ở dạng văn bản.
 * Không cần máy chủ, chạy hoàn toàn offline. Font Times New Roman.
 */
export async function exportMarkdownToLatexDocx(markdown: string, filename: string) {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const children: Paragraph[] = lines.map((raw) => {
    const line = raw.replace(/\u00a0/g, ' ');

    // Tiêu đề Markdown (#, ##, ###)
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level =
        h[1].length === 1
          ? HeadingLevel.HEADING_1
          : h[1].length === 2
          ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;
      return new Paragraph({ heading: level, children: markdownLineToRuns(h[2], true) });
    }

    if (!line.trim()) return new Paragraph({ children: [new TextRun('')] });
    return new Paragraph({ children: markdownLineToRuns(line), spacing: { after: 60 } });
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Times New Roman', size: 26 } } } }, // 13pt
    sections: [{ properties: {}, children: children.length ? children : [new Paragraph({ children: [new TextRun('')] })] }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}

function escapeMarkdownText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([*_`#\[\]<>])/g, '\\$1')
    .replace(/\u00a0/g, ' ');
}

function stripMathDelimiters(value: string) {
  let latex = (value || '').replace(/\u00a0/g, ' ').trim();

  if ((latex.startsWith('$$') && latex.endsWith('$$')) || (latex.startsWith('\\[') && latex.endsWith('\\]'))) {
    latex = latex.replace(/^\$\$|\$\$$/g, '').replace(/^\\\[|\\\]$/g, '').trim();
  }

  if ((latex.startsWith('$') && latex.endsWith('$')) || (latex.startsWith('\\(') && latex.endsWith('\\)'))) {
    latex = latex.replace(/^\$|\$$/g, '').replace(/^\\\(|\\\)$/g, '').trim();
  }

  return latex;
}

function wrapLatexForPandoc(latex: string, inline = true) {
  const clean = stripMathDelimiters(latex);
  if (!clean) return '';
  return inline ? `$${clean}$` : `\n\n$$\n${clean}\n$$\n\n`;
}

function normalizeExamLine(line: string) {
  return line.trim();
}

/** Chuyển văn bản LaTeX thô -> Markdown chuẩn Pandoc (giữ $...$). */
export function rawLatexTextToPandocMarkdown(raw: string) {
  const text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\u00a0/g, ' ');

  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text.startsWith('$$', i)) {
      const end = text.indexOf('$$', i + 2);
      if (end !== -1) {
        const latex = text.slice(i + 2, end);
        tokens.push(wrapLatexForPandoc(latex, false));
        i = end + 2;
        continue;
      }
    }

    if (text[i] === '$') {
      const end = text.indexOf('$', i + 1);
      if (end !== -1) {
        const latex = text.slice(i + 1, end);
        tokens.push(wrapLatexForPandoc(latex, true));
        i = end + 1;
        continue;
      }
    }

    let next = text.length;
    const nextBlock = text.indexOf('$$', i);
    const nextInline = text.indexOf('$', i);
    if (nextBlock !== -1) next = Math.min(next, nextBlock);
    if (nextInline !== -1) next = Math.min(next, nextInline);

    tokens.push(escapeMarkdownText(text.slice(i, next)));
    i = next;
  }

  return (
    tokens
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .split(/\n+/)
      .map((line) => normalizeExamLine(line))
      .filter(Boolean)
      .join('\n\n') + '\n'
  );
}

/**
 * Pandoc bật extension yaml_metadata_block theo mặc định. Nếu nội dung do Gemini
 * sinh ra bắt đầu bằng một đường phân cách `---`, Pandoc có thể hiểu nhầm toàn
 * bộ phần tiếp theo là YAML metadata. Dòng Markdown in đậm như `**Câu 1.**`
 * sau đó sẽ gây lỗi "while scanning an alias".
 *
 * Đổi riêng các đường phân cách `---` nằm ngoài code fence thành `***`.
 * Hai dạng đều là horizontal rule trong Markdown, nhưng `***` không kích hoạt
 * YAML metadata nên không làm thay đổi ý nghĩa hiển thị của tài liệu.
 */
export function sanitizeMarkdownForPandoc(markdown: string): string {
  let normalized = markdown
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ');

  // Tự động nối liền các hàng bảng bị phân cách bởi dòng trống
  normalized = fixBrokenMarkdownTables(normalized);

  // Đổi các ảnh data URI thành placeholder cố định.
  // Điều này giúp Pandoc không bị lỗi/bỏ sót khi xử lý ảnh data URI quá dài trong table.
  let imgIndex = 0;
  normalized = normalized.replace(/!\[([^\]]*)\]\((data:(?:image\/[a-zA-Z0-9.+-]+|[^;]+)?;base64,([^)]+))\)/gi, () => {
    return ` IMGINJECTXYZ${imgIndex++}XYZ `;
  });

  let inFence = false;
  let fenceMarker = '';

  return normalized
    .split('\n')
    .map((line) => {
      const fence = line.match(/^\s*(```+|~~~+)/);
      if (fence) {
        const marker = fence[1][0];
        if (!inFence) {
          inFence = true;
          fenceMarker = marker;
        } else if (marker === fenceMarker) {
          inFence = false;
          fenceMarker = '';
        }
        return line;
      }

      if (!inFence && /^\s*---\s*$/.test(line)) return '***';
      return line;
    })
    .join('\n');
}

/** Gọi Pandoc: Markdown -> DOCX (công thức thành Equation/OMML). */
export async function convertMarkdownToDocx(markdown: string, apiUrl = getConfiguredPandocApiUrl()): Promise<Blob> {
  const safeMarkdown = sanitizeMarkdownForPandoc(markdown);
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown: safeMarkdown }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    const yamlHint = /YAML parse exception|scanning an alias/i.test(message)
      ? ' Nội dung vẫn chứa khối YAML không hợp lệ; hãy thử xóa phần --- ở đầu tài liệu.'
      : '';
    throw new Error(`Pandoc Server Error: ${response.status}${message ? ` - ${message}` : ''}${yamlHint}`);
  }

  return await response.blob();
}

// ── Hậu xử lý DOCX: ép font Times New Roman + tô đậm/màu nhãn câu hỏi ──────────

function fontRunPr() {
  return '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>';
}

function ensureFontInRPr(rPr: string) {
  if (/<w:rFonts\b/.test(rPr)) {
    return rPr.replace(/<w:rFonts\b[^/]*(?:\/>|>[\s\S]*?<\/w:rFonts>)/, fontRunPr());
  }
  return rPr.replace(/<w:rPr>/, `<w:rPr>${fontRunPr()}`);
}

function addRunPrToRuns(xml: string) {
  return xml.replace(/<w:r>([\s\S]*?)<\/w:r>/g, (run, inner) => {
    if (!/<w:t\b/.test(inner)) return run;

    if (/<w:rPr>[\s\S]*?<\/w:rPr>/.test(inner)) {
      const nextInner = inner.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, (rPr: string) => ensureFontInRPr(rPr));
      return `<w:r>${nextInner}</w:r>`;
    }

    return `<w:r><w:rPr>${fontRunPr()}</w:rPr>${inner}</w:r>`;
  });
}

function ensureTimesNewRomanStyles(stylesXml: string) {
  let xml = stylesXml;
  const rFonts = fontRunPr();

  if (
    /<w:docDefaults>[\s\S]*?<w:rPrDefault>[\s\S]*?<w:rPr>[\s\S]*?<\/w:rPr>[\s\S]*?<\/w:rPrDefault>[\s\S]*?<\/w:docDefaults>/.test(
      xml
    )
  ) {
    xml = xml.replace(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/, (block) => {
      if (/<w:rFonts\b/.test(block)) {
        return block.replace(/<w:rFonts\b[^/]*(?:\/>|>[\s\S]*?<\/w:rFonts>)/, rFonts);
      }
      return block.replace(/<w:rPr>/, `<w:rPr>${rFonts}`);
    });
  } else {
    xml = xml.replace(
      /<w:styles([^>]*)>/,
      `<w:styles$1><w:docDefaults><w:rPrDefault><w:rPr>${rFonts}</w:rPr></w:rPrDefault></w:docDefaults>`
    );
  }

  return xml;
}

function decodeXmlText(text: string) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXmlText(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function textSpaceAttr(text: string) {
  return /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
}

function styledRPr(options: { blue?: boolean; bold?: boolean }) {
  return [
    fontRunPr(),
    options.bold ? '<w:b/><w:bCs/>' : '',
    options.blue ? '<w:color w:val="1D4ED8"/>' : '',
  ].join('');
}

function makeTextRun(text: string, options: { blue?: boolean; bold?: boolean }) {
  return `<w:r><w:rPr>${styledRPr(options)}</w:rPr><w:t${textSpaceAttr(text)}>${escapeXmlText(text)}</w:t></w:r>`;
}

function getParagraphText(paragraphXml: string) {
  const parts: string[] = [];
  paragraphXml.replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_m, text) => {
    parts.push(decodeXmlText(text));
    return _m;
  });
  return parts.join('');
}

function detectLeadingLabel(paragraphText: string): { label: string; blue: boolean; bold: boolean } | null {
  const text = paragraphText.replace(/^\s+/, '');

  // Câu 1. / Bài 1. -> in đậm xanh
  let match = text.match(/^((?:Câu|Bài)\s+\d+\s*[\.:])/i);
  if (match) return { label: match[1], blue: true, bold: true };

  // Phương án A. B. C. D. -> in đậm xanh
  match = text.match(/^([A-D]\.)\s*/u);
  if (match) return { label: match[1], blue: true, bold: true };

  // Đúng/sai a) b) c) d) -> in đậm
  match = text.match(/^([a-d]\))\s*/u);
  if (match) return { label: match[1], blue: false, bold: true };

  return null;
}

function styleLeadingLabelInParagraph(paragraphXml: string) {
  const paragraphText = getParagraphText(paragraphXml);
  const detected = detectLeadingLabel(paragraphText);
  if (!detected) return paragraphXml;

  let remaining = detected.label.length;
  let changed = false;

  return paragraphXml.replace(/<w:r>([\s\S]*?)<\/w:r>/g, (run, inner) => {
    if (changed || remaining <= 0 || !/<w:t\b/.test(inner)) return run;

    const textMatch = inner.match(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/);
    if (!textMatch) return run;

    const fullText = decodeXmlText(textMatch[2]);
    const leadingSpaces = fullText.match(/^\s*/)?.[0] || '';
    const textAfterSpaces = fullText.slice(leadingSpaces.length);

    if (!textAfterSpaces.startsWith(detected.label)) return run;

    const restText = textAfterSpaces.slice(detected.label.length);
    changed = true;
    remaining = 0;

    const prefixRun = leadingSpaces ? makeTextRun(leadingSpaces, { bold: false, blue: false }) : '';
    const labelRun = makeTextRun(detected.label, { bold: detected.bold, blue: detected.blue });
    const restRun = restText ? makeTextRun(restText, { bold: false, blue: false }) : '';

    return `${prefixRun}${labelRun}${restRun}`;
  });
}

function applyExamLabelStyles(documentXml: string) {
  return documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) =>
    styleLeadingLabelInParagraph(paragraph)
  );
}

function ensureTableBorders(documentXml: string): string {
  const tableBordersXml = `<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders>`;

  return documentXml.replace(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/g, (_tblPrMatch, inner) => {
    if (/<w:tblBorders\b/.test(inner)) {
      return `<w:tblPr>${inner.replace(/<w:tblBorders\b[\s\S]*?<\/w:tblBorders>/, tableBordersXml)}</w:tblPr>`;
    }
    return `<w:tblPr>${inner}${tableBordersXml}</w:tblPr>`;
  });
}

async function injectMarkdownImagesIntoDocx(zip: JSZip, markdown: string): Promise<void> {
  if (!markdown) return;
  const imgMatches = [
    ...markdown.matchAll(
      /!\[([^\]]*)\]\((data:(?:image\/([a-zA-Z0-9.+-]+)|[^;]+)?;base64,([^)]+))\)/gi,
    ),
  ];
  if (imgMatches.length === 0) return;

  const docXmlFile = zip.file('word/document.xml');
  const relsFile = zip.file('word/_rels/document.xml.rels');
  const contentTypesFile = zip.file('[Content_Types].xml');
  if (!docXmlFile || !relsFile) return;

  let docXml = await docXmlFile.async('string');
  let relsXml = await relsFile.async('string');
  let contentTypesXml = contentTypesFile
    ? await contentTypesFile.async('string')
    : '';

  let relCounter = 500;

  for (let idx = 0; idx < imgMatches.length; idx++) {
    const match = imgMatches[idx];
    const rawFormat = (match[3] || 'png').toLowerCase();
    const base64Data = match[4].replace(/\s+/g, '');

    // Giải mã Base64 sang binary
    try {
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Nhận diện định dạng thực tế từ Magic Bytes
      let ext = 'png';
      let contentType = 'image/png';

      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        ext = 'jpeg';
        contentType = 'image/jpeg';
      } else if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        ext = 'png';
        contentType = 'image/png';
      } else if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
        ext = 'gif';
        contentType = 'image/gif';
      } else if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
        ext = 'bmp';
        contentType = 'image/bmp';
      } else if (
        (bytes.length >= 4 && bytes[0] === 0x01 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x00) ||
        rawFormat.includes('emf')
      ) {
        ext = 'emf';
        contentType = 'image/x-emf';
      } else if (
        (bytes.length >= 4 && bytes[0] === 0xd7 && bytes[1] === 0xcd) ||
        rawFormat.includes('wmf')
      ) {
        ext = 'wmf';
        contentType = 'image/x-wmf';
      } else if (rawFormat.includes('jpeg') || rawFormat.includes('jpg')) {
        ext = 'jpeg';
        contentType = 'image/jpeg';
      }

      const mediaPath = `word/media/embedded_image_${idx + 1}.${ext}`;
      zip.file(mediaPath, bytes);

      relCounter += 1;
      const relId = `rIdEmbedImg${relCounter}`;

      // Thêm quan hệ vào document.xml.rels
      if (!relsXml.includes(`Target="media/embedded_image_${idx + 1}.${ext}"`)) {
        relsXml = relsXml.replace(
          '</Relationships>',
          `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/embedded_image_${idx + 1}.${ext}"/></Relationships>`,
        );
      }

      // Đảm bảo Content_Types có khai báo
      if (
        contentTypesXml &&
        !contentTypesXml.includes(`Extension="${ext}"`)
      ) {
        contentTypesXml = contentTypesXml.replace(
          '</Types>',
          `<Default Extension="${ext}" ContentType="${contentType}"/></Types>`,
        );
      }

      // Tạo khối w:drawing
      const drawingXml = `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="4500000" cy="2250000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${
        1000 + idx
      }" name="Picture ${
        idx + 1
      }"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${
        1000 + idx
      }" name="Picture ${
        idx + 1
      }"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4500000" cy="2250000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;

      const placeholder = `IMGINJECTXYZ${idx}XYZ`;
      
      if (docXml.includes(placeholder)) {
        // Nhúng trực tiếp w:drawing vào thẻ w:r inline chuẩn OpenXML
        docXml = docXml.replace(
          placeholder,
          `</w:t></w:r><w:r>${drawingXml}</w:r><w:r><w:t xml:space="preserve">`
        );
      } else {
        // Fallback: Nếu không tìm thấy placeholder (rất hiếm, có thể do Pandoc ngắt thẻ <w:t> giữa chừng)
        // Dùng regex chỉ match các thẻ XML <...> giữa các ký tự, không bao giờ match text bình thường!
        const safeSplitRegex = new RegExp(
          'I(?:<[^>]+>)*M(?:<[^>]+>)*G(?:<[^>]+>)*I(?:<[^>]+>)*N(?:<[^>]+>)*J(?:<[^>]+>)*E(?:<[^>]+>)*C(?:<[^>]+>)*T(?:<[^>]+>)*X(?:<[^>]+>)*Y(?:<[^>]+>)*Z(?:<[^>]+>)*' + 
          idx.toString().split('').join('(?:<[^>]+>)*') + 
          '(?:<[^>]+>)*X(?:<[^>]+>)*Y(?:<[^>]+>)*Z',
          'i'
        );
        if (safeSplitRegex.test(docXml)) {
           docXml = docXml.replace(
             safeSplitRegex,
             `</w:t></w:r><w:r>${drawingXml}</w:r><w:r><w:t xml:space="preserve">`
           );
        } else {
          // Fallback 2: Tìm đoạn văn hoặc ô bảng theo ngữ cảnh xung quanh
          const matchStart = match.index ?? 0;
          const beforeSnippet = markdown
            .slice(Math.max(0, matchStart - 80), matchStart)
            .replace(/<[^>]+>/g, ' ') // Loại bỏ tag HTML như <br>
            .replace(/[!\[\]()#*`|]/g, ' ')
            .trim();

          if (beforeSnippet.length >= 6) {
            const wordsList = beforeSnippet.split(/\s+/).filter(Boolean).slice(-3);
            if (wordsList.length >= 2) {
              // Dùng (?:<[^>]+>|\s)* để chỉ cho phép các thẻ XML hoặc khoảng trắng xen giữa các từ, không cho phép ký tự văn bản khác!
              const wordsRegexStr = wordsList.join('(?:<[^>]+>|\\s)*');
              const targetP = new RegExp(
                `(<w:p\\b[^>]*>(?:(?!<w:p\\b)[\\s\\S])*?${wordsRegexStr}(?:(?!<w:p\\b)[\\s\\S])*?<\\/w:p>)`,
                'i'
              );
              if (targetP.test(docXml)) {
                docXml = docXml.replace(
                  targetP,
                  `$1<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${drawingXml}</w:r></w:p>`
                );
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('Không thể nhúng ảnh vào docx:', err);
    }
  }

  zip.file('word/document.xml', docXml);
  zip.file('word/_rels/document.xml.rels', relsXml);
  if (contentTypesFile && contentTypesXml) {
    zip.file('[Content_Types].xml', contentTypesXml);
  }
}

export async function applyWordDefaults(blob: Blob, markdown = ''): Promise<Blob> {
  const zip = await JSZip.loadAsync(blob);

  // Nhúng toàn bộ ảnh Base64 vào file docx nếu chưa có
  if (markdown) {
    await injectMarkdownImagesIntoDocx(zip, markdown);
  }

  const documentFile = zip.file('word/document.xml');
  if (documentFile) {
    const documentXml = await documentFile.async('string');
    const withFonts = addRunPrToRuns(documentXml);
    const withLabels = applyExamLabelStyles(withFonts);
    const withTableBorders = ensureTableBorders(withLabels);
    zip.file('word/document.xml', withTableBorders);
  }

  const stylesFile = zip.file('word/styles.xml');
  if (stylesFile) {
    const stylesXml = await stylesFile.async('string');
    zip.file('word/styles.xml', ensureTimesNewRomanStyles(stylesXml));
  }

  return await zip.generateAsync({ type: 'blob' });
}

/**
 * ✅ Điểm vào chính cho OCR:
 * Markdown (đã có $...$, bảng, heading) -> DOCX công thức Equation/OMML thật,
 * ép Times New Roman + style nhãn câu hỏi + viền bảng, rồi tải về.
 */
export async function exportMarkdownToEquationDocx(markdown: string, filename: string) {
  const blob = await convertMarkdownToDocx(markdown, getConfiguredPandocApiUrl());
  const styledBlob = await applyWordDefaults(blob, markdown);
  saveAs(styledBlob, filename);
}

/**
 * Điểm vào cho văn bản LaTeX thô (không phải markdown): tokenize trước rồi xuất.
 */
export async function exportViaEquationApi(raw: string, filename: string, apiUrl?: string) {
  const markdown = rawLatexTextToPandocMarkdown(raw);
  if (!apiUrl) {
    const blob = await convertMarkdownToDocx(markdown, getConfiguredPandocApiUrl());
    const styledBlob = await applyWordDefaults(blob);
    saveAs(styledBlob, filename);
    return;
  }

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw, markdown, filename }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Equation API lỗi ${res.status}`);
  }

  const blob = await res.blob();
  const styledBlob = await applyWordDefaults(blob);
  saveAs(styledBlob, filename);
}

/**
 * Xuất tài liệu Word MathType (.doc) siêu tương thích theo đúng cơ chế của Chuyen_Doi_PDF_Toan_Hoc.html.
 * Chạy 100% offline, mở ngay trên mọi phiên bản Word, giữ nguyên bảng biểu và công thức toán LaTeX ($...$)
 * để người dùng nhấn phím tắt Alt+\ trong Word là chuyển đổi toàn bộ sang MathType.
 */
export function exportHtmlMathTypeDoc(markdown: string, filename = 'TaiLieu_MathType_LaTeX.doc'): void {
  const escapeUnicodeForWord = (str: string) =>
    str.replace(/[^\x00-\x7F]/g, (char) => '&#' + char.charCodeAt(0) + ';');

  const escapeHtml = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let htmlText = markdown;

  // 1. Chuyển đổi bảng Markdown sang bảng HTML có viền nét (xử lý cả hình ảnh trong ô)
  htmlText = htmlText.replace(/(?:^|\n)([ \t]*\|.*\|[ \t]*(?:\n[ \t]*\|.*\|[ \t]*)+)/g, (_match, tableBlock: string) => {
    const rows = tableBlock.trim().split('\n');
    let htmlTable = '<table class="word-table" border="1" cellpadding="6" cellspacing="0">';
    rows.forEach((row, rIdx) => {
      const inner = row.trim().replace(/^\||\|$/g, '');
      if (/^[ \-:|]+$/.test(inner)) return;
      htmlTable += '<tr>';
      const cells = inner.split('|');
      const tag = rIdx === 0 ? 'th' : 'td';
      cells.forEach((cell) => {
        let cellHtml = cell.trim();
        // Chuyển đổi ảnh Markdown trong ô sang <img>
        cellHtml = cellHtml.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
          return `<div style="text-align: center; margin: 4pt 0;"><img src="${src}" alt="${escapeHtml(alt)}" style="max-width: 100%; height: auto; display: inline-block; border-radius: 4px;" /></div>`;
        });
        htmlTable += `<${tag} style="border: 1pt solid #475569; padding: 4pt 6pt;">${cellHtml}</${tag}>`;
      });
      htmlTable += '</tr>';
    });
    htmlTable += '</table>';
    return `\n\n${htmlTable}\n\n`;
  });

  // 2. Chuyển đổi toàn bộ hình ảnh ngoài bảng sang thẻ <img> chuẩn Word
  htmlText = htmlText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => {
    return `\n\n<div style="text-align: center; margin: 8pt 0;"><img src="${src}" alt="${escapeHtml(alt)}" style="max-width: 100%; height: auto; display: inline-block; border-radius: 4px;" /></div>\n\n`;
  });

  // 3. Chuyển đổi công thức toán LaTeX sang dạng $...$ và $$...$$ an toàn
  htmlText = htmlText.replace(/\$\$([\s\S]*?)\$\$/g, (_m, math: string) => `\n\n$$${escapeHtml(math.trim())}$$\n\n`);
  htmlText = htmlText.replace(/\$([^$]*?)\$/g, (_m, math: string) => `$${escapeHtml(math.trim())}$`);

  // 4. In đậm và in nghiêng
  htmlText = htmlText.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  htmlText = htmlText.replace(/\*(.*?)\*/g, '<i>$1</i>');

  // 5. Định dạng các đoạn văn và phương án trắc nghiệm A/B/C/D
  htmlText = htmlText
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (/^<\/?(table|tbody|thead|tr|th|td|div|p)/i.test(trimmed)) return line;
      if (!trimmed) return '';
      let style = "margin: 0; font-family: 'Times New Roman', serif; font-size: 13pt; line-height: 1.15;";
      if (/^(\**|)(A|B|C|D)\1[\.\)]/.test(trimmed)) style += ' margin-left: 30px;';
      return `<p style="${style}">${line}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  // 6. Khung bao tài liệu Word HTML
  const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>Word MathType</title>
<style>
  @page WordSection1 { size: 595.3pt 841.9pt; margin: 56.7pt; }
  div.WordSection1 { page: WordSection1; }
  body { font-family: 'Times New Roman', serif; font-size: 13pt; line-height: 1.15; }
  table.word-table { border-collapse: collapse; width: 100%; border: 1pt solid windowtext; margin: 4pt 0; page-break-inside: auto !important; }
  table.word-table tr { page-break-inside: auto !important; page-break-after: auto !important; }
  table.word-table td, table.word-table th { border: 1pt solid windowtext; padding: 4pt; vertical-align: top; page-break-inside: auto !important; }
  table.word-table p { margin: 2pt 0; }
  img { max-width: 100%; height: auto; }
</style>
</head><body lang="vi-VN"><div class="WordSection1">`;
  const footer = `</div></body></html>`;

  const safeHtml = escapeUnicodeForWord(header + htmlText + footer);
  const blob = new Blob([safeHtml], { type: 'application/msword' });
  const finalFilename = filename.endsWith('.doc') || filename.endsWith('.docx') ? filename.replace(/\.docx$/, '.doc') : `${filename}.doc`;
  saveAs(blob, finalFilename);
}
