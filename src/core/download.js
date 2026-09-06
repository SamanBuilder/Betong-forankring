// ---------------------------------------------------------------------------
//  Filnedlasting som virker begge steder.
//
//  Kjører verktøyet lokalt (eller selvhostet) brukes vanlig <a download>.
//  Kjører det som publisert Artifact er direkte nedlasting sperret, og fila
//  må gå gjennom verts-API-et - som bare godtar en liste med filendelser.
//  .obj/.mtl/.glb står ikke på lista, så de legges om:
//      .obj/.mtl -> .txt   (ren tekst uansett, endres tilbake ved lagring)
//      .gltf     -> .json  (glTF ER JSON - fila er gyldig som den er)
//  .glb (binær) har ingen vei gjennom, så eksporten velger glTF der i stedet.
// ---------------------------------------------------------------------------

const ALLOWED = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'txt',
  'json', 'md', 'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx']);
const REMAP = { obj: 'txt', mtl: 'txt', gltf: 'json' };

let cap;
function host() {
  if (cap === undefined) {
    cap = (typeof window !== 'undefined' && window.claude?.use)
      ? Promise.resolve(window.claude.use('downloads')).catch(() => null)
      : Promise.resolve(null);
  }
  return cap;
}

// Kan verten lagre filer for oss?  Avgjør hvilket 3D-format vi eksporterer.
export async function hostSaves() { return !!(await host()); }

export async function saveFile(data, filename) {
  const dl = await host();
  if (!dl) { anchorSave(data, filename); return { filename, renamed: null }; }

  const ext = (filename.split('.').pop() || '').toLowerCase();
  let name = filename, renamed = null;
  if (!ALLOWED.has(ext)) {
    const to = REMAP[ext];
    if (!to) throw new Error(`Formatet .${ext} kan ikke lastes ned her.`);
    name = `${filename.replace(/\.[^.]+$/, '')}-${ext}.${to}`;
    renamed = { from: ext, to };
  }
  await dl.save({ filename: name, data });
  return { filename: name, renamed };
}

function anchorSave(data, filename) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Kort, konkret melding til brukeren om hva som faktisk skjedde.
export function saveMessage(res) {
  if (!res.renamed) return `Lagret ${res.filename}`;
  return `Lagret ${res.filename} – gi den endelsen .${res.renamed.from} etter nedlasting`;
}

export function saveError(e) {
  const code = e?.code;
  if (code === 'declined') return 'Nedlasting avbrutt';
  if (code === 'rate_limited') return 'For mange nedlastinger – prøv igjen om litt';
  if (code === 'unavailable' || code === 'not_granted') return 'Nedlasting er ikke tilgjengelig her';
  return e?.message || 'Nedlasting feilet';
}
