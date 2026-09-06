# Betong forankring

3D-prosjekteringsverktøy for forankring i betong. Prototype.

Ikke bundet til ett produkt: regelverket ligger i utbyttbare moduler, og
geometri/laster settes fritt.

## Hva prototypen dekker

**Forbindelsestype:** forankringsplate med innstøpte hodebolter (headed studs),
rektangulært boltemønster, i en betongdel med inntil fire frie kanter.

**Regelverk:** NS-EN 1992-4:2018 er implementert. Betongelementboka bind B
kap. B19 er en *tom plugin* – se «Status B19» under.

### Kontroller som kjøres

| Kontroll | Pkt. i EN 1992-4 | Nivå |
|---|---|---|
| Stålbrudd, strekk | 7.2.1.3 | bolt |
| Uttrekk (hodetrykk) | 7.2.1.5 | bolt |
| Betongkjegle | 7.2.1.4 | gruppe |
| Utblåsing ved kant (blow-out) | 7.2.1.9 | bolt |
| Spalting | 7.2.1.7 | gruppe |
| Stålbrudd, skjær (med/uten momentarm) | 7.2.2.3 | bolt |
| Betongutstøting (pry-out) | 7.2.2.4 | gruppe |
| Kantbrudd | 7.2.2.5 | gruppe |
| Samvirkning strekk + skjær | 7.2.3 | kombinasjon |
| Forankringsarmering – stål og heft | 7.2.1.8 | gruppe (valgfri) |
| Kantarmering | 7.2.2.6 | gruppe (valgfri) |

I tillegg: kontakttrykk mot betongen mot `f_cd`, og inndatakontroll
(bolt utenfor betongdelen, `h_ef` mot tykkelse, minste kant-/senteravstand).

### Kraftfordeling

Stiv plate (EN 1992-4 pkt. 6.2), løst med Newton–Raphson på tre frihetsgrader
(`w`, `θx`, `θy`):

* boltene er strekk-kun fjærer, `k = E_s·A_s / h_ef`
* betongen under plata er en trykk-kun kontaktflate, diskretisert i celler
* står plata av fra betongen (`standoff > 0`) faller kontaktflaten bort, og
  boltene tar både strekk og trykk – skjær regnes da med momentarm

Skjær fordeles likt på boltene, torsjon `M_z` med polart treghetsmoment.

Likevekten er kontrollert numerisk: ΣF_z og ΣM treffer påført last eksakt.

## Kjøre lokalt

```bash
node dev-server.mjs 8124
```

Så åpne <http://localhost:8124>. Dev-serveren setter `Cache-Control: no-store`;
uten det cacher nettleseren ES-modulene hardt under utvikling.

Én-fils-versjon (samme verktøy, alt inline):

```bash
node build.mjs
```

## Filstruktur

```
src/core/model.js               datamodell, materialtabeller, boltgeometri
src/engine/geometry.js          arealunion (A_c,N, A_c,V)
src/engine/plate-solver.js      kraftfordeling i boltegruppa
src/engine/en1992-4.js          NS-EN 1992-4 – alle konstanter samlet i K
src/engine/anchor-reinforcement.js  forankringsarmering (7.2.1.8 / 7.2.2.6)
src/engine/b19.js               Betongelementboka B19 – TOM PLUGIN
src/engine/validate.js          inndatakontroll
src/engine/verify.js            orkestrering
src/viz/three-d-stage.js        <three-d-stage> web component
src/viz/scene-builder.js        bygger scenen fra modell + resultat
src/ui/fields.js                datadrevet skjemadefinisjon
src/ui/app.js                   applikasjonslag
```

### Legge til et regelverk

Skriv en modul som eksporterer `run<Navn>(model, res)` og returnerer

```js
{ standard, gamma, checks: [
  { id, mode, clause, scope, NRk, NRd, NEd, util, terms: [[navn, verdi, enhet]], note }
]}
```

Registrer den i `CODES` i `src/engine/verify.js`. UI, 3D og rapport følger
automatisk – ingenting annet må endres.

### Legge til et inndatafelt

Én linje i `src/ui/fields.js`, med hvilken fane feltet hører til. Skjemaet og
fanene bygges av den lista (`TABS` styrer rekkefølgen).

## Grensesnitt

Klassisk beregningsprogram-oppsett: verktøylinje øverst, tre ruter under,
statuslinje nederst.

| Rute | Innhold |
|---|---|
| Venstre | Gruppevelger (Regelverk, Betongdel, Forankringsplate, Bolter, Forankringsarmering) med sammendrag, og feltene for valgt gruppe |
| Midten | Fanene **3D** og **Utregning**, med dokket verktøylinje – ingenting flyter oppå visninga |
| Høyre | Kontrollene, alltid synlige, gruppert etter bruddform med tykke utnyttelsesstolper |
| Midten, nederst | Lastkombinasjonene, under visninga og avgrenset av venstre og høyre rute |

Knappen **Parallell** bytter mellom perspektiv og parallellprojeksjon
(ortografisk), der like store ting tegnes like store uansett avstand – nyttig
når mål skal sammenliknes direkte i bildet. Byttet regner om utsnittet så
modellen beholder samme synlige størrelse ved målpunktet, i stedet for å ramme
inn på nytt og kaste bort zoomen. Måling: to like lange 400 mm-strekk gir
249 og 148 px i perspektiv, og 181 px begge i parallell.

Rutene kan dras i størrelse, hver i **én** kant – den som vender inn mot
visninga: venstre rute i høyre kant, høyre rute i venstre, lastruta i overkant.
Størrelsene ligger i CSS-variabler (`--w-left`, `--w-right`, `--h-loads`), så
dragingen bare skriver et tall og resten følger av oppsettet; 3D-ruta
oppdaterer seg selv gjennom sin egen `ResizeObserver`. Håndtakene tåler også
piltaster, og dobbeltklikk nullstiller. Grensene er dynamiske: visninga får
alltid beholde minst 340 × 200 px.

### Lastkombinasjoner

Tabellen er hele grensesnittet for lastene: én rad pr. kombinasjon med eget
navn, grensetilstand og de seks komponentene. Radioknappen velger hvilken som
vises i 3D og regnes ut i kontrollruta.

Kombinasjonene **er** lastobjektene – `syncLoad()` lar `model.load` peke på den
aktive, så motoren og påskriftene i 3D trenger ikke vite at det finnes flere,
og redigering ett sted skriver rett inn i kombinasjonen.

Alle bruddgrensekombinasjonene regnes ut, ikke bare den aktive, så tabellen
viser hvilken som styrer. Bruksgrense registreres, men kontrolleres ikke –
NS-EN 1992-4 dekker bruddgrense.

Klikker du en kontroll, viser midtruta hele utregninga for den: inndata med
kilde, hvert mellomledd symbolsk og med tall satt inn, punkthenvisning til
standarden, kapasitet og utnyttelse. Resultatlista blir stående ved siden av.

3D-visningen bruker ekte materialfarger: grå betong med prosedyregenerert
korn og luftporer, matt konstruksjonsstål i plate og bolter, rustrød armering,
med myk kontaktskygge mot underlaget. Bruddlegemene er gjennomskinnelige.
Bryteren **Fargelegg utnyttelse** bytter boltene over til grønn/gul/rød.

Lastene vises som en aksetriade: én stiplet linje pr. akse ut fra platesenteret,
med kraft og moment for den aksen samlet ute ved enden. **x grønn, y rød,
z blå.** Kraft tegnes som skaft med kjegle, moment som bue rundt aksen etter
høyrehåndsregelen. Alle seks komponentene tegnes alltid – de uten last vises
bleknet og pekende i positiv retning, så triaden er komplett og
fortegnskonvensjonen er synlig. Alt er solid geometri, så det skyggelegges og
blir med i OBJ/GLB-eksporten.

### Målsetting og påskrifter

Uttrykket følger en arbeidstegning: tynne svarte hjelpelinjer, målelinje med
**fylte pilspisser**, og tallet uten enhet (enhetene står i statuslinja).

Tallet står **eksakt midt på** målelinja og løftes vinkelrett klar av den.
Avstanden regnes fra teksthøyden, ikke fra pilspissen – påskrifta er festet i
midten, så den må minst ut halve høyden sin før den slipper streken. Målt rett
ovenfra: sentrering innen ±0,3 px og ~8 px luft mellom tekst og strek.

Målene er gruppert etter hva de hører til. Betongdelen måles for seg ved
underkant. Plata og boltavstandene hører sammen og måles i platas plan: plata
innerst, og **boltkjeden** – platekant → bolt → bolt → platekant – like utenfor.
Segmentet mellom to bolter er senteravstanden og kan redigeres; kantsegmentene
er avledet og vises som tall, så det er tydelig hva du kan endre.

Målene er delt i to: **linjene** er geometri i modellen, mens **verdien** er et redigerbart
HTML-felt plassert med `CSS3DRenderer`. Feltet ligger i målets eget plan og
følger modellen i både rotasjon og størrelse, slik tekst på en arbeidstegning
gjør – og er likevel et skrivbart felt: skriv et nytt tall, og modellen
regnes om.

Tekst som ligger i et plan kan bli ulesbar på to måter, og `_faceLabels()` i
`three-d-stage.js` retter dem hver frame: **speilvendt** når kamera ser baksida
av planet (snus 180° om lokal Y), og **opp ned** når lesretninga peker mot
venstre på skjermen (snus 180° om lokal Z). En flat planmålsetting rammes bare
av den andre, en loddrett lastverdi som regel av den første.

Begge testene bygger på et fortegn som går gjennom null når planet eller
lesretninga står på kant mot kamera. Der vipper påskrifta fram og tilbake for
de minste kamerabevegelsene, så hver test er **hysteresebasert**: den slår om
ved ±BAND og husker tilstanden imellom. Målt på den verste vinkelen, der
marginen er 0,003: 200 rystelser på ±0,4° gir null vipp, og en full omdreining
gir 1,7 vipp per påskrift – som er minimum for å holde teksten lesbar.

Det gjelder både geometri (`concrete.Lx/Ly/h`, `plate.bx/by/t`,
`anchors.sx/sy/hef`) og laster (`V_x`, `V_y`, `N`, `M_x`, `M_y`, `M_z`).
Hver lastverdi står ved sin egen pil og i samme plan som den: kraften i planet
langs aksen, momentet i planet buen sveiper (vinkelrett på aksen). Bare tallet
og enheten vises; hvilken komponent det er, framgår av hvor verdien står.
Tall vises uten etterhengte nuller – 25 er «25», ikke «25,0» – men desimaler du
selv skriver blir stående.

Aksene i x og y føres forbi betongkanten, slik at pil og momentbue står fritt
utenfor klossen i stedet for å legge seg oppå den. Akselinjene er tynne svarte
stiplede streker uten tykkelse.
`buildScene()` returnerer `{ root, hud, hudScale }`, der hvert `hud`-element
har posisjon og orientering i verdensrommet; `stage.setLabels()` gjør dem om
til `CSS3DObject`-er.

3D-ruta har ingen bakke, himmel eller rutenett – bare den samme varme papir-
fargen som panelene. Retningen leses av modellen selv og av lasttriaden.

### Boltavstand og bolthode

Endrer du antall bolter, settes senteravstanden automatisk (`autoSpacing()` i
`src/core/model.js`): jevn deling innenfor plata, kantavstand i intervallet
30–50 mm, og verdien rundet til hele 5 mm. Skriver du en egen c/c etterpå, står
den – helt til du endrer antallet igjen. Legger du bolter utenfor plata
manuelt, sier inndatakontrollen fra.

Bolthodet følger samme mønster: `⌀_h` og `k` settes fra EN ISO 13918 når du
velger boltdiameter, men egne verdier står til diameteren endres. Hodearealet
styrer uttrekkskapasiteten, så det er en reell inndata – ikke bare geometri.

### Montasje og innfesting

`plate.mount` styrer hvordan plata står an mot betongen, og `mounting()` i
`src/core/model.js` gjør valget om til geometri og statikk:

| Valg | Trykkflate | Momentarm i boltene |
|---|---|---|
| Direkte mot betong | ja | 0 |
| Undergyting | ja | 0 når gytemassen er minst like fast som betongen og minst 30 N/mm², ellers `t_gyting + t/2` |
| Avstandsmontert | nei | `fri avstand + t/2` |

`anchors.attachment` velger mellom sveist og gjennomboltet. Sveist bolt slutter
ved platas underside og får sveisekrage; gjennomboltet går gjennom plata og får
skive og mutter, samt justeringsmutter under plata ved avstandsmontasje.
Sveiste bolter har ingen hullklaring, så alle tar skjær – da settes
`code.holeClearanceFilled` automatisk og feltet skjules.

Plate, bolter og armering males i den gjennomskinnelige passeringa med høyere
`renderOrder` enn betongen (`OVER_CONCRETE` i `scene-builder.js`). Uten det
blander betongen seg oppå stålet og vasker det ut; med det står stålet fram
som solide legemer gjennom betongen, samtidig som det dekker seg selv riktig.


## 3D-visning

`<three-d-stage>` er en web component på Three.js r0.184 (importmap fra
jsDelivr), med OrbitControls og eksport til OBJ/MTL og GLB.

```js
stage.setContent(object3d);
stage.frameAll();
stage.setView('iso' | 'top' | 'front' | 'side');
stage.exportOBJ('navn');   // .obj + .mtl med ekte usemtl-grupper
stage.exportGLB('navn');
```

Modellen bygges i **ingeniørkoordinater** (x, y i planet, z ut av betongen, mm)
og rotgruppa roteres −90° om X, slik at ingeniør-z blir Three sin Y.

Bruddlegemene tegnes geometrisk riktige: strekkjegla som en avkortet pyramide
fra hodenivå med 1,5·h_ef spredning, kantbruddet som en kile fra forreste
boltrad ut til kantflata, begge klippet mot betongdelens kanter – de er de
samme arealene som brukes i `A_c,N` og `A_c,V`.

## Status B19

`src/engine/b19.js` er en tom plugin. Grensesnittet og listen over forventede
kontroller ligger der, men **ingen formler er lagt inn, og ingen tall er
gjettet.** For å fylle den ut trengs, per kontroll: formel med alle faktorer,
gyldighetsområde, materialfaktorer og geometrigrenser fra boka.

## Forbehold

* **Konstantene i `K` (`src/engine/en1992-4.js`) må kontrolleres mot trykt
  utgave av NS-EN 1992-4 + norsk NA før verktøyet brukes i prosjektering.**
  De er samlet ett sted nettopp for at det skal være en overkommelig jobb.
* `c_cr,sp` for spalting er satt til 2·h_ef som en typisk verdi. Reell verdi
  hentes fra ETA/produktdata.
* Minste kant- og senteravstand (5·⌀) er veiledende, ikke normativ.
* Kantbrudd regnes for forreste boltrad med hele skjærkraften – konservativt
  når bakre bolter også bidrar.
* ψ_M,N (pkt. 7.2.1.4) er ikke tatt med; det er konservativt.
* Ett lasttilfelle om gangen. Lastkombinasjoner er ikke implementert.
