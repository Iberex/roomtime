# Roomtime

Drie woonkamers op één draaideur: de jaren '70, '80 en '90, elk een diorama dat ik in Blender heb gemodelleerd en gebakken, gerenderd in de browser met three.js en de **WebGPURenderer**. Draai de deur rond en je stapt een decennium verder. Op de tv's draait een Shadertoy-shader die ik naar WebGPU heb geport.

**Online:** https://iberex.github.io/roomtime/ (een browser met WebGPU nodig, bv. Chrome of Edge)

## Originele shader

**Glitchy Glitch** door piyushslayer: https://www.shadertoy.com/view/wld3WN

De port staat in [`src/shaders/glitch.wgsl`](src/shaders/glitch.wgsl): zoals in de les is de GLSL-code omgezet naar WGSL (`vec3` → `vec3f`, `float` → `f32`, `mod` → `%`, `atan` → `atan2`, de `#define`s worden constanten en functies). [`src/shaders/glitch.js`](src/shaders/glitch.js) maakt er met `wgslFn` een node van en geeft `iTime`, `iFrame`, `iResolution` en de interactie door als uniforms; `iChannel0` wordt twee keer doorgegeven, als texture en als sampler.

Wat er veranderd is tegenover het origineel:

- `iChannel0` was een video van Shadertoy. Hier start de tv op een testbeeld (`public/textures/testbeeld.png`); elke klik zapt in chronologische volgorde langs vier uitzendingen in `public/video/`: Apollo 13 (1970), ABBA op Eurovisie (1974), Queen met Bohemian Rhapsody (1975) en de UEFA-bekerfinale Club Brugge – Liverpool (1976), en daarna terug naar het testbeeld. Beide bronnen worden elke frame in een 4:3 render target getekend, dat de input van de glitch-shader is.
- `smoothstep(b, a, x)` met omgekeerde randen is in WGSL niet gedefinieerd. Daarom staat er `1 - smoothstep(a, b, x)`.
- De shader rendert zoals op Shadertoy op een eigen canvas (640×480 render target), dat met mipmaps verkleind op het tv-scherm komt. Zo blijven ruis en scanlines in verhouding tot het beeld, zoals in het origineel.
- De shader draait niet fullscreen maar op de UV's van het tv-scherm uit Blender.

### De lucht achter het raam (jaren '80)

**2D Clouds** door drift: https://www.shadertoy.com/view/4tdSWr

Een blauwe daglucht met traag drijvende wolken, op dezelfde manier geport: [`src/shaders/sky.wgsl`](src/shaders/sky.wgsl) en [`src/shaders/sky.js`](src/shaders/sky.js). `fragCoord / iResolution` wordt de positie op het luchtvlak (de UV's ervan liggen gedraaid), `iTime` komt uit de loop in `main.js`. De helpers kregen een `sky`-voorvoegsel zodat ze niet botsen met de rest van de gegenereerde WGSL.

## Interactie

- **Muis op de beeldbuis**: werkt als een magneet tegen een CRT. Het beeld buigt af en verkleurt rond de cursor, en het effect wordt sterker hoe langer je blijft staan.
- **Klik op het scherm**: zapt naar de volgende zender, met een korte glitch-burst.
- **Antennes** (zilveren konijnenoren op de tv): pak een spriet vast en sleep ze omhoog of omlaag ([`src/antennas.js`](src/antennas.js)). In de beginstand staan ze goed voor alle zenders; verzet je een spriet, dan krijg je ruis. Hoe slechter ze staan, hoe meer sneeuw, spookbeeld en kleurverlies in de shader (uniform `snow` in [`glitch.wgsl`](src/shaders/glitch.wgsl)), bij heel slechte ontvangst rolt het beeld, en het geluid zakt weg in de ruis. Vasthouden helpt een beetje, zoals vroeger. De tv van de jaren '80 heeft dezelfde antennes (bovenop de kast, ze vallen mee binnen) met hetzelfde gedrag: ze staan bij het laden goed en je kunt ze ook omhoog en omlaag slepen.
- **Geluid**: de eerste klik zet het geluid aan. Onder het testbeeld klinkt een testtoon van 1 kHz, bij de uitzendingen hun eigen geluid. Alles loopt door een Web Audio-keten die een tv uit de jaren '70 nabootst ([`src/audio/tvAudio.js`](src/audio/tvAudio.js)): mono, een klein luidsprekertje (200 Hz–5 kHz), buizenvervorming, compressie, 50 Hz-brom en ruis die meeglitcht met het beeld. Andere decennia krijgen hetzelfde systeem met een ander profiel.
- **Stekkers**: trek de stekker van de lamp of de tv uit het stopcontact (vastpakken en wegslepen). De kabel is een live touw met zwaartekracht, de stekker valt op de grond en het licht of de tv valt uit. Pak hem weer op en wijs met je muis naar het stopcontact: een magneet trekt hem er vanzelf in.
- **Lichtschakelaar** aan de muur: het kamerlicht. Uit = de hele kamer wordt donker, alleen de staande lamp en de tv geven nog licht. **Knopje op de lamp**: schakelt de staande lamp (die brandt als haar stekker erin zit en het knopje aan staat).
- **Knoppen op de tv**: de kanaalknop zapt per klik een zender verder en draait mee, de volumeknop zet het geluid in vijf standen (of scroll erboven).
- **Afstandsbediening**: vastpakken (ze hangt en draait mee rond het punt waar je ze vastneemt) en rondgooien, ook van het diorama af. Valt ze van de map, dan ligt ze even later terug op de zetel.
- **Oog** rechtsboven de tv: inzoomen op het scherm (Esc of nog eens klikken om terug te gaan).

Physics: [Rapier](https://rapier.rs) (`src/interactions.js`). De kamer is een vaste trimesh-collider, vloer en muur zijn massieve blokken; de losse objecten zijn convex hulls.

## Blender

- Model: `room.blend`, alleen het diorama (objecten `d70_*`). De camera in three.js is de camera uit Blender.
- **Baking**: [`blender/build_assets.py`](blender/build_assets.py) past de modifiers toe, maakt een lightmap-UV over het hele diorama en bakt met Cycles het volledige beeld (kleur × direct en indirect licht + emissie, zonder glans). Het licht van de staande lamp zit in een aparte laag (`baked_lamp.webp`), zodat kamerlicht en lamp los van elkaar aan en uit kunnen: kleur = basis × kamerlicht + lamp × lamplicht. De losse objecten (afstandsbediening, stekkers) hebben een eigen lightmap (`baked_los*.webp`) en werpen in de kamer-bake geen schaduw, zodat er niets achterblijft als je ze verplaatst. De kabels worden niet gebakken: het zijn live touwen. Zo komt elk Blender-materiaal, ook procedurele node-setups, exact op de site. In three.js komt alleen de kijkhoek-afhankelijke glans er live bij, via een reflectieprobe van de kamer zelf.

```bash
blender -b room.blend --python blender/build_assets.py -- . 768 4096
```

## Decennia: het draaitoneel

Met de pijlen links en rechts kies je het decennium (of met de pijltjestoetsen ← →): links het vorige, rechts het volgende, in de volgorde '70 → '80 → '90. Aan het begin en het einde van de rij is er geen pijl. De jaren '80 staan rug aan rug achter de muur van de jaren '70: wisselen draait het hele diorama 180° rond een verticale as midden tussen de twee muren, zoals een draaideur. Naar de jaren '90 draait de deur nog een halve slag verder: dan staan op de voorkant de jaren '90, op de plek van de jaren '70 (die zijn dan toch uit beeld), even groot en op dezelfde plek in beeld als de andere kamers. Technisch draait de camera de andere kant op, wat er hetzelfde uitziet, zodat de physics van de kamers gewoon blijft staan. Kamers die niet in beeld kunnen komen, zijn verborgen: de jaren '90 staan op dezelfde plek als de jaren '70. De achtergrond fadet mee: oranje voor de jaren '70, neon roze en paars voor de jaren '80, turkoois en diepblauw voor de jaren '90. Elke kamer heeft zijn eigen oogjes en zijn eigen geluid: wat achter de muur staat, zwijgt.

De jaren '90 ([`src/room90.js`](src/room90.js)) komen uit Blender, net als de jaren '80: [`blender/build_room90.py`](blender/build_room90.py) houdt enkel `d90_diorama` over, bakt per materiaal een kleurtexture en één lightmap (halogeen-uplighter, plafondkaatsing, vullicht; geen daglicht, er is geen raam) en exporteert `public/models/kamer90.glb`, `baked90.webp` en `baked90_emit.webp`. In de render verborgen objecten (de oude zelfgebouwde tv) gaan niet mee. De poster is een shader: "Genuary #15: Design a rug" door Flopine ([shadertoy.com/view/MXtfz8](https://www.shadertoy.com/view/MXtfz8), CC BY-NC-SA 3.0, [`src/shaders/rug.wgsl`](src/shaders/rug.wgsl)), in jaren-90-kleuren; met de muis erover draaien de tegels weg, klikken geeft een nieuw patroon. Het tapijt is "Wigglestrips" door cacheflowe ([shadertoy.com/view/lsjBRD](https://www.shadertoy.com/view/lsjBRD), CC BY-NC-SA 3.0, [`src/shaders/wiggle.wgsl`](src/shaders/wiggle.wgsl)), in de kleuren uit Blender; met de muis erover rimpelen de strepen, klikken geeft een golfstoot. Er is geen lichtschakelaar meer: het grote licht (het vullicht) blijft uit, de kamer krijgt haar licht van de lampen. Het dimmerschuifje op de stang van de halogeen-uplighter zet die lamp aan en uit, met haar kaatsing op het plafond (een aparte bake, `baked90_lamp.webp`). De wijzers van de wandklok lopen op de echte tijd. De staande lamp hangt met een kabel aan het stopcontact ernaast (zoals de tv's in de jaren '70 en '80): trek de stekker eruit en ze gaat uit. De glazen deurtjes van het tv-meubel zwaaien open met een klik; klik op de PlayStation of de controller en ze gaan in het kastje (bovenop de videobanden), nog een klik zet ze terug.

- **Controller met physics** ([`src/gamepad90.js`](src/gamepad90.js)): sleep de controller en hij is een Rapier-object aan een live kabel (verlet-touw) naar de PlayStation. Hij volgt het oppervlak waar je muis naar wijst, valt, stuit en blijft liggen, nooit verder dan zijn kabel lang is. Sleep hem door het glas het kastje in en laat los: hij gaat op zijn plek en de kabel ligt opgerold.
- **Cd-toren**: klik op een losse cd op de vloer (Aqua, Metallica, Pearl Jam, Spice Girls) en hij schuift in een vrij vakje van de toren; nog een klik legt hem terug. De gebakken schaduw onder de cd verdwijnt mee ([`src/dropShadow.js`](src/dropShadow.js)).
- **Lavalamp** ([`src/lavalamp90.js`](src/lavalamp90.js)): echte bewegende was, een veld van metaballen (`MarchingCubes`). Het lampje warmt de was onderaan op, warme was stijgt, koelt boven af en zakt terug. Klik op de lamp om ze uit of aan te zetten. De meubels vallen binnen zoals in de andere kamers, met hun schaduw pas op de vloer als ze geland zijn. Op de Sony Trinitron draait dezelfde Glitchy Glitch als in de andere kamers; klik op het scherm om te zappen: het testbeeld, dan FC De Kampioenen ("Crisis", 1990), Milk Inc. – "La Vache" (1997), de begrafenis van prinses Diana (1997) en het VRT-journaal van 1 januari 2000 (fragmenten van ± 5 minuten). De Trinitron heeft een scherper en rustiger beeld dan de oudere toestellen: minder ruis en storing in de glitch-shader (`clean`) en een beeld van 960 × 720. Bouwen: `blender -b ~/Downloads/room.blend --python blender/build_room90.py -- . 128 2048 GPU` (CPU als Metal ermee stopt).

In de jaren '80 ([`src/room80.js`](src/room80.js)):

- **De tv** gebruikt dezelfde Glitchy Glitch-shader als de jaren '70 (de tv-code zit in [`src/tv.js`](src/tv.js), één keer per toestel aangemaakt). Klik op het scherm om te zappen: testbeeld, De Smurfen (1981), U2 op Live Aid (1985), de overval in Aalst door de Bende van Nijvel (1985) en de val van de Berlijnse muur (1989). Het geluid heeft een eigen profiel (`PROFILE_80`): voller en helderder dan het buizentoestel van de jaren '70. Het scherm is een licht bol vlak in de opening van de kast.
- **De radio en de cassettes**: pak een cassette van de salontafel en sleep hem naar de radio. Wijs je naar het cassettevak, dan klapt het klepje open; laat los en de cassette richt zich rechtop, schuift erin en speelt: a-ha – *Take On Me*, Michael Jackson – *Billie Jean* of TC Matic – *Oh La La La* (`public/audio/take-on-me.m4a`, `billie-jean.m4a`, `oh-la-la-la.m4a`). Ontbreekt een van die bestanden, dan speelt die cassette een synthpop-mixtape die live met een `OfflineAudioContext` gerenderd wordt. De cassettes zijn zelf opgenomen bandjes: een stukje schilderstape met de titel in alcoholstift (texturen in `blender/etiketten/`) en een doorzichtig venstertje waardoor je het bandje ziet. Dat venster heeft een materiaal waarvan de naam met `Glass` begint, zodat het op de site doorzichtig getekend wordt. Klik op het vak om uit te werpen, of pak de cassette vast en trek ze eruit; klik op de kast of de toetsen om te pauzeren. Het geluid ([`src/audio/radioAudio.js`](src/audio/radioAudio.js)) heeft bas-boost, taperuis en *wow & flutter* (de toonhoogte zwiept licht, zoals een bandje).
- **Tv-kabel** (jaren '80, [`src/cable80.js`](src/cable80.js)): de tv hangt met een kabel aan het stopcontact ernaast, zoals in de jaren '70: trek de stekker eruit en de tv valt uit, breng hem terug en een magneet klikt hem erin. Het oog bij het stopcontact zoomt erop in. Het tweede stopcontact (achter de zetel) is weg.
- **Lichtschakelaar** (jaren '80): zelfde tuimelschakelaar als in de jaren '70. Uit = het kamerlicht valt weg en ook het daglicht zakt naar avondlicht; met de gordijnen dicht wordt het nog donkerder.
- **Kaders aan de muur** ([`src/frames.js`](src/frames.js)): zes ingelijste echte foto's uit de jaren '80 (de drie met `_pd` in de naam zijn public domain, van Wikimedia Commons). Klik op een kader en het schommelt aan zijn spijkertje; trek het verder weg en het komt los. Los is het een Rapier-object, net als de afstandsbediening in de jaren '70: het hangt scheef onder je muis en tolt verder als je het gooit. Valt het van het diorama, dan hangt het even later terug. Ophangen: elk vrij spijkertje heeft een oranje ringetje op het behang, dat pulseert zolang je een kader vasthebt. Kom je met het kader in de buurt, dan trekt een magneet het er met physics naartoe (zoals de stekkers in de jaren '70): het draait recht vóór de muur, schuift ertegen en haakt in. Dat gebeurt ook als je het in de magneet loslaat. Elk kader past op elke vrije nagel, zo kun je ze herschikken. Overlapt het een kader dat er al hangt, dan komt het er net voor. De spijkertjes en de achterkant (hardboard) komen er in three bij. In Blender zijn de kaders losse objecten: ze werpen geen schaduw in de bake, zodat er geen afdruk op de muur achterblijft als je ze weghaalt. De kaders zelf maakt [`blender/add_kadertjes.py`](blender/add_kadertjes.py); de foto's vullen de opening zonder uit te rekken.
- **Geluid per kamer**: enkel de kamer die vooraan staat is hoorbaar; de jaren '80 pas als de draai klaar is.
- **Oogjes** bij de tv, de zetel, de radio en het raam.

Je kunt de **gordijnen** dichtdoen: vastpakken en over de rail slepen, of kort klikken voor helemaal open of dicht ([`src/curtains.js`](src/curtains.js)). Elk gordijn is een massa-veersysteem: de stof schiet even door en de zoom onderaan zwiept na, uitgetrokken worden de plooien vlakker. Het daglicht door het raam is een aparte bake (`baked80_dag.webp`): hoe meer het raam bedekt is, hoe donkerder de kamer.

De meubels van de jaren '80 komen van BlenderKit: de zetel (*Sofa 03*), de salontafel (*Coffee Table Vintage*), de radiocassettespeler (*Radio 80's*), het tv-meubel (*Wood Tall Tv Stand*) en de tv (*Television 02*). De zetel staat schuin naar de tv, de tv schuin naar voren zodat je het hele scherm ziet. Het bake-script zet eerst de schaal van elk object in zijn mesh: BlenderKit-modellen staan vaak op een kleine schaal (een cassette op 0,04), waardoor ze anders het grootste deel van de lightmap opeisen en muren en vloer amper pixels krijgen. Daarnaast vereenvoudigt het onzichtbare details met absurd veel driehoeken, bakt het metaal als gewone kleur (zonder glans zou het zwart worden) en tekent het doorzichtige objecten (het raam) live doorzichtig.
`room_draaitoneel.blend` is room.blend met de kamers opgesteld zoals op de site (rug aan rug, met een tweede camera `Camera_80`): [`blender/make_turntable_blend.py`](blender/make_turntable_blend.py).

De kamer uit de jaren '80 (in `room.blend`: `d70_diorama.001` met de `d80_*`-objecten) wordt apart gebakken:

```bash
blender -b ~/Downloads/room.blend --python blender/build_room80.py -- . 512 2048
```

Stopt Metal halverwege met `Command buffer not completed`, zet dan `CPU` als vierde argument: trager, maar het lukt altijd.

Kleur en licht zijn apart gebakken: elk materiaal krijgt een eigen kleurtexture (tot 2048 px, in de GLB), het licht zit in een gedeelde lightmap (`baked80.webp`, `baked80_dag.webp`, `baked80_emit.webp`). In three is de kleur `texture × lightmap`. Zo blijft de stof van de zetel scherp als je inzoomt, waar één gedeelde bake voor de hele kamer hem maar een paar honderd pixels gaf.

## Draaien

```bash
npm install
npm run dev      # lokaal
npm run build    # productie-build in dist/
npm run deploy   # bouwen en dist/ naar de gh-pages-branch pushen (GitHub Pages)
```
