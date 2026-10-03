// Plain text from Logseq blocks: the card excerpt and the search index.
import type { Block } from '../types.ts';

export type RefResolver = (uuid: string) => string | null;

/** Logseq inline markup → plain text. Images are dropped; links keep their label. */
export function toPlain(s: string, resolve: RefResolver = () => null): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g, '')                 // images (+ {:height ..})
    .replace(/\{\{embed\s+(?:\[\[([^\]]+)\]\]|\(\(([^)]+)\)\))\s*\}\}/g, (_, p, b) => p ?? resolve(b) ?? '')
    .replace(/\{\{[^}]*\}\}/g, '')                                    // other macros
    .replace(/\(\(([0-9a-f-]{36})\)\)/gi, (_, id) => resolve(id) ?? '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')                        // markdown links
    .replace(/#\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/(^|\s)#([^\s#.,;:!?()[\]]+)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')                                      // headings
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, '$1$2')
    .replace(/~~([^~]+)~~|\^\^([^^]+)\^\^|==([^=]+)==/g, '$1$2$3')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^(NOW|LATER|TODO|DOING|DONE|WAITING|CANCELED|CANCELLED)\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/** Every block's text, depth first. */
export function allText(blocks: Block[], resolve?: RefResolver): string {
  const out: string[] = [];
  const walk = (bs: Block[]) => { for (const b of bs) { const t = toPlain(b.content, resolve); if (t) out.push(t); walk(b.children); } };
  walk(blocks);
  return out.join('\n');
}

/** First top-level blocks' text, joined and cut at a word boundary near `limit`. */
export function excerpt(blocks: Block[], resolve?: RefResolver, limit = 280): string {
  let text = '';
  for (const b of blocks) {
    const t = toPlain(b.content, resolve);
    if (!t) continue;
    text = text ? `${text} ${t}` : t;
    if (text.length >= limit) break;
  }
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit + 1);
  const at = cut.lastIndexOf(' ');
  return (at > limit * 0.7 ? cut.slice(0, at) : text.slice(0, limit)).replace(/[\s,;:.\-–—]+$/, '') + '…';
}

/** Map of block id → plain text, for ((uuid)) references. */
export function blockIndex(blocks: Block[], into = new Map<string, string>()): Map<string, string> {
  for (const b of blocks) { if (b.id) into.set(b.id, b.content); blockIndex(b.children, into); }
  return into;
}
