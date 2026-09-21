import { useMemo } from 'react';

type Node =
  | { t: 'p'; children: Inline[] }
  | { t: 'h'; level: number; children: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'pre'; code: string }
  | { t: 'table'; head: string[]; rows: string[][] };

type Inline =
  | { t: 'text'; s: string }
  | { t: 'code'; s: string }
  | { t: 'bold'; s: string }
  | { t: 'a'; s: string; href: string }
  | { t: 'img'; alt: string; src: string };

function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|!\[\[?[^\]]*\]\]?\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: 'text', s: s.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith('**')) out.push({ t: 'bold', s: tok.slice(2, -2) });
    else if (tok.startsWith('`')) out.push({ t: 'code', s: tok.slice(1, -1) });
    else if (tok.startsWith('![')) {
      const mm = tok.match(/^!\[(?:\[(.*?)\]|(.*?))\]\(([^)\s]+)\)$/);
      out.push({ t: 'img', alt: mm?.[1] ?? mm?.[2] ?? '', src: mm?.[3] ?? '' });
    } else {
      const mm = tok.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
      out.push({ t: 'a', s: mm?.[1] ?? tok, href: mm?.[2] ?? '' });
    }
    last = m.index + tok.length;
  }
  if (last < s.length) out.push({ t: 'text', s: s.slice(last) });
  return out;
}

function renderInline(nodes: Inline[], k: string | number, imgBase?: string) {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'bold': return <strong key={`${k}-${i}`}>{n.s}</strong>;
      case 'code': return <code key={`${k}-${i}`}>{n.s}</code>;
      case 'a': return <a key={`${k}-${i}`} href={n.href} target="_blank" rel="noreferrer">{n.s}</a>;
      case 'img': {
        const src = /^https?:/.test(n.src) || n.src.startsWith('/api/')
          ? n.src
          : imgBase
            ? `${imgBase}?p=${encodeURIComponent(n.src)}`
            : n.src;
        return <img key={`${k}-${i}`} className="md-img" src={src} alt={n.alt} loading="lazy" />;
      }
      default: return <span key={`${k}-${i}`}>{n.s}</span>;
    }
  });
}

function parseBlocks(text: string): Node[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Node[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push({ t: 'pre', code: code.join('\n') });
    } else if (/^#{1,3}\s/.test(l)) {
      blocks.push({ t: 'h', level: l.match(/^#+/)![0].length, children: parseInline(l.replace(/^#+\s/, '')) });
      i++;
    } else if (/^\s*[-*]\s+/.test(l)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(parseInline(lines[i++].replace(/^\s*[-*]\s+/, '')));
      blocks.push({ t: 'ul', items });
    } else if (/^\s*\d+[.、]\s+/.test(l)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*\d+[.、]\s+/.test(lines[i])) items.push(parseInline(lines[i++].replace(/^\s*\d+[.、]\s+/, '')));
      blocks.push({ t: 'ol', items });
    } else if (l.trim().startsWith('|') && i + 1 < lines.length && /\|/.test(lines[i + 1]) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      // 表格：| 头 | 分隔行 |... （GFM 风格，cell 内联 markdown 保留）
      const parseRow = (x: string) => x.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = parseRow(l);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(parseRow(lines[i++]));
      blocks.push({ t: 'table', head, rows });
    } else if (l.trim() === '') {
      i++;
    } else if (/^!\[/.test(l.trim())) {
      // 独立图片行（长提示词/反馈里的附图）单独成块
      blocks.push({ t: 'p', children: parseInline(l) });
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^#{1,3}\s/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !lines[i].trim().startsWith('```')) para.push(lines[i++]);
      blocks.push({ t: 'p', children: parseInline(para.join(' ')) });
    }
  }
  return blocks;
}

export function MD({ text, imgBase }: { text: string; imgBase?: string }) {
  const blocks = useMemo(() => parseBlocks(text ?? ''), [text]);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h': {
            const Tag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[Math.min(5, Math.max(0, b.level - 1))];
            return <Tag key={i}>{renderInline(b.children, i, imgBase)}</Tag>;
          }
          case 'pre': return <pre key={i}>{b.code}</pre>;
          case 'table':
            return (
              <table key={i} className="md-table">
                <thead>
                  <tr>{b.head.map((c, j) => <th key={j}>{renderInline(parseInline(c), `${i}-h${j}`, imgBase)}</th>)}</tr>
                </thead>
                <tbody>
                  {b.rows.map((r, k) => (
                    <tr key={k}>{b.head.map((_, j) => <td key={j}>{renderInline(parseInline(r[j] ?? ''), `${i}-${k}-${j}`, imgBase)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            );
          case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it, `${i}-${j}`, imgBase)}</li>)}</ul>;
          case 'ol': return <ol key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it, `${i}-${j}`, imgBase)}</li>)}</ol>;
          default: return <p key={i}>{renderInline(b.children, i, imgBase)}</p>;
        }
      })}
    </div>
  );
}
