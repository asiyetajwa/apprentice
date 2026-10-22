import { createFilm } from '../components/Film';
import { SCENES } from './script';
import { BaselineScene, IntroScene, JobScene, OutroScene, ProveScene, ReceiptsScene, TeachScene, TrainScene } from './scenes';

export const apprenticeFilm = createFilm('apprentice', SCENES, {
  intro: IntroScene,
  job: JobScene,
  baseline: BaselineScene,
  teach: TeachScene,
  train: TrainScene,
  prove: ProveScene,
  receipts: ReceiptsScene,
  outro: OutroScene,
});
