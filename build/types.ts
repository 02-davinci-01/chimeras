// Shapes shared by the builder, the server and the web pages.

export type KingdomKey = 'rock' | 'electronic' | 'hiphop' | 'indie';
export type State = 'open' | 'sealed' | 'unrated';
export type StatKey = 'replay' | 'sonic' | 'meaning' | 'influence';

export const STAT_KEYS: StatKey[] = ['replay', 'sonic', 'meaning', 'influence'];

export interface Kingdom {
  key: KingdomKey;
  name: string;
  colour: string;
  ink: string;
  mark: 'smear' | 'grid' | 'halftone' | 'strings';
  tags: string[];
}

export interface RarityTier {
  key: string;
  name: string;
  rule: { minRating: number };
  finish: 'sheen' | 'holo-border' | 'etched-border' | 'foil-title' | 'matte';
  symbol: string;
}

export interface RarityConfig {
  tiers: RarityTier[];
  starPath: string;
  starViewBox: string;
}

export interface AppConfig {
  logseq: {
    graphPath: string;
    graphName: string;
    mode: 'file' | 'api';
    api?: { url: string; tokenEnv: string };
  };
  server: { host: string; port: number };
  art: { pixelGrid: number; pixelColours: number; abstractSize: number; coverSize: number };
}

export interface AlbumFile {
  id: string;
  title: string;
  artist: string;
  year: number;
  spotify?: string | null;
  cover?: string | null;
  runtime?: number | null;
  kingdom: KingdomKey;
  also?: KingdomKey[];
  /** The track the world plays when you meet this card; a 30 s preview is fetched by the build. */
  track?: string | null;
  logseq: { page: string };
  added: string;
  first?: string | null;
  pack?: string | null;
}

export interface PackFile {
  week: string;
  made: string;
  note?: string | null;
  albums: string[];
}

export interface Block {
  id: string | null;
  content: string;
  properties: Record<string, string>;
  children: Block[];
}

export interface LogseqPage {
  name: string;
  file: string | null;
  properties: Record<string, string>;
  blocks: Block[];
}

export interface AlbumOut {
  id: string;
  no: string;
  title: string;
  artist: string;
  year: number;
  spotify: string | null;
  runtime: number | null;
  kingdom: KingdomKey;
  /** Other kingdoms it also belongs to; each is a thread in the world. */
  also: KingdomKey[];
  added: string;
  first: string | null;
  pack: string | null;
  state: State;
  rating: number | null;
  rarity: string | null;
  stats: Record<StatKey, number | null>;
  /** The chosen track; `preview` is null until its clip has been downloaded. */
  track: { name: string; no: number | null; preview: string | null } | null;
  art: { cover: string | null; pixel: string | null; abstract: string | null; palette: string[] };
  /** Always empty: reviews stay in the Logseq graph and never reach the build output. */
  excerpt: string;
  logseq: { page: string };
}

export interface PackOut {
  week: string;
  made: string;
  note: string | null;
  albums: string[];
}

/** A song from sounds/, as config/sounds.json names it. */
export interface SongConfig { file: string; title: string; artist: string; lufs: number }
export interface SongOut { url: string; title: string; artist: string; lufs: number }
export type SceneKey = 'space' | KingdomKey;

export interface Catalogue {
  generated: string;
  /** The world's music by scene; a missing scene uses its generative loop. */
  sounds: Partial<Record<SceneKey, SongOut>>;
  kingdoms: Kingdom[];
  rarity: RarityTier[];
  starPath: string;
  starViewBox: string;
  packs: PackOut[];
  albums: AlbumOut[];
  warnings: string[];
}
