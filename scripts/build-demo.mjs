// Builds a browser-only demo into demo-dist/: the same app, with demo.ts standing in for the server and replaying
// demo/recording.json. Paths are relative so it can be hosted from any folder.
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('demo-dist', { recursive: true });
await build({ entryPoints: { app: 'src/web/demo-entry.ts' }, bundle: true, format: 'esm', target: 'es2022', minify: true, outdir: 'demo-dist' });
for (const f of ['styles.css', 'logo.svg']) await cp(`src/web/${f}`, `demo-dist/${f}`);
await cp('demo/recording.json', 'demo-dist/recording.json');
const html = (await readFile('src/web/index.html', 'utf8')).replace(/(href|src)="\/(styles\.css|logo\.svg|app\.js)"/g, '$1="$2"');
await writeFile('demo-dist/index.html', html);

// A single-page version for hosts that wrap the page in their own document: title, inline styles, the logo as a
// data URI, and the app script inline. Only recording.json is loaded beside it.
const css = await readFile('src/web/styles.css', 'utf8');
const js = await readFile('demo-dist/app.js', 'utf8');
if (js.includes('</script')) throw new Error('app.js contains </script and cannot be inlined');
const logo = `data:image/svg+xml;base64,${(await readFile('src/web/logo.svg')).toString('base64')}`;
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"')).replace(/src="logo\.svg"/g, `src="${logo}"`);
const fonts = html.match(/<link rel="preconnect"[^>]*>|<link href="https:\/\/fonts[^>]*>/g).join('\n');
await writeFile('demo-dist/artifact.html', `<title>Apprentice</title>
<meta name="description" content="Browser demo of Apprentice: an agent that tests a small model, has Nemotron teach it, fine-tunes it and ships it only if it wins.">
<link rel="icon" href="${logo}">
${fonts}
<style>${css}</style>
${body}<script type="module">${js}</script>
`);
console.log('demo: built demo-dist/');
