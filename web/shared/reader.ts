// The review reader (SPEC 9.5): the album's Logseq page, read live, as nested blocks. It never edits the page.
import type { AlbumOut, Catalogue } from './types.ts';
import { STAT_KEYS } from './types.ts';
import { penDate } from './card.ts';

interface PageBlock { id: string | null; content: string; properties: Record<string, string>; children: PageBlock[] }
interface PageJSON { name: string; properties: Record<string, string>; blocks: PageBlock[]; refs: Record<string, string | null>; error?: string }

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const JOURNAL = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2})(?:st|nd|rd|th)?, (\d{4})$/;
const HIDDEN_PROPS = new Set(['rating', 'rarity', 'title', 'type', ...STAT_KEYS]);

export interface ReaderOptions {
  cat: () => Catalogue;
  /** Open another catalogued album (from a [[link]] in the review). */
  openAlbum: (id: string) => void;
  onClose?: () => void;
}

export class Reader {
  readonly el: HTMLElement;
  private album: AlbumOut | null = null;
  private lastFocus: Element | null = null;
  private seq = 0;

  constructor(private opts: ReaderOptions) {
    this.el = document.createElement('aside');
    this.el.className = 'reader';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'false');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.tabIndex = -1;
    document.body.append(this.el);
    this.el.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-album],[data-close]');
      if (!t) return;
      e.preventDefault();
      if (t.dataset.close != null) this.close();
      else this.opts.openAlbum(t.dataset.album!);
    });
  }

  get isOpen() { return this.el.classList.contains('open'); }
  get current() { return this.album; }

  async open(a: AlbumOut) {
    if (a.state === 'sealed') return;
    if (!this.isOpen) this.lastFocus = document.activeElement;
    this.album = a;
    const k = this.opts.cat().kingdoms.find(k => k.key === a.kingdom)!;
    this.el.style.setProperty('--k', k.colour);
    this.el.setAttribute('aria-label', `Review of ${a.title}`);
    this.el.innerHTML = this.header(a) + '<div class="reader-body" aria-busy="true"><p class="reader-quiet">Reading the page…</p></div>' + this.footer(a);
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    this.el.focus({ preventScroll: true });
    await this.refresh();
  }

  /** Re-read the page (also called after a rebuild). */
  async refresh() {
    const a = this.album;
    if (!a || !this.isOpen) return;
    const seq = ++this.seq;
    let page: PageJSON;
    try {
      const res = await fetch(`/logseq/page?name=${encodeURIComponent(a.logseq.page)}`, { cache: 'no-store' });
      page = await res.json();
    } catch { page = { error: 'The server is not answering.' } as PageJSON; }
    if (seq !== this.seq || this.album !== a) return;
    const body = this.el.querySelector('.reader-body')!;
    body.removeAttribute('aria-busy');
    if (page.error) { body.innerHTML = `<p class="reader-quiet">${esc(page.error)}</p>`; return; }
    const props = Object.entries(page.properties).filter(([k]) => !HIDDEN_PROPS.has(k));
    const propHTML = props.length ? `<dl class="reader-props">${props.map(([k, v]) => `<div><dt>${esc(k.toLowerCase())}</dt><dd>${this.inline(v, page.refs)}</dd></div>`).join('')}</dl>` : '';
    const blocks = this.blocks(page.blocks, page.refs);
    body.innerHTML = propHTML + (blocks || '<p class="reader-quiet">Nothing written yet.</p>');
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
    this.album = null;
    if (this.lastFocus instanceof HTMLElement) this.lastFocus.focus({ preventScroll: true });
    this.opts.onClose?.();
  }

  private header(a: AlbumOut) {
    const cat = this.opts.cat();
    const tier = cat.rarity.find(t => t.key === a.rarity);
    const bits = [
      a.rating != null ? `${a.rating}/10` : 'Unrated',
      tier?.name,
      ...STAT_KEYS.map(s => a.stats[s] != null ? `${s[0].toUpperCase() + s.slice(1)} ${a.stats[s]}` : null),
      a.first ? `first ${penDate(a.first)}` : null,
    ].filter(Boolean);
    const k = cat.kingdoms.find(k => k.key === a.kingdom);
    return `<header class="reader-head"><button class="reader-x" type="button" data-close aria-label="Close the review">esc ×</button>`
      + `<p class="reader-kicker">review · № ${a.no} · ${esc(k?.name ?? '')}</p><h2>${esc(a.title)}</h2><p class="reader-artist">${esc(a.artist)}</p><p class="reader-line">${bits.map(b => esc(b!)).join('<span aria-hidden="true"> · </span>')}</p></header>`;
  }

  private footer(a: AlbumOut) {
    return `<footer class="reader-foot"><a href="${esc(a.logseq.url)}">Open in Logseq</a><span class="reader-quiet">${esc(a.logseq.page)}</span></footer>`;
  }

  private blocks(bs: PageBlock[], refs: PageJSON['refs']): string {
    const items = bs.map(b => {
      const content = b.content.trim();
      const kids = b.children.length ? this.blocks(b.children, refs) : '';
      if (!content && !kids) return '';
      const heading = /^(#{1,6})\s+(.*)$/s.exec(content);
      const html = heading
        ? `<p class="reader-h h${Math.min(3, heading[1].length)}">${this.inline(heading[2], refs)}</p>`
        : content ? `<p>${this.inline(content, refs).replace(/\n/g, '<br>')}</p>` : '';
      return `<li${b.id ? ` id="block-${esc(b.id)}"` : ''}>${html}${kids}</li>`;
    }).join('');
    return items ? `<ul class="blocks">${items}</ul>` : '';
  }

  /** Logseq inline syntax → HTML. Input is escaped first; every pattern below works on escaped text. */
  private inline(src: string, refs: PageJSON['refs']): string {
    const cat = this.opts.cat();
    const byPage = new Map(cat.albums.filter(a => a.state !== 'sealed').map(a => [a.logseq.page.toLowerCase(), a]));
    const graph = encodeURIComponent(cat.graphName);
    const pageLink = (name: string) => {
      const plain = name.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      const j = JOURNAL.exec(plain);
      if (j) return `<time class="journal" datetime="${j[3]}-${String(MONTHS.indexOf(j[1]) + 1).padStart(2, '0')}-${j[2].padStart(2, '0')}">${Number(j[2])} ${j[1]} ${j[3]}</time>`;
      const album = byPage.get(plain.toLowerCase());
      if (album) return `<a href="#${album.id}" class="ref album-ref" data-album="${album.id}">${name}</a>`;
      return `<a class="ref" href="logseq://graph/${graph}?page=${encodeURIComponent(plain)}">${name}</a>`;
    };
    const stash: string[] = [];
    const keep = (html: string) => `\u0000${stash.push(html) - 1}\u0000`;
    let s = esc(src);
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)(\{[^}]*\})?/g, (_, alt, url) => {
      const u = url.replace(/&amp;/g, '&');
      const m = /(?:\.\.\/)?assets\/(.+)$/.exec(u);
      const srcUrl = m ? `/logseq/assets/${m[1].split('/').map(encodeURIComponent).join('/')}` : /^https?:/.test(u) ? u : '';
      return srcUrl ? keep(`<img class="reader-img" src="${esc(srcUrl)}" alt="${alt}" loading="lazy">`) : '';
    });
    s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
    s = s.replace(/\{\{embed\s+\[\[([^\]]+)\]\]\s*\}\}/g, (_, p) => keep(pageLink(p)));
    s = s.replace(/\{\{embed\s+\(\(([0-9a-f-]{36})\)\)\s*\}\}/gi, (_, id) => keep(this.blockRef(id, refs)));
    s = s.replace(/\{\{[^}]*\}\}/g, '');
    s = s.replace(/\(\(([0-9a-f-]{36})\)\)/gi, (_, id) => keep(this.blockRef(id, refs)));
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+|logseq:[^)\s]+)\)/g, (_, label, url) => keep(`<a class="ref" href="${url}" target="_blank" rel="noopener">${label}</a>`));
    s = s.replace(/\[([^\]]+)\]\(\[\[([^\]]+)\]\]\)/g, (_, label, p) => keep(pageLink(p).replace(/>[^<]*<\/(a|time)>$/, `>${label}</$1>`)));
    s = s.replace(/#\[\[([^\]]+)\]\]/g, (_, t) => keep(`<span class="tag">#${t}</span>`));
    s = s.replace(/\[\[([^\]]+)\]\]/g, (_, p) => keep(pageLink(p)));
    s = s.replace(/(^|\s)#([^\s#.,;:!?()[\]\u0000]+)/g, (_, pre, t) => `${pre}${keep(`<span class="tag">#${t}</span>`)}`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/\^\^([^^]+)\^\^/g, '<mark>$1</mark>').replace(/==([^=]+)==/g, '<mark>$1</mark>');
    s = s.replace(/^(NOW|LATER|TODO|DOING|DONE|WAITING|CANCELED|CANCELLED)\s+/, (_, m) => keep(`<span class="marker">${m.toLowerCase()}</span> `));
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]).replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
  }

  private blockRef(id: string, refs: PageJSON['refs']) {
    const t = refs[id];
    return t ? `<span class="block-ref">${esc(t.replace(/\n/g, ' '))}</span>` : `<span class="block-ref missing" title="Block ${esc(id)}">↗</span>`;
  }
}
