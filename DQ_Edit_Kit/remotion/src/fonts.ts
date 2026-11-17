import {continueRender, delayRender, staticFile} from 'remotion';

const faces: [string, string, string, string][] = [
  ['Hanken Grotesk', 'fonts/hanken-grotesk-latin-500-normal.woff2', '500', 'normal'],
  ['Hanken Grotesk', 'fonts/hanken-grotesk-latin-700-normal.woff2', '700', 'normal'],
  ['Hanken Grotesk', 'fonts/hanken-grotesk-latin-800-normal.woff2', '800', 'normal'],
  ['Hanken Grotesk', 'fonts/hanken-grotesk-latin-900-normal.woff2', '900', 'normal'],
  ['Newsreader', 'fonts/newsreader-latin-500-italic.woff2', '500', 'italic'],
  ['Newsreader', 'fonts/newsreader-latin-600-italic.woff2', '600', 'italic'],
];

const handle = delayRender('Loading DQ brand fonts');
Promise.all(faces.map(([family, file, weight, style]) => {
  const f = new FontFace(family, `url(${staticFile(file)}) format("woff2")`, {weight, style});
  return f.load().then((loaded) => { document.fonts.add(loaded); });
})).then(() => continueRender(handle)).catch((e) => { console.error('Font load failed', e); continueRender(handle); });
