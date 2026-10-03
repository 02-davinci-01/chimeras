// Logseq markdown page parser (SPEC 6.2): page properties, then nested blocks.
import type { Block } from '../types.ts';

const PROP = /^\s*([A-Za-z0-9_][A-Za-z0-9_\-/.]*)::(?:\s+(.*?))?\s*$/;

export function parseProperty(line: string): [string, string] | null {
  const m = PROP.exec(line);
  return m ? [m[1].toLowerCase(), (m[2] ?? '').trim()] : null;
}

/** Depth of a line's dash: one per tab, or one per 2 spaces. Returns -1 when the line is not a block start. */
function blockStart(line: string): { depth: number; text: string } | null {
  const m = /^([\t ]*)-(?: (.*)|$)/.exec(line);
  if (!m) return null;
  const indent = m[1];
  const tabs = (indent.match(/\t/g) || []).length;
  const spaces = indent.replace(/\t/g, '').length;
  return { depth: tabs + Math.floor(spaces / 2), text: m[2] ?? '' };
}

/** Strip one block's continuation indent (depth tabs or depth*2 spaces, plus the 2 that align under the dash text). */
function dedent(line: string, depth: number): string {
  let s = line;
  for (let i = 0; i < depth; i++) {
    if (s.startsWith('\t')) s = s.slice(1);
    else if (s.startsWith('  ')) s = s.slice(2);
  }
  return s.replace(/^ {1,2}/, '');
}

interface Draft { depth: number; lines: string[]; children: Block[]; block: Block }

export function parsePage(text: string): { properties: Record<string, string>; blocks: Block[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const properties: Record<string, string> = {};
  let i = 0;

  // Leading `key:: value` lines before the first block.
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (blockStart(line)) break;
    const p = parseProperty(line);
    if (!p) break;
    properties[p[0]] = p[1];
  }

  const roots: Block[] = [];
  const stack: Draft[] = [];
  let current: Draft | null = null;

  const finish = (d: Draft) => {
    const props: Record<string, string> = {};
    const content: string[] = [];
    // Logseq treats every property-shaped line in a block as a block property (id::, collapsed:: …).
    for (const l of d.lines) {
      const p = parseProperty(l);
      if (p) props[p[0]] = p[1];
      else content.push(l);
    }
    d.block.content = content.join('\n').trim();
    d.block.properties = props;
    d.block.id = props.id ?? null;
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const start = blockStart(line);
    if (start) {
      if (current) finish(current);
      const block: Block = { id: null, content: '', properties: {}, children: [] };
      const draft: Draft = { depth: start.depth, lines: [start.text], children: block.children, block };
      while (stack.length && stack[stack.length - 1].depth >= start.depth) stack.pop();
      (stack.length ? stack[stack.length - 1].children : roots).push(block);
      stack.push(draft);
      current = draft;
    } else if (current) {
      current.lines.push(dedent(line, current.depth));
    } else if (line.trim() !== '') {
      // Text before any block that isn't a property: treat as a top-level block.
      const block: Block = { id: null, content: '', properties: {}, children: [] };
      current = { depth: 0, lines: [line], children: block.children, block };
      roots.push(block);
      stack.length = 0;
      stack.push(current);
    }
  }
  if (current) finish(current);

  // Properties may instead be the first block, when every line of it is `key:: value`.
  if (Object.keys(properties).length === 0 && roots.length) {
    const first = roots[0];
    if (!first.content && Object.keys(first.properties).length && !first.children.length) {
      Object.assign(properties, first.properties);
      roots.shift();
    }
  }

  return { properties, blocks: roots };
}

/** File name → page name, the way Logseq names files (triple-lowbar, percent-escapes, legacy dots). */
export function pageNameFromFile(base: string, legacyDots: boolean): string {
  let name = base.replace(/\.(md|markdown)$/i, '');
  if (name.includes('___')) name = name.replace(/___/g, '/');
  else if (legacyDots && /^[^.]+(\.[^.]+)+$/.test(name) && !/%2E/i.test(name)) name = name.replace(/\./g, '/');
  try { name = decodeURIComponent(name); } catch { /* keep as is */ }
  return name;
}
