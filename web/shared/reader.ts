// The review reader (SPEC 9.5): the album's numbers, and in place of the review a note that reviews stay private.
// Reviews live only in Vedant's Logseq graph; nothing here fetches or links to it.
import type { AlbumOut, Catalogue } from './types.ts';
import { STAT_KEYS } from './types.ts';
import { penDate, PRIVATE_REVIEW } from './card.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface ReaderOptions {
  cat: () => Catalogue;
  /** Open another catalogued album. */
  openAlbum?: (id: string) => void;
  onClose?: () => void;
}

export class Reader {
  readonly el: HTMLElement;
  private album: AlbumOut | null = null;
  private lastFocus: Element | null = null;

  constructor(private opts: ReaderOptions) {
    this.el = document.createElement('aside');
    this.el.className = 'reader';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'false');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.tabIndex = -1;
    document.body.append(this.el);
    this.el.addEventListener('click', e => {
      if (!(e.target as HTMLElement).closest('[data-close]')) return;
      e.preventDefault();
      this.close();
    });
  }

  get isOpen() { return this.el.classList.contains('open'); }
  get current() { return this.album; }

  open(a: AlbumOut) {
    if (a.state === 'sealed') return;
    if (!this.isOpen) this.lastFocus = document.activeElement;
    this.album = a;
    const k = this.opts.cat().kingdoms.find(k => k.key === a.kingdom)!;
    this.el.style.setProperty('--k', k.colour);
    this.el.setAttribute('aria-label', `Review of ${a.title}`);
    this.el.innerHTML = this.header(a) + `<div class="reader-body"><p class="reader-private">${esc(PRIVATE_REVIEW)}</p></div>`;
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    this.el.focus({ preventScroll: true });
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
}
