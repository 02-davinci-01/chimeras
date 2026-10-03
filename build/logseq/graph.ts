// Logseq graph readers: file mode (markdown pages on disk) and API mode (Logseq's local HTTP API).
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, Block, LogseqPage } from '../types.ts';
import { pageNameFromFile, parseProperty, parsePage } from './parse.ts';
import { blockIndex } from './text.ts';

export interface GraphReader {
  /** Re-scan page names (file mode); cheap. */
  index(): Promise<void>;
  /** Read one page by name, case-insensitively. Null when there is no such page. */
  read(name: string): Promise<LogseqPage | null>;
  /** Resolve a ((uuid)) across the pages read so far. */
  blockText(uuid: string): string | null;
  /** File path for a page name, so watch mode can map file changes back to pages. */
  fileFor(name: string): string | null;
  pagesDir: string | null;
  assetsDir: string | null;
}

export function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(process.env.HOME || '', p.slice(1)) : p;
}

export function graphReader(cfg: AppConfig, root: string): GraphReader {
  return cfg.logseq.mode === 'api' ? apiGraph(cfg) : fileGraph(path.resolve(root, expandHome(cfg.logseq.graphPath)));
}

function fileGraph(graphPath: string): GraphReader {
  const pagesDir = path.join(graphPath, 'pages');
  const names = new Map<string, { name: string; file: string }>();   // lower-case page name → page
  const blocks = new Map<string, string>();             // uuid → raw content

  return {
    pagesDir,
    assetsDir: path.join(graphPath, 'assets'),
    async index() {
      if (!fs.existsSync(pagesDir)) throw Object.assign(new Error(`Logseq graph has no pages/ folder: ${pagesDir}`), { fatal: true });
      const files = fs.readdirSync(pagesDir).filter(f => /\.(md|markdown)$/i.test(f));
      // Legacy graphs name namespaces with dots ("a.b.md"). Only assume that when no file uses the triple-lowbar form.
      const legacyDots = !files.some(f => f.includes('___'));
      names.clear();
      for (const f of files) {
        const file = path.join(pagesDir, f);
        let name = pageNameFromFile(f, legacyDots);
        // A `title::` property wins over the file name. Only the head of the file needs reading.
        const head = fs.readFileSync(file, 'utf8').slice(0, 2048).split('\n');
        for (const line of head) {
          if (/^\s*-/.test(line)) break;
          const p = parseProperty(line);
          if (p?.[0] === 'title' && p[1]) { name = p[1]; break; }
        }
        names.set(name.toLowerCase(), { name, file });
      }
    },
    async read(name) {
      const hit = names.get(name.toLowerCase());
      if (!hit || !fs.existsSync(hit.file)) return null;
      const parsed = parsePage(fs.readFileSync(hit.file, 'utf8'));
      blockIndex(parsed.blocks, blocks);
      return { name: hit.name, file: hit.file, ...parsed };
    },
    blockText: uuid => blocks.get(uuid) ?? null,
    fileFor: name => names.get(name.toLowerCase())?.file ?? null,
  };
}

function apiGraph(cfg: AppConfig): GraphReader {
  const api = cfg.logseq.api;
  if (!api) throw Object.assign(new Error('logseq.mode is "api" but logseq.api is not configured'), { fatal: true });
  const token = process.env[api.tokenEnv];
  const blocks = new Map<string, string>();

  async function call(method: string, args: unknown[]) {
    const res = await fetch(api!.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ method, args }),
    });
    if (!res.ok) throw Object.assign(new Error(`Logseq API ${method}: HTTP ${res.status}`), { fatal: true });
    return res.json();
  }

  // Logseq's block entities: { uuid, content, properties, children: [...] }. Content holds property lines too.
  const toBlock = (b: any): Block => {
    const lines = String(b.content ?? '').split('\n');
    const props: Record<string, string> = {};
    const content = lines.filter(l => { const p = parseProperty(l); if (p) props[p[0]] = p[1]; return !p; }).join('\n').trim();
    const id = props.id ?? b.uuid ?? null;
    if (id) blocks.set(id, content);
    return { id, content, properties: props, children: (b.children ?? []).map(toBlock) };
  };

  return {
    pagesDir: null,
    assetsDir: cfg.logseq.graphPath ? path.join(expandHome(cfg.logseq.graphPath), 'assets') : null,
    async index() {},
    async read(name) {
      const page = await call('logseq.Editor.getPage', [name]);
      if (!page) return null;
      const tree: any[] = (await call('logseq.Editor.getPageBlocksTree', [name])) ?? [];
      const properties: Record<string, string> = {};
      for (const [k, v] of Object.entries(page.properties ?? {})) properties[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
      let all = tree.map(toBlock);
      // The page's own properties come back as a pre-block in file-backed graphs.
      if (all[0] && !all[0].content && Object.keys(all[0].properties).length) all = all.slice(1);
      return { name: page.originalName ?? page.name ?? name, file: null, properties, blocks: all };
    },
    blockText: uuid => blocks.get(uuid) ?? null,
    fileFor: () => null,
  };
}
