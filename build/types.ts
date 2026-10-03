// Shapes shared by the builder, the server and the web pages.

export type KingdomKey = 'rock' | 'electronic' | 'hiphop' | 'indie';
export type Gait = 'walk' | 'shuffle' | 'stride' | 'drift' | 'hop' | 'still';
export type HeadName = 'default' | 'static' | 'faceless' | 'cover' | 'skull' | 'cube';
export type State = 'open' | 'sealed' | 'unrated';
export type StatKey = 'replay' | 'sonic' | 'meaning' | 'influence';

export const STAT_KEYS: StatKey[] = ['replay', 'sonic', 'meaning', 'influence'];
export const HEADS: HeadName[] = ['default', 'static', 'faceless', 'cover', 'skull', 'cube'];

export interface Kingdom {
  key: KingdomKey;
  name: string;
  colour: string;
  ink: string;
  mark: 'smear' | 'grid' | 'halftone' | 'strings';
  body: KingdomKey;
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

export interface PersonFile {
  brief?: string;
  base?: KingdomKey;
  build?: { height?: number; mass?: number };
  head?: string;
  traits?: string[];
  motion?: { gait?: Gait; tempo?: number; bpm?: number | null };
  colours?: Record<string, string>;
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
  logseq: { page: string };
  added: string;
  first?: string | null;
  pack?: string | null;
  person?: PersonFile;
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

export interface PersonOut {
  brief: string;
  base: KingdomKey;
  build: { height: number; mass: number };
  head: HeadName;
  traits: string[];
  motion: { gait: Gait; tempo: number; bpm: number | null };
  colours: { body: string; accent: string; skin: string; [part: string]: string };
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
  added: string;
  first: string | null;
  pack: string | null;
  state: State;
  rating: number | null;
  rarity: string | null;
  stats: Record<StatKey, number | null>;
  art: { cover: string | null; pixel: string | null; abstract: string | null; palette: string[] };
  excerpt: string;
  logseq: { page: string; url: string };
  person: PersonOut;
}

export interface PackOut {
  week: string;
  made: string;
  note: string | null;
  albums: string[];
}

export interface Catalogue {
  generated: string;
  kingdoms: Kingdom[];
  rarity: RarityTier[];
  starPath: string;
  starViewBox: string;
  graphName: string;
  packs: PackOut[];
  albums: AlbumOut[];
  warnings: string[];
}
