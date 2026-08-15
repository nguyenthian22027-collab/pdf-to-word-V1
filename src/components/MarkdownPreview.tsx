import { useEffect, useState } from 'react';
import { Download, ImageOff, Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

interface Props {
  content: string;
}

interface LightboxImage {
  src: string;
  alt: string;
}

export function MarkdownPreview({ content }: Props) {
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!lightbox) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightbox(null);
      if (event.key === '+' || event.key === '=') {
        setZoom((value) => Math.min(4, Number((value + 0.25).toFixed(2))));
      }
      if (event.key === '-') {
        setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))));
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [lightbox]);

  useEffect(() => {
    setZoom(1);
  }, [lightbox?.src]);

  if (!content.trim()) {
    return (
      <div className="preview-empty">
        Kết quả OCR, công thức LaTeX và hình đã cắt sẽ hiển thị tại đây.
      </div>
    );
  }

  return (
    <>
      <article className="markdown-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          urlTransform={(value) => value}
          components={{
            img: ({ alt, src }) => {
              const imageSrc = typeof src === 'string' ? src : '';
              const imageAlt = alt?.trim() || 'Hình OCR';
              return (
                <PreviewFigure
                  src={imageSrc}
                  alt={imageAlt}
                  onOpen={() => {
                    if (imageSrc) setLightbox({ src: imageSrc, alt: imageAlt });
                  }}
                />
              );
            },
            a: ({ children, ...props }) => (
              <a {...props} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </article>

      {lightbox && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`Xem ảnh: ${lightbox.alt}`}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setLightbox(null);
          }}
        >
          <div className="image-lightbox-toolbar">
            <span title={lightbox.alt}>{lightbox.alt}</span>
            <div>
              <button
                type="button"
                onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.25).toFixed(2))))}
                title="Thu nhỏ"
              >
                <Minus size={18} />
              </button>
              <strong>{Math.round(zoom * 100)}%</strong>
              <button
                type="button"
                onClick={() => setZoom((value) => Math.min(4, Number((value + 0.25).toFixed(2))))}
                title="Phóng to"
              >
                <Plus size={18} />
              </button>
              <button type="button" onClick={() => setZoom(1)} title="Về kích thước ban đầu">
                <RotateCcw size={18} />
              </button>
              <button
                type="button"
                onClick={() => downloadPreviewImage(lightbox.src, lightbox.alt)}
                title="Tải ảnh"
              >
                <Download size={18} />
              </button>
              <button type="button" onClick={() => setLightbox(null)} title="Đóng">
                <X size={20} />
              </button>
            </div>
          </div>
          <div className="image-lightbox-stage">
            <img
              src={lightbox.src}
              alt={lightbox.alt}
              style={{ transform: `scale(${zoom})` }}
              draggable={false}
            />
          </div>
        </div>
      )}
    </>
  );
}

function PreviewFigure({
  src,
  alt,
  onOpen,
}: {
  src: string;
  alt: string;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const isVectorMetafile =
    src?.includes('x-emf') ||
    src?.includes('x-wmf') ||
    src?.includes('/emf') ||
    src?.includes('/wmf');

  if (!src) {
    return (
      <figure className="ocr-figure ocr-figure-error">
        <div>
          <ImageOff size={28} />
          <strong>Không có dữ liệu hình ảnh</strong>
          <span>{alt}</span>
        </div>
      </figure>
    );
  }

  if (failed || isVectorMetafile) {
    return (
      <figure className="ocr-figure ocr-figure-vector" style={{ maxWidth: '100%', margin: '1rem auto' }}>
        <div style={{ padding: '16px', background: 'rgba(2, 132, 199, 0.05)', border: '1px dashed #0284c7', borderRadius: '8px', textAlign: 'center' }}>
          <Maximize2 size={24} style={{ color: '#0284c7', margin: '0 auto 6px', display: 'inline-block' }} />
          <strong style={{ display: 'block', color: '#0369a1', fontSize: '13px' }}>{alt || 'Hình vẽ hình học / Sơ đồ biểu diễn'}</strong>
          <span style={{ fontSize: '11px', color: '#64748b' }}>Định dạng vector Word (EMF/WMF) — đã bảo toàn nguyên vẹn để xuất sang Word DOCX</span>
        </div>
        <figcaption>{alt}</figcaption>
      </figure>
    );
  }

  return (
    <figure className="ocr-figure">
      <button
        type="button"
        className="ocr-image-open"
        onClick={onOpen}
        title="Bấm để phóng to hình"
      >
        <img
          src={src}
          alt={alt}
          loading="eager"
          decoding="async"
          onError={() => setFailed(true)}
        />
        <span className="ocr-image-zoom-hint">
          <Maximize2 size={15} /> Phóng to
        </span>
      </button>
      <figcaption>{alt}</figcaption>
    </figure>
  );
}

function downloadPreviewImage(src: string, alt: string) {
  const anchor = document.createElement('a');
  anchor.href = src;
  anchor.download = `${safeImageName(alt)}.${mimeExtension(src)}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function safeImageName(value: string) {
  const cleaned = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || 'hinh_ocr';
}

function mimeExtension(src: string) {
  const match = src.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/i);
  const mime = match?.[1]?.toLowerCase() || 'png';
  if (mime === 'jpeg') return 'jpg';
  if (mime === 'svg+xml') return 'svg';
  return mime.replace(/[^a-z0-9]/g, '') || 'png';
}
