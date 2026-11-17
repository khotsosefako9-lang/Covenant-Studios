import React from 'react';
import {Composition} from 'remotion';
import {DQEdit} from './DQEdit';
import {EDITS} from './edits';
import {FPS} from './theme';

export const Root: React.FC = () => <>
  {EDITS.map((e) => <Composition key={e.id} id={e.id} component={DQEdit as React.FC<any>} defaultProps={{edit: e}} width={1080} height={1920} fps={FPS} durationInFrames={Math.round((e.duration + e.tail) * FPS)} />)}
</>;
