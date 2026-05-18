// Self-hosted fonts via @fontsource. Replaces the fonts.googleapis.com CSS
// chain in spa.html — woff2s are fingerprinted, served same-origin, and
// cached across deploys. Family names match the Tailwind tokens in project.css.

// Fraunces variable (heading): covers wght + opsz axes — used as font-heading
// at weights 400, 600, 700 across the app. Italic axis included separately.
import '@fontsource-variable/fraunces/standard.css';
import '@fontsource-variable/fraunces/standard-italic.css';

// DM Sans (body): static weights actually referenced in components.
import '@fontsource/dm-sans/300.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/600.css';

// Caveat (handwriting accents — LighterInput, scribble annotations).
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
