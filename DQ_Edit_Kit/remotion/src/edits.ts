// One entry per raw clip. Times are seconds in the RAW clip (from the Descript transcripts).
// To retime anything, change the numbers here and re-render: no other file needs touching.
import type {GraphicName} from './graphics';

export type Overlay = {g: GraphicName; from: number; to: number; props?: Record<string, unknown>};
export type Zoom = {at: number; to: number; scale: number; hard?: boolean};
export type Edit = {id: string; file: string; duration: number; tail: number; cta: {word: string; line: string}; srt: string; keywords: string[]; zooms: Zoom[]; overlays: Overlay[]};

const SRT_4764 = `1
00:00:00,190 --> 00:00:02,969
Security company owners, this one hurts.

2
00:00:03,146 --> 00:00:07,795
Anytime you look to apply for a new tender, look for these three keywords,

3
00:00:08,860 --> 00:00:11,081
compulsory briefing attendance.

4
00:00:11,378 --> 00:00:11,908
Why?

5
00:00:12,126 --> 00:00:15,740
Because if you do not attend the compulsory briefing, your bid

6
00:00:15,760 --> 00:00:18,038
gets disqualified automatically.

7
00:00:18,312 --> 00:00:21,848
It does not matter how good your pricing is, it gets disqualified.

8
00:00:22,055 --> 00:00:26,020
So ensure that you jot this down in your notebook, in your diary, and make

9
00:00:26,020 --> 00:00:29,668
sure that you're always in attendance and that you sign the register.

10
00:00:30,083 --> 00:00:32,618
Very important, sign the register.

11
00:00:32,894 --> 00:00:35,761
They need proof that you were there in attendance.

12
00:00:35,995 --> 00:00:36,379
Right?

13
00:00:36,936 --> 00:00:41,127
Comment check, and I'll send you a free two-minute check to see whether your

14
00:00:41,127 --> 00:00:43,285
documents are ready and in compliance.`;

const SRT_4744 = `1
00:00:00,447 --> 00:00:00,980
Greetings.

2
00:00:01,004 --> 00:00:03,560
My name is Khotso Sefako from Duly Qualified.

3
00:00:03,580 --> 00:00:07,673
So people hear leads and automatically just assume we provide a random

4
00:00:07,673 --> 00:00:08,979
list of phone numbers every month.

5
00:00:09,292 --> 00:00:10,775
That could not be further from the truth.

6
00:00:11,049 --> 00:00:14,680
The reason why we're called Duly Qualified is because every lead is hand-checked

7
00:00:14,700 --> 00:00:17,599
by me personally, hence the qualified.

8
00:00:17,924 --> 00:00:22,485
So we ensure that every business is in operation firstly, and that they are

9
00:00:22,485 --> 00:00:26,734
in need of the specific services that you offer as the business owner, right?

10
00:00:26,856 --> 00:00:28,211
Two very important factors.

11
00:00:28,554 --> 00:00:32,282
And once that is done, once that check has been made, then we ensure that

12
00:00:32,282 --> 00:00:36,964
we provide contact details and one initial outreach message for each lead.

13
00:00:37,195 --> 00:00:40,234
The reason why we do this is because we wanna ease the process as much

14
00:00:40,234 --> 00:00:42,178
as possible for the business owner.

15
00:00:42,469 --> 00:00:44,771
So every lead is yours and yours alone.

16
00:00:44,940 --> 00:00:48,101
It will not be shared amongst your competitors, so you can be rest assured.

17
00:00:48,455 --> 00:00:52,580
Comment sample if you want me to send you a free sample for your business,

18
00:00:52,786 --> 00:00:56,704
and we can hop on a 15-minute call to see how we work things out.`;

export const EDITS: Edit[] = [
  {
    id: 'Briefing', file: 'IMG_4744.mp4', duration: 43.6, tail: 2.2,
    cta: {word: 'CHECK', line: 'Free 2-minute Tender Readiness Check'},
    srt: SRT_4764,
    keywords: ['hurts', 'compulsory', 'briefing', 'attendance', 'disqualified', 'automatically', 'pricing', 'register', 'proof', 'check', 'free'],
    zooms: [
      {at: 0.0, to: 3.0, scale: 1.12},                 // hook: tighter
      {at: 11.35, to: 12.1, scale: 1.28, hard: true},  // "Why?"
      {at: 15.95, to: 18.1, scale: 1.18, hard: true},  // disqualified
      {at: 30.05, to: 32.7, scale: 1.2, hard: true},   // very important, sign the register
      {at: 35.95, to: 36.5, scale: 1.3, hard: true},   // "Right?"
    ],
    overlays: [
      {g: 'Headline', from: 0.15, to: 3.0, props: {kicker: 'SECURITY COMPANY OWNERS', lines: ['This one', 'hurts.'], accent: 1}},
      {g: 'TenderPage', from: 7.0, to: 11.2, props: {phrases: ['Compulsory', 'briefing', 'attendance'], hits: [1.86, 2.38, 2.9]}},
      {g: 'Stamp', from: 16.2, to: 18.2, props: {word: 'DISQUALIFIED'}},
      {g: 'StrikePanel', from: 18.3, to: 21.9, props: {text: 'Lowest price', after: 'Still disqualified.', strikeAt: 2.3}},
      {g: 'DiaryPanel', from: 22.0, to: 26.0, props: {title: 'Briefing session', items: ['Date', 'Time', 'Venue'], at: [0.9, 1.6, 2.3]}},
      {g: 'Register', from: 26.1, to: 30.0, props: {signAt: 2.2}},
      {g: 'CtaTop', from: 36.9, to: 43.6, props: {word: 'CHECK', line: 'Free 2-minute check of your tender papers'}},
    ],
  },
  {
    id: 'QualifiedLead', file: 'IMG_4764.mp4', duration: 57.1, tail: 2.2,
    cta: {word: 'SAMPLE', line: 'A free sample of leads for your business'},
    srt: SRT_4744,
    keywords: ['Qualified', 'random', 'truth', 'hand-checked', 'personally', 'operation', 'need', 'contact', 'outreach', 'alone', 'competitors', 'sample', '15-minute'],
    zooms: [
      {at: 9.25, to: 10.85, scale: 1.22, hard: true},  // could not be further from the truth
      {at: 14.9, to: 17.6, scale: 1.15},               // by me personally
      {at: 26.8, to: 28.3, scale: 1.2, hard: true},    // two very important factors
      {at: 37.2, to: 42.2, scale: 1.1},                // ease the process
    ],
    overlays: [
      {g: 'LowerThird', from: 0.9, to: 4.6, props: {name: 'Khotso Sefako', role: 'Founder, Duly Qualified'}},
      {g: 'NumbersPanel', from: 5.2, to: 11.0, props: {strikeAt: 4.1, label: 'Not this.'}},
      {g: 'Headline', from: 13.2, to: 17.7, props: {kicker: 'WHY "DULY QUALIFIED"', lines: ['Every lead,', 'hand-checked.'], accent: 1}},
      {g: 'ChecklistPanel', from: 17.9, to: 28.4, props: {title: 'Every lead is checked', items: ['In operation', 'Needs your service'], at: [2.15, 4.75]}},
      {g: 'LeadCardPanel', from: 29.0, to: 37.2, props: {at: 2.6, message: "Hi, I saw you're looking for a new security provider for your site. Could I send you a quote?"}},
      {g: 'LockPanel', from: 42.3, to: 48.3, props: {title: 'Yours alone.', sub: 'Never shared with competitors.', closeAt: 2.05}},
      {g: 'CtaTop', from: 48.4, to: 57.1, props: {word: 'SAMPLE', line: 'Free sample for your business + a 15-minute call'}},
    ],
  },
];
