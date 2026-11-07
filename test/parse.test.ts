import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../spool.config.ts';
import { classify, inferSize, parseRollName, pickFrames, matchFrame, variantFor } from '../src/lib/archive/parse.ts';
import { jpegSize } from '../src/lib/archive/jpeg-size.ts';

test('dates: YY.M.D with optional pipe and trailing dot', () => {
  assert.deepEqual(parseRollName('22.9.6 august f3'), { date: { year: 2022, month: 9, day: 6 }, title: 'august f3' });
  assert.deepEqual(parseRollName('18.2.21 | 1st Bronica Ektar Arch').date, { year: 2018, month: 2, day: 21 });
  assert.equal(parseRollName('19.12.6. | panf').title, 'panf');
  assert.equal(parseRollName('16.8.2 | SCANNED 1st roll').date?.year, 2016);
});

test('dates: M.D.YY fallback when YY.M.D does not fit the collection', () => {
  assert.deepEqual(parseRollName('11.9.19 | self portraits', [2019]).date, {
    year: 2019, month: 11, day: 9, guessed: 'mdy',
  });
  assert.deepEqual(parseRollName('8.18.17 Scans').date, { year: 2017, month: 8, day: 18, guessed: 'mdy' });
  // winter 2018 holds early-2019 rolls — still YY.M.D
  assert.equal(parseRollName('19.1.16 | winter 2018 PS', [2018]).date?.guessed, undefined);
});

test('titles: Finder shows ":" as "/"', () => {
  assert.equal(parseRollName('18.2.6 | Shania:Binish 160VC').title, 'Shania/Binish 160VC');
  assert.equal(parseRollName('isabelle').title, 'isabelle');
});

const c = (t: string) => classify(t, config);

test('size + class from roll names', () => {
  assert.deepEqual([c('august f3').size, c('august f3').class], ['35mm', null]);
  assert.deepEqual([c('spring 21 ps').size, c('spring 21 ps').class], ['35mm', 'Point & shoot']);
  assert.deepEqual([c('Point and Shoot').size, c('Point and Shoot').class], ['35mm', 'Point & shoot']);
  assert.deepEqual([c('bri 645 self').size, c('bri 645 self').class], ['645', 'Medium format']);
  assert.deepEqual([c('road trip 67').size, c('road trip 67').class], ['6x7', 'Medium format']);
  assert.equal(c('69 COLOR').size, '6x9');
  assert.equal(c('CLASS Night 6x9').size, '6x9');
  assert.deepEqual([c('family large format').size, c('family large format').class], ['4x5', 'Large format']);
  assert.equal(c('hasselblad trix').size, '6x6');
  assert.equal(c('Ava Canon').size, '35mm');
  assert.equal(c('Marian shoot n90s').size, '35mm');
  assert.equal(c('120 trix').class, 'Medium format');
  assert.equal(c('sophie march').size, null);
});

test('film + tone', () => {
  assert.deepEqual([c('Tri-X Shows').film, c('Tri-X Shows').tone], ['Tri-X', 'B&W']);
  assert.equal(c('120 trix').film, 'Tri-X');
  assert.equal(c('Portra 160VC Expired 2').film, 'Portra 160VC');
  assert.equal(c('lomo-1600').film, 'Lomo 1600');
  assert.equal(c('lomo purple').film, 'LomoChrome Purple');
  assert.equal(c('panf').film, 'Pan F');
  assert.equal(c('bw fisheye').tone, 'B&W');
  assert.equal(c('First B:W').tone, 'B&W');
  assert.equal(c('cinestill').tone, 'Color');
});

test('size inference from shape + frames', () => {
  assert.equal(inferSize(1.5, 37), '35mm');
  assert.equal(inferSize(1.33, 15), '645');
  assert.equal(inferSize(1.0, 12), '6x6');
  assert.equal(inferSize(1.24, 10), '6x7');
  assert.equal(inferSize(1.5, 8), '6x9');
  assert.equal(inferSize(1.33, 30), '645'); // two 120 rolls in one folder
  assert.equal(inferSize(1.66, 36), '35mm'); // scan includes the rebate
  assert.equal(inferSize(1.8, 36), null);
});

test('subfolder roles', () => {
  const role = (p: string) => variantFor(p, config).role;
  assert.equal(role(''), 'show');
  assert.equal(role('raw'), 'hide');
  assert.equal(role('120 ektar raw scans'), 'hide');
  assert.equal(role('Originals'), 'hide');
  assert.equal(role('more compressed'), 'show');
  assert.equal(role('LOW_RES'), 'show');
  assert.equal(role('digital finals/compressed'), 'show');
  assert.equal(role('selects'), 'select');
  assert.equal(role('favs'), 'select');
  assert.equal(role('selects/prints/compressed for online'), 'select');
  assert.equal(role('raw/help comparisions compressed'), 'hide');
  assert.ok(variantFor('more compressed', config).rank > variantFor('', config).rank);
});

test('one photo per frame, compressed version wins', () => {
  const frames = pickFrames([
    { file: 'roll001.jpg', dir: '', rank: 1 },
    { file: 'roll002.jpg', dir: '', rank: 1 },
    { file: 'roll001.jpg', dir: 'more compressed', rank: 3 },
  ]);
  assert.equal(frames.size, 2);
  assert.equal(frames.get('roll001')!.dir, 'more compressed');
  assert.equal(frames.get('roll002')!.dir, '');
});

test('frames match by number when a folder renames files (FH → FL)', () => {
  const frames = pickFrames([
    { file: 'FH000001.jpg', dir: '', rank: 1 },
    { file: 'FH000002.jpg', dir: '', rank: 1 },
    { file: 'FL000001.jpg', dir: 'LOW_RES', rank: 3 },
  ]);
  assert.equal(frames.size, 2);
  assert.equal(frames.get('fh000001')!.file, 'FL000001.jpg');
  assert.equal(matchFrame('FH000002.JPG', frames), 'fh000002');
});

test('jpeg dimensions from SOF header', () => {
  // SOI, APP0 (len 4), SOF0: len, precision, height=600, width=900
  const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x84, 0, 0, 0]);
  assert.deepEqual(jpegSize(buf), { width: 900, height: 600 });
});
