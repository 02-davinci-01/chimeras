import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageNameFromFile, parsePage } from './parse.ts';
import { excerpt, toPlain } from './text.ts';

test('uppercase page properties, image block, empty trailing block (Vedant’s format)', () => {
  const page = parsePage([
    'TAGS:: #musica ',
    'CREATOR:: [[Mid-Air Thief]] ',
    'RATING:: 9.5/10',
    '',
    '- ![cover.jpg](../assets/cover_1_0.jpg){:height 574, :width 512}',
    '- A very interesting sonic structure.',
    '-',
  ].join('\n'));
  assert.equal(page.properties.tags, '#musica');
  assert.equal(page.properties.creator, '[[Mid-Air Thief]]');
  assert.equal(page.properties.rating, '9.5/10');
  assert.equal(page.blocks.length, 3);
  assert.equal(excerpt(page.blocks), 'A very interesting sonic structure.');
});

test('tab and two-space nesting, continuation lines, block properties', () => {
  const page = parsePage([
    '- # Intro',
    '  collapsed:: true',
    '\t- first child',
    '\t  carries on here',
    '\t  id:: 6650f1c2-1111-2222-3333-444455556666',
    '\t\t- grandchild',
    '- second',
    '  - spaced child',
  ].join('\n'));
  assert.equal(page.blocks.length, 2);
  const [intro, second] = page.blocks;
  assert.equal(intro.content, '# Intro');
  assert.equal(intro.properties.collapsed, 'true');
  assert.equal(intro.children[0].content, 'first child\ncarries on here');
  assert.equal(intro.children[0].id, '6650f1c2-1111-2222-3333-444455556666');
  assert.equal(intro.children[0].children[0].content, 'grandchild');
  assert.equal(second.children[0].content, 'spaced child');
});

test('properties as the first block', () => {
  const page = parsePage('- rating:: 8\n  sonic:: 4\n- review');
  assert.equal(page.properties.rating, '8');
  assert.equal(page.properties.sonic, '4');
  assert.equal(page.blocks.length, 1);
});

test('file names decode like Logseq', () => {
  assert.equal(pageNameFromFile('Velocity%3A Design%3A Comfort.md', false), 'Velocity: Design: Comfort');
  assert.equal(pageNameFromFile('music___albums.md', false), 'music/albums');
  assert.equal(pageNameFromFile('music.albums.md', true), 'music/albums');
});

test('plain text strips markup and resolves block refs', () => {
  const t = toPlain('**Bold** [[Kevin Shields]] #tag #[[two words]] [site](https://x) ((6650f1c2-1111-2222-3333-444455556666)) `code`', () => 'quoted');
  assert.equal(t, 'Bold Kevin Shields tag two words site quoted code');
});

test('excerpt cuts at a word boundary near 280', () => {
  const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
  const e = excerpt([{ id: null, content: long, properties: {}, children: [] }]);
  assert.ok(e.length <= 282 && e.endsWith('…'));
  assert.ok(long.startsWith(e.slice(0, -1) + ' '), 'cut falls between whole words');
});
