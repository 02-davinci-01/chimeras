// `npm run dev`: build, watch albums/, packs/, config/ and the graph's pages/, serve on 127.0.0.1, open the binder.
import { execFile } from 'node:child_process';
import path from 'node:path';
import chokidar from 'chokidar';
import { createServer as createVite } from 'vite';
import { createServer } from '../server/index.ts';
import { Builder, BuildError } from './catalogue.ts';

export async function dev(builder: Builder, opts: { open: boolean }) {
  const t = performance.now();
  await builder.build();
  console.log(`built in ${((performance.now() - t) / 1000).toFixed(2)}s`);

  const repo = path.resolve(import.meta.dirname, '..');
  const vite = await createVite({ configFile: path.join(repo, 'vite.config.ts'), server: { middlewareMode: true, hmr: { port: builder.cfg.server.port + 10000 } }, appType: 'mpa' });
  const server = createServer({ root: builder.root, cfg: builder.cfg, graph: () => builder.graph, vite });
  const url = await server.listen();
  console.log(`catalogue on ${url}  (world: ${url}world)`);
  if (opts.open) execFile('open', [url]);

  // Pending changes, applied together after 300 ms of quiet.
  const pending = { albums: new Set<string>(), removed: new Set<string>(), packs: new Set<string>(), removedPacks: new Set<string>(), pages: new Set<string>(), config: false, traits: false };
  let timer: NodeJS.Timeout | null = null;
  let running = Promise.resolve();

  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { running = running.then(flush); }, 300); };

  async function flush() {
    const p = { ...pending, albums: [...pending.albums], removed: [...pending.removed], packs: [...pending.packs], removedPacks: [...pending.removedPacks], pages: [...pending.pages] };
    pending.albums.clear(); pending.removed.clear(); pending.packs.clear(); pending.removedPacks.clear(); pending.pages.clear(); pending.config = pending.traits = false;
    const t0 = performance.now();
    try {
      if (p.config) {
        await builder.build();
      } else {
        for (const id of p.removed) builder.removeAlbum(id);
        for (const w of p.removedPacks) builder.removePack(w);
        const changed = p.albums.map(f => builder.loadAlbum(f));
        for (const f of p.packs) builder.loadPack(f);
        // A page edit only re-reads the pages it can affect; new or renamed files may also satisfy a missing page.
        const pageNames = new Set(changed.map(a => a.logseq.page));
        if (p.pages.length) {
          await builder.graph.index();
          for (const name of builder.pageNames()) {
            const file = builder.graph.fileFor(name);
            if (!file || p.pages.includes(file)) pageNames.add(name);
          }
        }
        if (pageNames.size) await builder.readPages([...pageNames]);
        if (changed.length) await builder.bakeArt(changed.map(a => a.id));
        builder.write(builder.assemble());
      }
      const what = [p.config && 'config', ...p.albums.map(f => path.basename(f, '.json')), ...p.pages.map(f => path.basename(f)), p.traits && 'traits'].filter(Boolean).join(', ');
      console.log(`rebuilt (${what || 'removals'}) in ${(performance.now() - t0).toFixed(0)} ms`);
      server.emit('build', { at: Date.now() });
    } catch (e) {
      console.error(e instanceof BuildError ? `✗ ${e.message}` : e);
      server.emit('build-error', { message: (e as Error).message });
    }
  }

  const at = (...p: string[]) => path.join(builder.root, ...p);
  const watched = [at('albums'), at('packs'), at('config'), path.join(repo, 'web', 'world', 'traits')];
  if (builder.graph.pagesDir) watched.push(builder.graph.pagesDir);
  const watcher = chokidar.watch(watched, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 } });
  watcher.on('all', (event, file) => {
    if (file.endsWith('.tmp')) return;
    const rel = path.relative(builder.root, file);
    const gone = event === 'unlink';
    if (rel.startsWith('albums' + path.sep) && file.endsWith('.json')) (gone ? pending.removed.add(path.basename(file, '.json')) : pending.albums.add(file));
    else if (rel.startsWith('packs' + path.sep) && file.endsWith('.json')) (gone ? pending.removedPacks.add(path.basename(file, '.json')) : pending.packs.add(file));
    else if (rel.startsWith('config' + path.sep)) pending.config = true;
    else if (file.includes(path.join('world', 'traits'))) pending.traits = true;
    else if (/\.(md|markdown)$/i.test(file)) pending.pages.add(file);
    else return;
    schedule();
  });

  const stop = async () => { await watcher.close(); await vite.close(); await server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
