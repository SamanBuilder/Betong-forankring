# Betong forankring

3D-prosjekteringsverktøy for forankring i betong. Prototype.

Ikke bundet til ett produkt: regelverket ligger i utbyttbare moduler, og
geometri/laster settes fritt.

## Hva prototypen dekker

**Forbindelsestype:** rektangulært boltemønster i en betongdel med inntil fire
frie kanter, med eller uten forankringsplate i overflata.

| Valg | Alternativer |
|---|---|
| Stangtype | sveisebolt · gjengestang/bolt · kamstål |
| Forankringsende | endemutter/bolthode · felles endeplate over gruppa · uten endemutter (heftforankring) |
| Innfesting | stålplate, sveist eller gjennomboltet · uten plate (enkeltstående dybler) |

**Regelverk:** NS-EN 1992-4:2018 og Betongelementboka bind B kap. B19 er begge
implementert. De dekker delvis ulike ting:

| | EN 1992-4 | B19 |
|---|---|---|
| Forankring med fot | ja | ja |
| Uten endemutter (heft) | **nei** | ja, pkt. 19.3.3 / 19.3.4 |
| Enkeltstående dybel uten plate | delvis (som avstandsmontert) | ja, pkt. 19.4.2 |
| Forankringsarmering | ja, tillegg C | nei (stavmodell, ikke lagt inn) |

Velger du «uten endemutter» under EN 1992-4, faller strekkontrollene bort med
en melding om å bytte regelverk – standarden har ingen heftmodell.

### Kontroller som kjøres – NS-EN 1992-4

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

Kontrollene som forutsetter en fot (uttrekk, betongkjegle, utblåsing, spalting,
pry-out) hoppes over når forankringen ikke har endemutter.

### Kontroller som kjøres – Betongelementboka B19

| Kontroll | Pkt. i B19 | Nivå |
|---|---|---|
| Stålbrudd, strekk | 19.5 / 19.7.1 | bolt |
| Utrivning – kjeglebrudd | 19.3.2 | gruppe |
| Utrivning – heftforankring | 19.3.3 (kamstål) / 19.3.4 (gjengestang) | bolt |
| Trykk mot forankringsfot | 19.3.2.4 | bolt |
| Stålbrudd, skjær | 19.5 | bolt |
| Stålbrudd, bøyning av dybel | 19.4.2.2 | bolt |
| Dybelskjær i betong | 19.4.2.3 (uten plate) / 19.4.4 (med plate) | gruppe |
| Samvirkning stål | 19.6 | kombinasjon |
| Samvirkning betong | 19.6 | kombinasjon |
| Samvirkning stål og betong | 19.6 | kombinasjon |

I tillegg: kontakttrykk mot betongen mot `f_cd`, og inndatakontroll
(bolt utenfor betongdelen, `h_ef` mot tykkelse, minste kant-/senteravstand,
fotens stivhet, gyldighetsområdet til B19).

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
src/engine/b19.js               Betongelementboka B19 – alle konstanter i KB
test/b19-examples.mjs           regner om bokas egne eksempler
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

### Stangtype, stålkvalitet og forankringsende

Stangtypen er hovedvalget, og den styrer resten. Stålkvalitet, diameter og
forankringsende er ikke frie valg ved siden av den, men lister som filtreres
på typen – så kombinasjoner som ikke finnes, kan heller ikke velges.

| Stangtype | Stålkvaliteter | Forankringsende |
|---|---|---|
| Sveisebolt (hodebolt) | SD1, S235J2, S355J2 | påsmidd bolthode |
| Gjengestang / bolt | K4.6, K4.8, K5.6, K8.8, K10.9 | endemutter · felles endeplate · uten (heft) |
| Kamstål | B500NC | sveist endemutter · endekrok · uten (heft) |

**Sveisebolt vs. gjengestang/bolt** er ikke et sveist/ikke-sveist-skille –
begge kan i praksis sveises eller boltes til plata (se «Innfesting til
plate» under). Forskjellen er produksjonsmåten på selve stanga: en sveisebolt
har et **påsmidd**, rundt hode uten gjenger noe sted (EN ISO 13918 – en
«Nelson-bolt»), mens gjengestang/bolt er gjenget og tar en **påskrudd**
sekskantmutter. De er derfor **én** type i modellen, ikke to – samme
gjengede skaft, spenningsareal `A_sp` og skruekvalitetene K4.6–K10.9.

Kamstål er hverken gjenget som en bolt eller påsmidd som en sveisebolt: det
har kammer langs hele stanga og er ikke gjenget opp for en mutter. En
endemutter må derfor **sveises** på i stedet for skrus på, og feltet heter
«Sveist endemutter» for å vise det. Alternativt bøyes enden til en
**endekrok**. Ingen av delene er kvantifisert utover den vanlige
heftformelen (se under) – kroken gir ingen kapasitetsbonus i beregningen,
bare et alternativ til rett stang. Kamstål gjenges heller ikke opp for
platefeste og har derfor ingen felles endeplate.

Reglene ligger i `STUD_STEELS[].bars` og `END_TYPES` i `src/core/model.js`, og
`sync()` i `src/ui/app.js` retter opp en ugyldig kombinasjon – også når den
kommer fra ei prosjektfil lagra før reglene ble strammet inn.

I 3D skilles kamstål visuelt fra de andre stangtypene: lysbrun valsehud
(`MAT.rebarAnchor` i `src/viz/scene-builder.js`) og kammer langs hele stanga,
tegnet som småringer med jevne mellomrom (`rebarRibs()`) – ikke det virkelige
valsemønsteret, bare nok til at stanga leses som kamstål og ikke glatt
rundstål. Endekroken (`rebarHook()`) er en halvsirkel med en rett hale, samme
prinsipp som en 180°-krok på en arbeidstegning – en tegneskikk, ikke en
dimensjonert detalj.

### Felles endeplate

Endeplata er **én** plate som knytter hele boltegruppa sammen nede i
innstøpingsenden – ikke en skive pr. bolt. Den følger boltemønsteret med et
utstikk `u_p` utenfor de ytterste boltene, så inndata er utstikket og
sidekanten er avledet; plata kan da aldri bli mindre enn gruppa den binder.

Det har to konsekvenser for beregningen:

* **Bruddkjegla** går fra platekanten og ikke fra hver bolt for seg – hele
  gruppa river ut ett sammenhengende legeme. `A_c,N` regnes derfor av
  plateomrisset utvidet med 1,5·h_ef (`coneProjection()` i
  `src/engine/geometry.js`, brukt av både EN 1992-4 og B19). Det gir større
  kapasitet enn løse bolter, og er hele poenget med detaljen.
* **Trykkflata** krever at plata er stiv: utstikket kan ikke være større enn
  tykkelsen, så bare et felt `⌀ + 2·t_p` rundt hver bolt regnes med
  (B19 fig. B 19.18). Ligger boltene tett, flyter feltene sammen, og unionen
  telles én gang og deles på antall bolter. Er plata ikke fullt medvirkende,
  sier inndatakontrollen fra med hvor mye av den som regnes.

### Glatt skaft og gjenget del

En bolt er sjelden gjenget helt opp: skaftet er glatt fra hodet, og gjengene
begynner et stykke nede. Feltet **Glatt skaft** (bare for gjengestang/bolt)
sier hvor langt ned fra betongoverflata det glatte skaftet går. 0 betyr
gjenget hele veien.

Det er ikke bare tegning – snittet er ikke det samme de to stedene, og
`shaftProps()` i `src/core/model.js` skiller derfor mellom dem:

| | Tverrsnitt | Hvorfor |
|---|---|---|
| Strekk | `A_s = A_sp` | bruddet går i gjengene uansett hvor de sitter |
| Skjær | `A_v = π⌀²/4` når skaftet er glatt ved overflata | skjærsnittet ligger i betongoverflata, og der er det glatte skaftet grovere enn gjengene |
| Heft | `l_b = h_ef − l_glatt` | glatt stål har verken kammer eller gjenger å hefte mot |

Det trekker i hver sin retning, og det er poenget: et glatt skaft **svekker**
heftforankringen og **styrker** skjærkapasiteten. For M20 K8.8 med 300 mm
innstøpt lengde og 100 mm glatt skaft faller heftkapasiteten fra 63,8 til
42,5 kN, mens skjærkapasiteten stiger fra 51,4 til 66,0 kN (EN 1992-4).
Strekkapasiteten står stille på 71,5 kN.

Er hele den innstøpte lengda glatt, finnes det ingen gjenger i betongen, og
inndatakontrollen stopper det. Er bare en del glatt og forankringen er uten
endemutter, sier den fra hvor mye heftlengde som faktisk er igjen.

Gjengene tegnes i 3D som ei skruelinje lagt utenpå skaftet – ekte geometri med
riktig stigning etter ISO 261, ikke tekstur, så de skyggelegges og blir med i
OBJ/GLB-eksporten. De tegnes bare der stanga faktisk er gjenget, slik at
bildet og tallene forteller det samme. Er plata gjennomboltet, får toppen
gjenger til mutteren selv om skaftet under er glatt.

### Boltavstand og bolthode

Endrer du antall bolter, settes senteravstanden automatisk (`autoSpacing()` i
`src/core/model.js`): jevn deling innenfor plata, kantavstand i intervallet
30–50 mm, og verdien rundet til hele 5 mm. Skriver du en egen c/c etterpå, står
den – helt til du endrer antallet igjen. Legger du bolter utenfor plata
manuelt, sier inndatakontrollen fra.

Forankringsfoten følger samme mønster: `⌀_h` og `k` settes fra EN ISO 13918
(sveisebolt) eller muttertabellen i B19 (gjengestang) når du velger diameter,
men egne verdier står til diameteren endres. Fotarealet styrer uttrekks- og
fottrykkskapasiteten, så det er en reell inndata – ikke bare geometri.

Stangtypen bestemmer hvilke diametre som finnes: hodebolter ⌀10–⌀25
(EN ISO 13918), kamstål ⌀8–⌀32, gjengestang M10–M42 med spenningsareal og
ekvivalent diameter fra tab. B 19.7.1. Bytter du stangtype, flyttes valget til
nærmeste dimensjon i den nye tabellen.

### Montasje og innfesting

`plate.present` og `plate.mount` styrer hvordan forbindelsen står an mot
betongen, og `mounting()` i `src/core/model.js` gjør valget om til geometri og
statikk:

| Valg | Trykkflate | Momentarm i boltene |
|---|---|---|
| Uten plate | nei | utkraging `e` |
| Direkte mot betong | ja | 0 |
| Undergyting | ja | 0 når gytemassen er minst like fast som betongen og minst 30 N/mm², ellers `t_gyting + t/2` |
| Avstandsmontert | nei | `fri avstand + t/2` |

`anchors.attachment` velger mellom sveist og gjennomboltet. Sveist bolt slutter
ved platas underside og får sveisekrage; gjennomboltet går gjennom plata og får
skive og mutter, samt justeringsmutter under plata ved avstandsmontasje.
Sveiste bolter har ingen hullklaring, så alle tar skjær – da settes
`code.holeClearanceFilled` automatisk og feltet skjules. Uten plate finnes
ingen hull i det hele tatt, og feltet faller bort.

Uten plate faller også platemålene bort i 3D-visninga; boltkjeden måles da mot
boltgruppas egen ytterkant, og utkraginga `e` får sitt eget mål.

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

## Betongelementboka B19

`src/engine/b19.js` er skrevet etter utgaven som ligger åpent på
<https://betongelementboka.betong.no/betongapp/BindB/Del_3/B19/>. Alle
tallkonstanter ligger samlet i `KB`, med punkthenvisning.

En viktig forskjell mot EN 1992-4: **B19 gir dimensjonerende verdier direkte** –
materialfaktorene ligger inne i k-faktorene (`k_1 = 11,9/γ_c`), i stedet for
karakteristiske verdier som deles på γ_M etterpå.

### Endemutter, endeplate eller ingenting

`anchors.endType` styrer hvilken strekkmodell som gjelder:

| Valg | Strekkmodell | Fotens geometri |
|---|---|---|
| Endemutter / bolthode | kjeglebrudd, 19.3.2 | rundt hode `π·⌀_h²/4`, eller sekskantmutter `0,866·NV²` |
| Felles endeplate over gruppa | kjeglebrudd fra platekanten, 19.3.2 | union av `(⌀ + 2·t_p)` innenfor plata, delt på antall bolter |
| Uten endemutter | heftforankring, 19.3.3 / 19.3.4 | ingen |

Endeplata er altså samme virkemåte som endemutteren, bare med annen geometri
for netto trykkareal `A_h` og for kjegla. Begrensningen `b_eff` kommer av at
foten må være stiv: utstikket `u` kan ikke være større enn tykkelsen `t`
(fig. B 19.18 og B 19.57).

Heftkapasiteten er bokas lengdeformel snudd:

```
f_bd  = 2,25 · f_ctd   (kamstål)      f_ctd = 0,85 · f_ctk,0,05 / γ_c
f_bd  = 1,90 · f_ctd   (gjengestang)
α_2   = 1 − 0,15 · (R/⌀ − 1,5),  0,7 ≤ α_2 ≤ 1,0,  R = min(a ; s/2)
N_Rd,b = π · ⌀ · l_b · f_bd / Πα
```

`f_bd` er *nedre* grense for heftfasthet – den gjelder ved minste tillatte
overdekning – så god overdekning senker `Πα` og hever kapasiteten.

**Kjeglemodellen forutsetter ingen heft langs stanga** (pkt. 19.3.1.2). En lang
gjengestang med endemutter og liten kantavstand kan derfor få *mindre*
kapasitet etter kjeglemodellen enn samme stang uten endemutter etter
heftmodellen. Boka sier uttrykkelig at man skal bruke den modellen som gir
størst forankringskapasitet, så kontrollen `N-conc` regner begge når det er
fot, og viser hvilken som ble styrende.

### Med og uten stålplate

`plate.present` skiller de to skjærmodellene. Uten plate skaller betongen foran
stanga av; med plate holdes den på plass, og strekket som oppstår i
forankringen gir et friksjonsbidrag (fig. B 19.26):

| Innfesting | `V⁰_Rd,c` | Pkt. |
|---|---|---|
| Dybel uten stålplate | `1,0 · ⌀² · √(f_cd · f_sd)` | 19.4.2.3 |
| Innstøpt plate, påsveiste forankringer | `1,8 · ⌀² · √(f_cd · f_sd)` | 19.4.4 |
| Påskrudd plate | `1,5 · ⌀² · √(f_cd · f_sd)` | 19.4.4 |

Deretter reduseres kapasiteten med `k_a` (kantavstand i kraftretninga),
`k_s` (bruddflatas bredde på tvers) og `Ψ_f,V` (bakre boltrekker).

Den andre forskjellen er stålets bøyning. Uten plate står stanga fritt over
betongen, og maksimalmomentet blir `M = V · (e + 0,75·⌀)` – kontrollen
`V-bend`. Med en plate som ligger an mot betongen faller den bort, fordi
bøyningen er dekket av forhøyelsesfaktoren over.

### Kontroll mot boka

```bash
node test/b19-examples.mjs
```

Regner om beregningseksemplene og kapasitetstabellene i kapitlet – k₁ for
B30–B55, forankringslengder for gjengestang M10–M42 med og uten endemutter,
trykk mot endemutter, dybelskjær for kamstål ⌀8–⌀32, og det fullstendige
eksempelet B 19.4.2 med innstøpt plate og fire forankringer. 25 av 25 stemmer.

## Forbehold

* **Konstantene i `K` (`src/engine/en1992-4.js`) må kontrolleres mot trykt
  utgave av NS-EN 1992-4 + norsk NA før verktøyet brukes i prosjektering.**
  De er samlet ett sted nettopp for at det skal være en overkommelig jobb.
* Det samme gjelder `KB` i `src/engine/b19.js` mot trykt utgave av
  Betongelementboka. Testene over dekker tallene boka selv viser fram, ikke
  hele kapitlet.
* B19 gir formler og tabeller for **B25–B55**. Utenfor det området er
  `f_ck,cube` ekstrapolert, og inndatakontrollen sier fra.
* B19 pkt. 19.4.3 (CEN/TS-metoden for kantbrudd) er ikke lagt inn som egen
  kontroll – den er i praksis den samme modellen som EN 1992-4 pkt. 7.2.2.5,
  som allerede kjøres under det regelverket. B19-modulen bruker den forenklede
  metoden i 19.4.4, som er den bokas kapasitetstabeller bygger på.
* Forankringsarmering er bare implementert etter EN 1992-4 tillegg C. B19
  dimensjonerer tilsvarende armering med stavmodell (19.3.2.6 og 19.4.3.5) –
  den er ikke lagt inn.
* Spenningsarealer og nøkkelvidder for gjengestang er tab. B 19.7.1 i boka,
  altså M10–M42.
* `c_cr,sp` for spalting er satt til 2·h_ef som en typisk verdi. Reell verdi
  hentes fra ETA/produktdata.
* Minste kant- og senteravstand (5·⌀) er veiledende, ikke normativ.
* Kantbrudd regnes for forreste boltrad med hele skjærkraften – konservativt
  når bakre bolter også bidrar.
* ψ_M,N (pkt. 7.2.1.4) er ikke tatt med; det er konservativt.
* Ett lasttilfelle om gangen. Lastkombinasjoner er ikke implementert.
