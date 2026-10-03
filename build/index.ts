// Entry points: `build` (one build), `check` (validate album and pack files), `dev` (build, watch, serve, open).
//   tsx build/index.ts build [--root examples]
import path from 'node:path';
import { Builder, BuildError } from './catalogue.ts';

const [cmd = 'build', ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const root = path.resolve(flag('root') ?? process.cwd());

function report(warnings: string[]) {
  if (!warnings.length) return;
  console.log(`\n${warnings.length} warning${warnings.length === 1 ? '' : 's'}:`);
  for (const w of warnings) console.log(`  · ${w}`);
}

async function main() {
  const builder = new Builder({ root });
  if (cmd === 'check') {
    builder.loadConfig();
    builder.loadAll();
    console.log(`ok: ${builder.albumIds().length} albums valid`);
    return;
  }
  if (cmd === 'build') {
    const t = performance.now();
    const { catalogue } = await builder.build();
    const counts = { open: 0, sealed: 0, unrated: 0 };
    for (const a of catalogue.albums) counts[a.state]++;
    console.log(`built ${catalogue.albums.length} albums (${counts.open} open, ${counts.sealed} sealed, ${counts.unrated} unrated) in ${((performance.now() - t) / 1000).toFixed(2)}s → ${path.relative(process.cwd(), path.join(root, 'dist')) || 'dist'}/`);
    report(catalogue.warnings);
    return;
  }
  if (cmd === 'dev') {
    const { dev } = await import('./dev.ts');
    await dev(builder, { open: !rest.includes('--no-open') });
    return;
  }
  throw new BuildError(`unknown command "${cmd}" (build, check, dev)`);
}

main().catch(e => {
  console.error(e instanceof BuildError ? `\n✗ ${e.message}` : e);
  process.exit(1);
});
