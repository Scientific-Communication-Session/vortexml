// Where the recorded clips (public/tutorial/) are fetched from.
//
// A re-recorded clip keeps its file name, and files from public/ are cached for
// hours, by browsers and by Cloudflare. Raise the version with every
// re-recording so the new clips are fetched under a new address straight away.
const CLIPS_VERSION = 2;

/** The address of a clip file, e.g. `clipUrl('06-train.mp4')`. */
export const clipUrl = (file: string) => `/tutorial/${file}?v=${CLIPS_VERSION}`;
