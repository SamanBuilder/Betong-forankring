// ---------------------------------------------------------------------------
//  Registrering av utregninga.
//
//  Hver kontroll bygger et Calc-objekt mens den regner, slik at brukeren kan
//  se hele veien fram til svaret: hvilke inndata som gikk inn og hvor de kom
//  fra, hver formel symbolsk, de samme formlene med tall satt inn, og hvilket
//  punkt i standarden leddet stammer fra.
//
//  Poenget er at ingen tall i resultatet skal være uten sporbar opprinnelse.
// ---------------------------------------------------------------------------

// Norsk tallformat. Presisjonen følger størrelsesorden, så et areal ikke får
// tre desimaler og en psi-faktor ikke blir avrundet til «1».
export function n(v, dec) {
  if (v === Infinity) return '∞';
  if (!Number.isFinite(v)) return '–';
  if (dec == null) {
    const a = Math.abs(v);
    dec = a === 0 ? 0 : a >= 1e5 ? 0 : a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3;
  }
  return v.toFixed(dec).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// kN/kNm for kraftstørrelser
export const kN = v => n(v / 1000, Math.abs(v) >= 1e6 ? 0 : 1);

export class Calc {
  constructor(clause) {
    this.clause = clause;
    this.inputs = [];
    this.steps = [];
    this.result = null;
    this.check = null;
  }

  // Inndata: symbol, verdi, enhet, hvor den er hentet fra
  in(sym, value, unit, source) {
    this.inputs.push({ sym, value, unit, source });
    return value;
  }

  // Mellomledd. `formula` er symbolsk, `subst` er den samme med tall i.
  step({ sym, desc, formula, subst, value, unit, ref, note }) {
    this.steps.push({ sym, desc, formula, subst, value, unit, ref, note });
    return value;
  }

  // Sluttkapasitet
  res({ sym, formula, subst, value, unit, ref }) {
    this.result = { sym, formula, subst, value, unit, ref };
    return value;
  }

  // Selve utnyttelsen
  util({ formula, subst, value }) {
    this.check = { formula, subst, value };
    return value;
  }
}

// Tom registrering for kontroller som ikke er aktuelle
export function skipped(clause, why) {
  const c = new Calc(clause);
  c.skipped = why;
  return c;
}
