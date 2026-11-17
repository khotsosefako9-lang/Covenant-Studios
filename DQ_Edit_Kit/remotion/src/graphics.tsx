import React from 'react';
import {AbsoluteFill, Img, staticFile} from 'remotion';
import {DQ, FONT, SERIF} from './theme';

// All graphics take t = seconds since the overlay started and d = its length.
export type G<P = {}> = React.FC<P & {t: number; d: number}>;
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const eOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
export const eIO = (x: number) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
export const back = (x: number) => { x = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
export const rise = (t: number, at: number, dy = 40, dur = 0.4): React.CSSProperties => { const p = (t - at) / dur; return {opacity: clamp(p), transform: `translateY(${(1 - eOut(p)) * dy}px)`}; };
const Em: React.FC<{children: React.ReactNode; c?: string}> = ({children, c = DQ.red}) => <span style={{fontFamily: SERIF, fontStyle: 'italic', fontWeight: 500, color: c, letterSpacing: -1}}>{children}</span>;
const Kicker: React.FC<{children: React.ReactNode; c?: string}> = ({children, c = DQ.redSoft}) => <div style={{fontFamily: FONT, fontWeight: 800, fontSize: 28, letterSpacing: 6, color: c}}>{children}</div>;
const Paper: React.FC<{style?: React.CSSProperties; children: React.ReactNode}> = ({style, children}) => <div style={{background: DQ.ivory, borderRadius: 26, boxShadow: '0 30px 80px rgba(0,0,0,.45)', padding: 54, boxSizing: 'border-box', fontFamily: FONT, color: DQ.navy, ...style}}>{children}</div>;
const bar = (w: number, c: string = DQ.hairline, h = 16) => <div style={{height: h, width: w, background: c, borderRadius: 8}} />;
const Navy: React.FC<{children: React.ReactNode}> = ({children}) => <AbsoluteFill style={{background: `radial-gradient(120% 80% at 50% 30%, #1c2d55, ${DQ.navyDeep})`}}>{children}</AbsoluteFill>;

// ---------- OVER the speaker ----------
export const Headline: G<{kicker?: string; lines: string[]; accent?: number}> = ({t, d, kicker, lines, accent = -1}) => {
  const out = 1 - seg(t, d - 0.25, d);
  return <div style={{position: 'absolute', left: 70, right: 130, top: 190, opacity: out, fontFamily: FONT}}>
    {kicker && <div style={rise(t, 0, 20)}><Kicker>{kicker}</Kicker></div>}
    {lines.map((l, i) => <div key={i} style={{...rise(t, 0.08 + i * 0.12, 40), fontWeight: 900, fontSize: 92, lineHeight: 1.02, letterSpacing: -2.5, color: DQ.ivory, textShadow: '0 4px 30px rgba(0,0,0,.6)', marginTop: i ? 0 : 14}}>{i === accent ? <Em c={DQ.redSoft}>{l}</Em> : l}</div>)}
  </div>;
};

export const LowerThird: G<{name: string; role: string}> = ({t, d, name, role}) => {
  const p = eOut(seg(t, 0, 0.45)), out = 1 - seg(t, d - 0.3, d);
  return <div style={{position: 'absolute', left: 70, top: 230, opacity: out, transform: `translateX(${(1 - p) * -80}px)`, display: 'flex', alignItems: 'center', gap: 22, background: 'rgba(11,19,40,.88)', borderLeft: `8px solid ${DQ.red}`, borderRadius: 18, padding: '22px 34px 22px 26px', fontFamily: FONT}}>
    <Img src={staticFile('brand/dq-mark-ivory.png')} style={{height: 54}} />
    <div><div style={{fontWeight: 800, fontSize: 44, color: DQ.ivory}}>{name}</div><div style={{fontWeight: 500, fontSize: 30, color: '#C9D0DE'}}>{role}</div></div>
  </div>;
};

export const Stamp: G<{word: string}> = ({t, d, word}) => {
  const p = seg(t, 0, 0.16), out = 1 - seg(t, d - 0.25, d);
  const flash = t < 0.35 ? 0.35 * (1 - t / 0.35) : 0;
  return <AbsoluteFill style={{opacity: out}}>
    <AbsoluteFill style={{background: DQ.red, opacity: flash}} />
    <div style={{position: 'absolute', left: 90, right: 90, top: 420, display: 'grid', placeItems: 'center'}}>
      <div style={{border: `14px solid ${DQ.red}`, borderRadius: 26, padding: '6px 40px', fontFamily: FONT, fontWeight: 900, fontSize: 118, letterSpacing: 4, color: DQ.red, background: 'rgba(242,241,236,.92)', transform: `rotate(${-9 + 3 * (1 - p)}deg) scale(${2.4 - 1.4 * eOut(p)})`, opacity: clamp(p * 3)}}>{word}</div>
    </div>
  </AbsoluteFill>;
};

export const CtaTop: G<{word: string; line: string}> = ({t, d, word, line}) => {
  const p = back(seg(t, 0, 0.5)), pulse = t > 0.8 ? 1 + 0.015 * Math.sin((t - 0.8) * 5) : 1;
  return <div style={{position: 'absolute', left: 70, right: 130, top: 200, fontFamily: FONT, transform: `scale(${(0.85 + 0.15 * p) * pulse})`, transformOrigin: 'left top', opacity: clamp(t / 0.25)}}>
    <div style={{display: 'inline-block', background: DQ.red, color: '#fff', borderRadius: 26, padding: '18px 34px 22px'}}>
      <div style={{fontWeight: 700, fontSize: 34}}>Comment</div>
      <div style={{fontWeight: 900, fontSize: 120, lineHeight: 1, letterSpacing: -2}}>{word}</div>
    </div>
    <div style={{marginTop: 18, fontWeight: 800, fontSize: 44, color: DQ.ivory, textShadow: '0 3px 24px rgba(0,0,0,.7)', maxWidth: 820}}>{line}</div>
  </div>;
};

// ---------- FULL-SCREEN cutaways (speaker hidden, audio keeps playing) ----------
export const TenderPage: G<{phrases: string[]; hits: number[]}> = ({t, phrases, hits}) => {
  const p = eOut(seg(t, 0, 0.5));
  return <Navy>
    <div style={{position: 'absolute', left: 70, top: 230}}><Kicker>THE TENDER DOCUMENT</Kicker></div>
    <Paper style={{position: 'absolute', left: 90, right: 90, top: 330, height: 980, transform: `translateY(${(1 - p) * 220}px) rotate(${-4 + 3 * p}deg)`}}>
      <div style={{fontWeight: 800, fontSize: 26, letterSpacing: 5, color: DQ.muted}}>INVITATION TO BID</div>
      <div style={{height: 8, width: 90, background: DQ.red, margin: '22px 0 40px'}} />
      <div style={{display: 'flex', flexDirection: 'column', gap: 22}}>
        {bar(720)}{bar(640)}{bar(700)}
        <div style={{fontSize: 52, fontWeight: 800, lineHeight: 1.35, margin: '20px 0'}}>
          {phrases.map((w, i) => { const h = eOut(seg(t, hits[i], hits[i] + 0.3)); return <span key={i} style={{background: `linear-gradient(${DQ.red}, ${DQ.red}) no-repeat left / ${h * 100}% 100%`, color: h > 0.5 ? '#fff' : DQ.navy, padding: '0 10px', borderRadius: 6, marginRight: 12}}>{w}</span>; })}
        </div>
        {bar(680)}{bar(560)}{bar(700)}{bar(420)}{bar(640)}{bar(500)}
      </div>
    </Paper>
  </Navy>;
};

export const Register: G<{signAt: number}> = ({t, signAt}) => {
  const p = eOut(seg(t, 0, 0.45)), s = seg(t, signAt, signAt + 1.1);
  const rows = ['', '', 'Your company', '', ''];
  return <Navy>
    <div style={{position: 'absolute', left: 70, top: 230}}><Kicker>BRIEFING ATTENDANCE REGISTER</Kicker></div>
    <Paper style={{position: 'absolute', left: 70, right: 70, top: 330, transform: `translateY(${(1 - p) * 200}px)`}}>
      <div style={{display: 'grid', gridTemplateColumns: '1.4fr 1fr', fontWeight: 800, fontSize: 26, letterSpacing: 4, color: DQ.muted, paddingBottom: 18, borderBottom: `3px solid ${DQ.navy}`}}><span>COMPANY</span><span>SIGNATURE</span></div>
      {rows.map((r, i) => <div key={i} style={{display: 'grid', gridTemplateColumns: '1.4fr 1fr', alignItems: 'center', height: 130, borderBottom: `2px solid ${DQ.hairline}`, background: r ? 'rgba(200,55,45,.08)' : 'none', margin: '0 -20px', padding: '0 20px'}}>
        {r ? <span style={{fontWeight: 900, fontSize: 46, color: DQ.navy}}>{r}</span> : bar(300 + (i * 53) % 120, '#C7CCD3', 20)}
        {r ? <svg viewBox="0 0 300 90" width={300} height={90}><path d="M10 60 C 40 10, 60 90, 90 45 S 140 20, 160 55 S 210 80, 230 35 S 270 30, 290 50" fill="none" stroke={DQ.navy} strokeWidth={6} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - s} /></svg> : bar(160 + (i * 37) % 90, '#C7CCD3', 12)}
      </div>)}
      <div style={{marginTop: 34, fontFamily: SERIF, fontStyle: 'italic', fontWeight: 500, fontSize: 46, color: DQ.red, opacity: seg(t, signAt + 1.1, signAt + 1.5)}}>Signed. Proof you were there.</div>
    </Paper>
  </Navy>;
};

export const EndCard: G<{word: string; line: string}> = ({t, word, line}) => {
  const p = eOut(seg(t, 0, 0.5));
  return <AbsoluteFill style={{background: DQ.ivory, fontFamily: FONT, alignItems: 'center', justifyContent: 'center', textAlign: 'center'}}>
    <div style={{opacity: p, transform: `translateY(${(1 - p) * 40}px)`}}>
      <Img src={staticFile('brand/dq-mark.png')} style={{height: 170}} />
      <div style={{marginTop: 50, fontWeight: 900, fontSize: 84, letterSpacing: -2, color: DQ.navy}}>Comment <span style={{color: DQ.red}}>{word}</span></div>
      <div style={{marginTop: 14, fontWeight: 700, fontSize: 40, color: DQ.ink}}>{line}</div>
      <div style={{marginTop: 26, fontFamily: SERIF, fontStyle: 'italic', fontWeight: 500, fontSize: 46, color: DQ.red}}>dulyqualified.co.za</div>
    </div>
  </AbsoluteFill>;
};

// ---------- SPLIT panels (speaker shrinks to a card above, panel below) ----------
const Panel: React.FC<{t: number; d: number; children: React.ReactNode}> = ({t, d, children}) => {
  const p = eOut(seg(t, 0.1, 0.55)), out = 1 - seg(t, d - 0.3, d);
  return <div style={{position: 'absolute', left: 54, right: 54, top: 930, height: 560, opacity: Math.min(p, out), transform: `translateY(${(1 - p) * 80}px)`, fontFamily: FONT}}>{children}</div>;
};

export const StrikePanel: G<{text: string; after: string; strikeAt: number}> = ({t, d, text, after, strikeAt}) => {
  const s = eOut(seg(t, strikeAt, strikeAt + 0.35));
  return <Panel t={t} d={d}><Paper style={{height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
    <div style={{fontWeight: 800, fontSize: 26, letterSpacing: 5, color: DQ.muted}}>YOUR QUOTE</div>
    <div style={{position: 'relative', display: 'inline-block', alignSelf: 'flex-start', marginTop: 18, fontWeight: 900, fontSize: 74, letterSpacing: -2, color: DQ.navy}}>{text}
      <div style={{position: 'absolute', left: -10, top: '52%', height: 12, width: `calc(${s * 100}% + ${20 * s}px)`, background: DQ.red, borderRadius: 6, transform: 'rotate(-3deg)'}} /></div>
    <div style={{marginTop: 26, fontFamily: SERIF, fontStyle: 'italic', fontWeight: 500, fontSize: 54, color: DQ.red, opacity: seg(t, strikeAt + 0.3, strikeAt + 0.6)}}>{after}</div>
  </Paper></Panel>;
};

export const DiaryPanel: G<{title: string; items: string[]; at: number[]}> = ({t, d, title, items, at}) => <Panel t={t} d={d}><Paper style={{height: '100%'}}>
  <div style={{display: 'flex', alignItems: 'center', gap: 16}}><div style={{width: 64, height: 64, borderRadius: 14, background: DQ.red, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 30}}>!</div><div style={{fontWeight: 900, fontSize: 52, letterSpacing: -1}}>{title}</div></div>
  <div style={{marginTop: 30, display: 'flex', flexDirection: 'column', gap: 22}}>{items.map((it, i) => { const p = eOut(seg(t, at[i], at[i] + 0.3)); return <div key={i} style={{display: 'flex', alignItems: 'center', gap: 22, fontSize: 46, fontWeight: 700, opacity: 0.35 + 0.65 * p}}>
    <div style={{width: 52, height: 52, borderRadius: 12, border: `5px solid ${DQ.navy}`, display: 'grid', placeItems: 'center', color: DQ.red, fontWeight: 900, fontSize: 40}}>{p > 0.5 ? '✓' : ''}</div>{it}</div>; })}</div>
</Paper></Panel>;

export const NumbersPanel: G<{strikeAt: number; label: string}> = ({t, d, strikeAt, label}) => {
  const nums = ['082 ••• 4410', '071 ••• 9023', '083 ••• 1187', '064 ••• 5530', '079 ••• 2245', '060 ••• 7718', '084 ••• 3092', '072 ••• 6651'];
  const scroll = t * 70, s = eOut(seg(t, strikeAt, strikeAt + 0.4));
  return <Panel t={t} d={d}><Paper style={{height: '100%', overflow: 'hidden', position: 'relative', padding: '40px 54px'}}>
    <div style={{fontWeight: 800, fontSize: 26, letterSpacing: 5, color: DQ.muted}}>A "LEADS" LIST</div>
    <div style={{marginTop: 20, height: 400, overflow: 'hidden'}}><div style={{transform: `translateY(${-scroll % 64}px)`}}>{[...nums, ...nums].map((n, i) => <div key={i} style={{fontWeight: 700, fontSize: 46, lineHeight: '64px', color: '#5b6474', fontVariantNumeric: 'tabular-nums'}}>{n}</div>)}</div></div>
    <div style={{position: 'absolute', inset: 0, background: `rgba(242,241,236,${0.55 * s})`}} />
    <div style={{position: 'absolute', left: 30, right: 30, top: '50%', height: 14, background: DQ.red, borderRadius: 7, transform: `rotate(-8deg) scaleX(${s})`, transformOrigin: 'left'}} />
    <div style={{position: 'absolute', right: 54, bottom: 40, fontFamily: SERIF, fontStyle: 'italic', fontWeight: 600, fontSize: 64, color: DQ.red, opacity: seg(t, strikeAt + 0.3, strikeAt + 0.6)}}>{label}</div>
  </Paper></Panel>;
};

export const ChecklistPanel: G<{title: string; items: string[]; at: number[]}> = ({t, d, title, items, at}) => <Panel t={t} d={d}><Paper style={{height: '100%'}}>
  <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}><div style={{fontWeight: 900, fontSize: 50, letterSpacing: -1}}>{title}</div><Img src={staticFile('brand/dq-mark.png')} style={{height: 56}} /></div>
  <div style={{height: 8, width: 90, background: DQ.red, margin: '20px 0 34px'}} />
  <div style={{display: 'flex', flexDirection: 'column', gap: 30}}>{items.map((it, i) => { const p = seg(t, at[i], at[i] + 0.35); return <div key={i} style={{display: 'flex', alignItems: 'center', gap: 24, fontSize: 48, fontWeight: 700, opacity: 0.35 + 0.65 * clamp(p * 2)}}>
    <div style={{width: 64, height: 64, borderRadius: 32, background: p > 0 ? DQ.red : 'none', border: `5px solid ${p > 0 ? DQ.red : DQ.hairline}`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 38, fontWeight: 900, transform: `scale(${p > 0 ? 0.6 + 0.4 * back(p) : 1})`}}>{p > 0 ? '✓' : ''}</div>{it}</div>; })}</div>
</Paper></Panel>;

export const LeadCardPanel: G<{message: string; at: number}> = ({t, d, message, at}) => {
  const fields = ['Business', 'Needs', 'Decision-maker', 'Contact'];
  const typed = Math.floor(message.length * seg(t, at + 1.4, at + 3.6));
  return <Panel t={t} d={d}><Paper style={{height: '100%', padding: '40px 50px'}}>
    <div style={{display: 'flex', justifyContent: 'space-between'}}><div style={{fontWeight: 800, fontSize: 26, letterSpacing: 5, color: DQ.muted}}>LEAD 07 OF 20</div><div style={{fontWeight: 800, fontSize: 26, letterSpacing: 3, color: DQ.red}}>CHECKED ✓</div></div>
    <div style={{display: 'grid', gridTemplateColumns: '260px 1fr', rowGap: 18, marginTop: 26, alignItems: 'center'}}>{fields.map((f, i) => { const p = eOut(seg(t, at + i * 0.3, at + i * 0.3 + 0.3)); return <React.Fragment key={f}><span style={{fontWeight: 700, fontSize: 32, color: DQ.muted}}>{f}</span><div style={{transform: `scaleX(${p})`, transformOrigin: 'left'}}>{bar(360 - i * 40, DQ.navy, 22)}</div></React.Fragment>; })}</div>
    <div style={{marginTop: 30, background: DQ.navy, color: DQ.ivory, borderRadius: '24px 24px 24px 6px', padding: '22px 28px', fontSize: 34, fontWeight: 500, minHeight: 120, opacity: seg(t, at + 1.2, at + 1.5)}}>{message.slice(0, typed)}<span style={{opacity: Math.sin(t * 10) > 0 ? 1 : 0}}>|</span></div>
  </Paper></Panel>;
};

export const LockPanel: G<{title: string; sub: string; closeAt: number}> = ({t, d, title, sub, closeAt}) => {
  const c = back(seg(t, closeAt, closeAt + 0.35));
  return <Panel t={t} d={d}><Paper style={{height: '100%', display: 'flex', alignItems: 'center', gap: 44}}>
    <svg viewBox="0 0 160 200" width={190} height={240}><path d={`M40 ${100 - 0} V60 a40 40 0 0 1 80 0 V${60 + 40 * c}`} fill="none" stroke={DQ.navy} strokeWidth={18} strokeLinecap="round" transform={`translate(0 ${-26 * (1 - c)})`} /><rect x={14} y={92} width={132} height={100} rx={18} fill={DQ.red} /><circle cx={80} cy={136} r={12} fill={DQ.ivory} /><rect x={74} y={140} width={12} height={28} rx={6} fill={DQ.ivory} /></svg>
    <div><div style={{fontWeight: 900, fontSize: 70, letterSpacing: -2, lineHeight: 1}}>{title}</div><div style={{marginTop: 18, fontFamily: SERIF, fontStyle: 'italic', fontWeight: 500, fontSize: 46, color: DQ.red, opacity: seg(t, closeAt + 0.3, closeAt + 0.6)}}>{sub}</div></div>
  </Paper></Panel>;
};

export const GRAPHICS = {Headline, LowerThird, Stamp, CtaTop, TenderPage, Register, EndCard, StrikePanel, DiaryPanel, NumbersPanel, ChecklistPanel, LeadCardPanel, LockPanel} as const;
export type GraphicName = keyof typeof GRAPHICS;
