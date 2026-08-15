/** Chuyển đổi khối LaTeX \begin{tabular}{...} ... \end{tabular} sang bảng Markdown | ... | ... | */
export function latexTabularToMarkdown(input: string): string {
  return input.replace(
    /\\begin\{(?:tabular|table)\}(?:\{[^}]*\})?([\s\S]*?)\\end\{(?:tabular|table)\}/gi,
    (_match, body: string) => {
      // Tách hàng bằng \\ hoặc \tabularnewline
      const rawRows = body
        .replace(/\\(?:hline|toprule|midrule|bottomrule|cline\{[^}]*\})/g, '')
        .split(/\\\\|\\tabularnewline/)
        .map((r) => r.trim())
        .filter(Boolean);

      if (rawRows.length === 0) return '';

      const tableData: string[][] = [];
      let maxCols = 0;

      for (const row of rawRows) {
        const cells = row.split('&').map((c) => c.trim());
        if (cells.length > 0 && cells.some((c) => c.length > 0)) {
          maxCols = Math.max(maxCols, cells.length);
          tableData.push(cells);
        }
      }

      if (tableData.length === 0 || maxCols === 0) return '';

      for (const row of tableData) {
        while (row.length < maxCols) {
          row.push(' ');
        }
      }

      const mdLines: string[] = [];
      mdLines.push(`| ${tableData[0].join(' | ')} |`);
      mdLines.push(`| ${Array(maxCols).fill(':---:').join(' | ')} |`);
      for (let r = 1; r < tableData.length; r++) {
        mdLines.push(`| ${tableData[r].join(' | ')} |`);
      }

      return `\n\n${mdLines.join('\n')}\n\n`;
    },
  );
}

/** Tự động nhận diện và phục hồi các bảng thống kê / bảng điểm / bảng tần số bị dính số/chữ */
export function restoreJumbledStatisticalTables(input: string): string {
  let result = input;

  // 1. Bảng Điểm / Giá trị và Tần số (như câu 11: Điểm (x)025678910CộngTần số (n)125691043N=40)
  result = result.replace(
    /(?:(?:Điểm|Giá\s*trị)\s*(?:\([xX]\)|x)?)\s*([\d\s.,]+(?:Cộng)?)\s*(?:Tần\s*số\s*(?:\([nN]\)|n)?)\s*([\d\s.,]+(?:N\s*=\s*\d+)?)/gi,
    (match, scoresRaw: string, freqsRaw: string) => {
      let hasCong = false;
      let cleanScores = scoresRaw.trim();
      if (/Cộng$/i.test(cleanScores)) {
        hasCong = true;
        cleanScores = cleanScores.replace(/Cộng$/i, '').trim();
      }

      let totalN = '';
      let cleanFreqs = freqsRaw.trim();
      const totalMatch = cleanFreqs.match(/N\s*=\s*\d+$/i);
      if (totalMatch) {
        totalN = `$${totalMatch[0].replace(/\s+/g, ' ')}$`;
        cleanFreqs = cleanFreqs.slice(0, totalMatch.index).trim();
      }

      function extractTokens(str: string): string[] {
        if (str.includes(' ') || str.includes('\t')) {
          return str.split(/[\s\t]+/).filter(Boolean);
        }
        const nums: string[] = [];
        for (let i = 0; i < str.length; i++) {
          if (str[i] === '1' && str[i + 1] === '0') {
            nums.push('10');
            i++;
          } else if (/[\d.,]/.test(str[i])) {
            nums.push(str[i]);
          }
        }
        return nums;
      }

      const scores = extractTokens(cleanScores);
      const freqs = extractTokens(cleanFreqs);

      if (hasCong) scores.push('Cộng');
      if (totalN) freqs.push(totalN);

      if (scores.length >= 2 || freqs.length >= 2) {
        const maxCols = Math.max(scores.length, freqs.length);
        while (scores.length < maxCols) scores.push(' ');
        while (freqs.length < maxCols) freqs.push(' ');

        const headers = ['Điểm ($x$)', ...scores];
        const align = Array(headers.length).fill(':---:');
        const row2 = ['Tần số ($n$)', ...freqs];

        return `\n\n| ${headers.join(' | ')} |\n| ${align.join(' | ')} |\n| ${row2.join(' | ')} |\n\n`;
      }

      return match;
    },
  );

  return result;
}

/** Tự động sửa chữa các bảng Markdown bị lỗi ngắt dòng, thiếu separator, dính dòng trống giữa các hàng */
export function fixBrokenMarkdownTables(input: string): string {
  let result = input;

  // 1. Nối liền các hàng của bảng Markdown nếu bị phân cách bởi 1 hoặc nhiều dòng trống (như câu 4 lỗi)
  let prev = '';
  while (prev !== result) {
    prev = result;
    result = result.replace(/(^[ \t]*\|[^\n]+\|[ \t]*)\n(?:[ \t]*\n)+([ \t]*\|[^\n]+\|[ \t]*)/gm, '$1\n$2');
  }

  // 2. Chèn dòng phân cách (| :---: | :---: |) nếu bảng bị thiếu dòng phân cách ở dòng 2
  result = result.replace(/(?:^|\n)([ \t]*\|[^\n]+\|[ \t]*(?:\n[ \t]*\|[^\n]+\|[ \t]*)+)/g, (match, tableBlock: string) => {
    const lines = tableBlock.trim().split('\n');
    if (lines.length < 2) return match;
    const line2 = lines[1].trim();
    if (!/^[|\s:-]+$/.test(line2)) {
      const cols = lines[0].replace(/^\||\|$/g, '').split('|').length;
      const separator = `| ${Array(cols).fill(':---:').join(' | ')} |`;
      lines.splice(1, 0, separator);
      return `\n\n${lines.join('\n')}\n\n`;
    }
    return match;
  });

  return result;
}

/** Chuẩn hóa Markdown/LaTeX do AI trả về để xem trước và xuất Word ổn định. */
export function normalizeAiMarkdown(input: string): string {
  let text = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();

  const fenced = text.match(/^```(?:markdown|md|latex|tex)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1].trim();

  // Tự động chuyển \begin{tabular} nếu có
  text = latexTabularToMarkdown(text);

  // Tự động nhận diện và dựng lại bảng thống kê bị dính số/chữ
  text = restoreJumbledStatisticalTables(text);

  // Tự động nối liền các hàng bảng biểu bị AI tách bằng dòng trống
  text = fixBrokenMarkdownTables(text);

  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) => `\n\n$$\n${formula.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, formula: string) => `$${formula.trim()}$`)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export function safeBaseName(value: string): string {
  const cleaned = value
    .trim()
    .replace(/\.(pdf|docx?|md|txt|png|jpe?g|webp)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return cleaned || 'tai_lieu_ocr';
}

export function countMathExpressions(markdown: string): number {
  const display = markdown.match(/\$\$[\s\S]*?\$\$/g)?.length ?? 0;
  const withoutDisplay = markdown.replace(/\$\$[\s\S]*?\$\$/g, '');
  const inline = withoutDisplay.match(/\$(?!\s)(?:\\.|[^$\n])+?\$/g)?.length ?? 0;
  return display + inline;
}

export function countEmbeddedImages(markdown: string): number {
  return markdown.match(/!\[[^\]]*\]\((?:data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+|https?:\/\/[^)]+|blob:[^)]+|[^)\s]+\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi)?.length ?? 0;
}

export function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function joinPageMarkdown(pageContents: string[]): string {
  return pageContents
    .map((content, index) => {
      const normalized = normalizeAiMarkdown(content);
      return normalized ? `<!-- Trang ${index + 1} -->\n\n${normalized}` : '';
    })
    .filter(Boolean)
    .join('\n\n***\n\n');
}


/** Tách kết quả OCR theo marker <!-- Trang N --> do AI trả về. */
export function splitMarkdownByPage(markdown: string): Map<number, string> {
  const result = new Map<number, string>();
  const normalized = markdown.replace(/\r\n?/g, '\n');
  const marker = /<!--\s*Trang\s+(\d+)\s*-->/gi;
  const matches = [...normalized.matchAll(marker)];

  if (matches.length === 0) {
    if (normalized.trim()) result.set(1, normalized.trim());
    return result;
  }

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const pageNumber = Math.max(1, Number(current[1]) || index + 1);
    const start = (current.index ?? 0) + current[0].length;
    const end = next?.index ?? normalized.length;
    result.set(pageNumber, normalized.slice(start, end).trim());
  }

  return result;
}
