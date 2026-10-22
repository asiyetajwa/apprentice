import React from 'react';
import { Composition } from 'remotion';
import { FPS } from './components/Film';
import { apprenticeFilm } from './apprentice/ApprenticeFilm';

export const Root: React.FC = () => (
  <>
    <Composition
      id="ApprenticeLandscape"
      component={apprenticeFilm.Component}
      durationInFrames={apprenticeFilm.durationInFrames}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={apprenticeFilm.defaultProps}
      calculateMetadata={apprenticeFilm.calculateMetadata}
    />
  </>
);
