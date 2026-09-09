// ---------------------------------------------------------------------------
//  Bygger dist/index.html - hele verktøyet i én fil.
//
//  Modulene er skrevet med relative import-setninger og `export` foran
//  erklæringene, så en strip-og-slå-sammen holder. Importer over flere linjer
//  slås sammen først. Importer av three beholdes og hentes via importmap.
//
//    node build.mjs
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Avhengighetsrekkefølge
const ORDER = [
  'src/core/download.js',
  'src/engine/calc.js',
  'src/engine/plan.js',
  'src/engine/solid.js',
  'src/engine/geometry.js',
  'src/core/model.js',
  'src/core/reinforcement.js',
  'src/engine/stm.js',
  'src/engine/reinforcement-geometry.js',
  'src/engine/plate-solver.js',
  'src/engine/en1992-4.js',
  'src/engine/supplementary-reinforcement.js',
  'src/engine/b19.js',
  'src/engine/validate.js',
  'src/engine/verify.js',
  'src/viz/three-d-stage.js',
  'src/viz/scene-builder.js',
  'src/ui/fields.js',
  'src/ui/plan-editor.js',
  'src/ui/app.js',
];

const REL_IMPORT = /^\s*import\s+(?:[^'"]*\s+from\s+)?['"](\.[^'"]*)['"];?\s*$/;
const BARE_IMPORT = /^\s*import\s+.*\s+from\s+['"](?!\.)[^'"]*['"];?\s*$/;

const bare = new Set();
const parts = [];

const missing = [];

for (const rel of ORDER) {
  let src = await readFile(join(ROOT, rel), 'utf8');
  // Importer som går over flere linjer slås sammen til én først, ellers ser
  // linjefiltrene under bare den første linja og lar resten stå igjen.
  src = src.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?/gm,
                    stmt => stmt.replace(/\s+/g, ' '));
  const kept = [];
  for (const line of src.split('\n')) {
    const relImp = REL_IMPORT.exec(line);
    if (relImp) {
      // Interne importer fjernes - men da MÅ modulen de peker på ligge i ORDER,
      // ellers forsvinner den ut av bundelen og feilen dukker først opp som
      // «x is not defined» i nettleseren.
      const target = normalize(join(dirname(rel), relImp[1]));
      if (!ORDER.includes(target)) missing.push(`  ${rel}  importerer  ${target}`);
      continue;
    }
    if (BARE_IMPORT.test(line)) { bare.add(line.trim()); continue; }
    kept.push(line.replace(/^export\s+(?=(const|let|var|function|class|async)\b)/, ''));
  }
  parts.push(`// ===== ${rel} ${'='.repeat(Math.max(0, 60 - rel.length))}\n` +
             kept.join('\n').replace(/\n{3,}/g, '\n\n').trim());
}

if (missing.length) {
  console.error('Modul mangler i ORDER-lista i build.mjs:\n' +
    [...new Set(missing)].join('\n') +
    '\nLegg den inn i riktig avhengighetsrekkefølge.');
  process.exit(1);
}

// --- kollisjonssjekk ------------------------------------------------------
// Modulene slås sammen til ett skop. To moduler som deklarerer samme navn på
// toppnivå er lovlig i ESM, men gir «Identifier has already been declared» i
// bundelen. Det skal stoppe bygget, ikke nettleseren.
{
  const DECL = /^(?:const|let|var|function|async function|class)\s+([A-Za-z_$][\w$]*)/;
  const seen = new Map(), clash = [];
  for (let i = 0; i < ORDER.length; i++) {
    for (const line of parts[i].split('\n')) {
      const m = DECL.exec(line);
      if (!m) continue;
      const name = m[1];
      if (seen.has(name) && seen.get(name) !== ORDER[i])
        clash.push(`  ${name}  -  ${seen.get(name)}  og  ${ORDER[i]}`);
      else seen.set(name, ORDER[i]);
    }
  }
  if (clash.length) {
    console.error('Navnekollisjon på toppnivå mellom modulene:\n' +
      [...new Set(clash)].join('\n') +
      '\nDøp om det ene navnet - bundelen deler ett skop.');
    process.exit(1);
  }
}

// --- API-sjekk mot 3D-ruta -----------------------------------------------
// Appen snakker med <three-d-stage> gjennom metodekall. Forsvinner en metode
// under omskriving, kompilerer bundelen fint og feilen dukker først opp som
// «... is not a function» i nettleseren. Her sammenholdes kallene i app.js med
// metodene som faktisk finnes i komponenten.
{
  const app = await readFile(join(ROOT, 'src/ui/app.js'), 'utf8');
  const stage = await readFile(join(ROOT, 'src/viz/three-d-stage.js'), 'utf8');
  const called = new Set();
  for (const m of app.matchAll(/\$\('#stage'\)\.(\w+)/g)) called.add(m[1]);
  const methods = new Set();
  // Tar med gettere og settere, ikke bare vanlige metoder.
  for (const m of stage.matchAll(/^\s{2}(?:async\s+|get\s+|set\s+|\*\s*)?(\w+)\s*\(/gm))
    methods.add(m[1]);
  const fields = new Set();
  for (const m of stage.matchAll(/this\.(\w+)\s*=/g)) fields.add(m[1]);
  const missing = [...called].filter(k => !methods.has(k) && !fields.has(k));
  if (missing.length) {
    console.error('app.js kaller på <three-d-stage> som ikke finnes:\n' +
      missing.map(k => `  stage.${k}`).join('\n') +
      '\nSjekk at metoden ikke er blitt borte i src/viz/three-d-stage.js.');
    process.exit(1);
  }
}

const css = await readFile(join(ROOT, 'src/ui/style.css'), 'utf8');
const html = await readFile(join(ROOT, 'index.html'), 'utf8');

// Hent kroppen fra index.html, uten <script>-taggene
const body = html
  .replace(/[\s\S]*<body>/, '')
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<\/body>[\s\S]*/, '')
  .trim();

const out = `<title>Bruddkjegle</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<script type="importmap">
{ "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/"
} }
<\/script>
<style>
${css.trim()}
</style>
${body}
<script type="module">
${[...bare].join('\n')}

${parts.join('\n\n')}

boot();
<\/script>
`;

await mkdir(join(ROOT, 'dist'), { recursive: true });

// --- syntakssjekk av selve bundelen ---------------------------------------
// Modulene er gyldige hver for seg, men det sier ingenting om hvordan de ser ut
// slått sammen til ett skop. Her parses den ferdige bundelen slik nettleseren
// ville gjort det, så bygget - ikke brukeren - finner feilen.
{
  const script = out.slice(out.indexOf('<script type="module">') + 22,
                           out.lastIndexOf('<\/script>'));
  const tmp = join(ROOT, 'dist/.bundle-check.mjs');
  await writeFile(tmp, script);
  try {
    await promisify(execFile)(process.execPath, ['--check', tmp]);
  } catch (e) {
    console.error('Bundelen er ikke gyldig JavaScript:\n' +
      String(e.stderr || e.message).split('\n').slice(0, 12).join('\n'));
    await rm(tmp, { force: true });
    process.exit(1);
  }
  await rm(tmp, { force: true });
}

await writeFile(join(ROOT, 'dist/index.html'), out);

// dist/index.html er en fragment-fil: artefakt-verten pakker den i sitt eget
// skjelett. Denne kopien legger på et tilsvarende skjelett, så bundelen kan
// åpnes lokalt under de samme betingelsene som den publiserte sida.
await writeFile(join(ROOT, 'dist/artifact-sim.html'),
  '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui;' +
  'background:#faf9f7}img{max-width:100%}[hidden]{display:none!important}</style>\n' +
  '</head>\n<body>\n' + out + '\n</body>\n</html>\n');

console.log(`dist/index.html  ${(out.length / 1024).toFixed(1)} kB  ` +
            `(${ORDER.length} moduler, ${bare.size} eksterne importer)`);
