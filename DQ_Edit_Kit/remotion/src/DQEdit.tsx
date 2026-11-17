import React, {useMemo} from 'react';
import {AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {DQ, FONT, SERIF, FPS} from './theme';
import {parseSrt, chunk} from './srt';
import {GRAPHICS, GraphicName, clamp, eIO, seg} from './graphics';
import type {Edit} from './edits';

const FULL: GraphicName[] = ['TenderPage', 'Register', 'EndCard'];
const SPLIT: GraphicName[] = ['StrikePanel', 'DiaryPanel', 'NumbersPanel', 'ChecklistPanel', 'LeadCardPanel', 'LockPanel'];
const CARD = {x: 54, y: 150, w: 972, h: 740}; // speaker card in split layout
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

// 0..1 for how much a layout is "on" at time t, with 0.35 s ease in/out at the edges of its overlays.
function weight(t: number, edit: Edit, kinds: GraphicName[]) {
  let w = 0;
  for (const o of edit.overlays) if (kinds.includes(o.g)) w = Math.max(w, Math.min(seg(t, o.from, o.from + 0.35), 1 - seg(t, o.to - 0.35, o.to)));
  return eIO(w);
}

function zoomAt(t: number, edit: Edit) {
  let s = 1 + 0.05 * (t / edit.duration); // slow push across the whole clip
  for (const z of edit.zooms) {
    if (t < z.at || t > z.to + 0.4) continue;
    const k = z.hard ? (t <= z.to ? 1 : 1 - seg(t, z.to, z.to + 0.12)) : Math.min(eIO(seg(t, z.at, z.at + 0.6)), 1 - eIO(seg(t, z.to - 0.1, z.to + 0.4)));
    s *= lerp(1, z.scale, k);
  }
  return s;
}

const Captions: React.FC<{t: number; edit: Edit; y: number}> = ({t, edit, y}) => {
  const chunks = useMemo(() => chunk(parseSrt(edit.srt, edit.keywords)), [edit]);
  const c = chunks.find((ch) => t >= ch[0].start - 0.05 && t <= ch[ch.length - 1].end + 0.15);
  if (!c) return null;
  const pop = clamp((t - c[0].start + 0.05) / 0.12);
  return <div style={{position: 'absolute', left: 60, right: 140, top: y, transform: `translateY(-50%) scale(${0.92 + 0.08 * pop})`, transformOrigin: 'left center', display: 'flex', flexWrap: 'wrap', gap: '0 20px', alignItems: 'baseline'}}>
    {c.map((w, i) => {
      const on = t >= w.start - 0.03;
      const style: React.CSSProperties = w.key
        ? {fontFamily: SERIF, fontStyle: 'italic', fontWeight: 600, fontSize: 92, color: DQ.redSoft, letterSpacing: -1}
        : {fontFamily: FONT, fontWeight: 900, fontSize: 80, color: DQ.ivory, letterSpacing: -1.5};
      return <span key={i} style={{...style, opacity: on ? 1 : 0.35, textShadow: '0 4px 24px rgba(0,0,0,.85), 0 0 10px rgba(0,0,0,.8), 0 0 3px rgba(0,0,0,.9)', lineHeight: 1.08}}>{w.text}</span>;
    })}
  </div>;
};

export const DQEdit: React.FC<{edit: Edit}> = ({edit}) => {
  const frame = useCurrentFrame(), t = frame / FPS;
  const full = weight(t, edit, FULL), split = weight(t, edit, SPLIT) * (1 - full);
  const z = zoomAt(t, edit);
  const r = {x: lerp(0, CARD.x, split), y: lerp(0, CARD.y, split), w: lerp(1080, CARD.w, split), h: lerp(1920, CARD.h, split)};
  const capY = lerp(lerp(1400, CARD.y + CARD.h - 110, split), 1420, full);
  const ended = t >= edit.duration;
  return <AbsoluteFill style={{background: DQ.navyDeep}}>
    {/* speaker: always mounted so the audio never drops */}
    <div style={{position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 30 * split, overflow: 'hidden', opacity: 1 - full, boxShadow: split > 0 ? `0 30px 80px rgba(0,0,0,${0.5 * split})` : 'none'}}>
      <OffthreadVideo src={staticFile(`raw/${edit.file}`)} style={{width: '100%', height: '100%', objectFit: 'cover', objectPosition: `50% ${lerp(50, 44, split)}%`, transform: `scale(${z})`, transformOrigin: `50% ${lerp(50, 25, split)}%`}} />
      <AbsoluteFill style={{background: 'linear-gradient(to bottom, rgba(11,19,40,.82), rgba(11,19,40,.45) 18%, rgba(11,19,40,0) 34%, rgba(11,19,40,0) 58%, rgba(11,19,40,.65))'}} />
    </div>
    {edit.overlays.map((o, i) => { const C = GRAPHICS[o.g] as React.FC<any>; return <Sequence key={i} from={Math.round(o.from * FPS)} durationInFrames={Math.round((o.to - o.from) * FPS)} layout="none"><C t={t - o.from} d={o.to - o.from} {...o.props} /></Sequence>; })}
    {!ended && <Captions t={t} edit={edit} y={capY} />}
    {/* small DQ bug, top right, off whenever a full graphic is up */}
    <img src={staticFile('brand/dq-mark-ivory.png')} style={{position: 'absolute', right: 70, top: 96, height: 46, opacity: 0.85 * (1 - full) * (ended ? 0 : 1)}} />
    <Sequence from={Math.round(edit.duration * FPS)} layout="none"><GRAPHICS.EndCard t={t - edit.duration} d={edit.tail} word={edit.cta.word} line={edit.cta.line} /></Sequence>
  </AbsoluteFill>;
};
