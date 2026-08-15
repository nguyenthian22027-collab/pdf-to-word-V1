import { useEffect, useRef, useState } from 'react';
import { Braces, ChevronDown, FileDown, LoaderCircle, Sigma } from 'lucide-react';
import { safeBaseName } from '../services/content';

type WordMode = 'equation' | 'mathtype' | 'doc_mathtype';

interface Props {
  content: string;
  baseName: string;
  disabled?: boolean;
  onMessage: (message: string, isError?: boolean) => void;
}

const options = [
  {
    mode: 'equation' as const,
    label: 'Word Equation (.docx)',
    description: 'Công thức OMML thật qua Pandoc API',
    icon: Sigma,
  },
  {
    mode: 'mathtype' as const,
    label: 'Word MathType OLE (.docx)',
    description: 'Công thức MathType qua backend chuyển đổi',
    icon: Braces,
  },
  {
    mode: 'doc_mathtype' as const,
    label: 'Word MathType (.doc)',
    description: 'Siêu tương thích offline (chuyển đổi bằng Alt+\\)',
    icon: FileDown,
  },
];

export function ExportMenu({ content, baseName, disabled, onMessage }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<WordMode | ''>('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function run(mode: WordMode) {
    if (!content.trim() || busy || disabled) return;
    setBusy(mode);
    setOpen(false);
    const name = safeBaseName(baseName);

    try {
      if (mode === 'equation') {
        const { exportMarkdownToEquationDocx } = await import('../services/docxExportService');
        await exportMarkdownToEquationDocx(content, `${name}_equation.docx`);
        onMessage('Đã tạo Word với công thức Equation/OMML và ảnh OCR.');
      } else if (mode === 'mathtype') {
        const { exportMathTypeDocx } = await import('../services/mathtypeExport');
        const result = await exportMathTypeDocx(content, `${name}_mathtype.docx`);
        onMessage(
          `Đã tạo Word MathType: ${result.converted} công thức${
            result.failed ? `, ${result.failed} công thức lỗi` : ''
          }.`,
          result.failed > 0,
        );
      } else {
        const { exportHtmlMathTypeDoc } = await import('../services/docxExportService');
        exportHtmlMathTypeDoc(content, `${name}_MathType_LaTeX.doc`);
        onMessage('Đã tạo file Word MathType (.doc) siêu tương thích thành công.');
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const hint =
        mode === 'equation'
          ? ' Kiểm tra URL Pandoc hardcode trong src/config/apiConfig.ts, endpoint nhận POST { markdown } và CORS.'
          : ' Kiểm tra URL MathType hardcode trong src/config/apiConfig.ts, endpoint /api/convert-markdown và CORS.';
      onMessage(`Không xuất được Word: ${detail}${hint}`, true);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="export-menu" ref={rootRef}>
      <button
        className="button button-primary"
        type="button"
        disabled={Boolean(busy) || disabled || !content.trim()}
        onClick={() => setOpen((value) => !value)}
      >
        {busy ? <LoaderCircle className="spin" size={18} /> : <FileDown size={18} />}
        {busy ? 'Đang xuất...' : 'Xuất Word'}
        <ChevronDown size={16} className={open ? 'rotate' : ''} />
      </button>

      {open && (
        <div className="export-popover">
          <div className="export-heading">Chọn loại công thức</div>
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.mode}
                type="button"
                className="export-option"
                disabled={Boolean(busy)}
                onClick={() => void run(option.mode)}
              >
                <span className="export-option-icon">
                  <Icon size={19} />
                </span>
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
