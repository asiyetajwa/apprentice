import { continueRender, delayRender, staticFile } from 'remotion';

// Apprentice's product look: grey stone, moulded panels, ink text, a Saffron touch, Manrope type.
export const theme = {
  bg: '#e4e4e2',
  card: '#f1f1ef',
  text: '#3a3a3a',
  ink: '#2a2a28',
  muted: '#6c6c6a',
  faint: '#9a9a97',
  lit: '#e8a400',
  litLight: '#ffcf4d',
  litText: '#8a5f00',
  font: "'Manrope', system-ui, sans-serif",
} as const;

let fontsRequested = false;

/** Loads Manrope (SIL Open Font License) before the first frame renders. */
export function ensureFonts(): void {
  if (fontsRequested || typeof document === 'undefined') return;
  fontsRequested = true;
  const handle = delayRender('Loading fonts');
  new FontFace('Manrope', `url(${staticFile('fonts/manrope-variable.woff2')}) format('woff2')`, { weight: '200 800' })
    .load()
    .then((f) => {
      document.fonts.add(f);
    })
    .catch((err: unknown) => {
      console.error(err);
    })
    .finally(() => {
      continueRender(handle);
    });
}
