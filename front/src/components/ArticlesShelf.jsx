import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, FileText } from 'lucide-react';
import { ARTICLES } from '../lib/articles';

// The articles, in a framed shelf that scrolls sideways. Each card opens its
// PDF in a new tab. A touch screen scrolls it by hand; with a mouse, the
// arrows do, since most mice have no sideways wheel.
export default function ArticlesShelf() {
  const track = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  // The page is right-to-left, so scrollLeft runs from 0 down to minus the
  // overflow.
  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const travelled = Math.abs(el.scrollLeft);
    const room = el.scrollWidth - el.clientWidth;
    setEdges({ start: travelled <= 1, end: travelled >= room - 1 });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // One step is most of the visible width, so the next cards come in whole.
  const step = (direction) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  if (ARTICLES.length === 0) return null;

  return (
    <section className="section" aria-labelledby="articles-title">
      <fieldset className="articles-shelf">
        <legend className="articles-shelf-legend">
          <h2 id="articles-title">مقالات</h2>
        </legend>

        <div className="articles-shelf-arrows">
          <button
            type="button"
            className="articles-shelf-arrow"
            aria-label="مقاله‌های قبلی"
            disabled={edges.start}
            onClick={() => step(1)}
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            className="articles-shelf-arrow"
            aria-label="مقاله‌های بعدی"
            disabled={edges.end}
            onClick={() => step(-1)}
          >
            <ChevronLeft size={18} />
          </button>
        </div>

        <div className="articles-shelf-track" ref={track} onScroll={measure}>
          {ARTICLES.map((article) => (
            <a
              key={article.file}
              className="article-card"
              href={`/articles/${article.file}`}
              target="_blank"
              rel="noopener"
            >
              <span className="article-card-cover" aria-hidden="true">
                <FileText size={34} strokeWidth={1.6} />
                <span className="article-card-type">PDF</span>
              </span>
              <span className="article-card-title">{article.title}</span>
              {article.summary ? (
                <span className="article-card-summary">{article.summary}</span>
              ) : null}
              <span className="article-card-open">
                مطالعه
                <ExternalLink size={13} />
                <span className="sr-only">(در زبانه‌ی جدید)</span>
              </span>
            </a>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
