// Duly Qualified brand tokens. Do not invent new colours: tints of these only.
export const DQ = {
  navy: '#14213D',     // primary
  navyDeep: '#0B1328', // backgrounds behind graphics
  red: '#C8372D',      // signature red: accents, stamps, CTA
  redSoft: '#FF7B6D',  // red on navy (legible)
  ivory: '#F2F1EC',    // paper, text on navy
  ink: '#20283B',      // text on ivory
  muted: '#7A8390',
  hairline: '#D5D9DD',
  good: '#4FB37E',     // ticks only
} as const;

export const FONT = '"Hanken Grotesk", Arial, sans-serif'; // headlines 800/900, body 500/700
export const SERIF = '"Newsreader", Georgia, serif';        // italic accent words only, in red

// 1080 x 1920 frame. TikTok/Reels cover the bottom ~330 px and a column on the right
// (x > 940, y 900-1560) with their own UI, so nothing important goes there.
export const SAFE = {left: 70, right: 130, top: 170, bottom: 1540};
export const FPS = 30;
