# aTV

TV prostředí ovládané ovladačem pro Samsung (Tizen), LG (webOS) a TCL (Android TV / Google TV),
s mobilem jako ovladačem, hlasovými příkazy a vlastní knihovnou filmů přes Jellyfin.

- **TV aplikace** (`src/`, Preact + TypeScript, build pro Chromium 47 = Samsung 2017+): domovská obrazovka
  podle denní doby, dlaždice (Telly, Disney+, Netflix, YouTube, Knihovna, Televize, Prohlížeč, Hledat,
  Nastavení), Jellyfin (Pokračovat, Další díly, Nově přidané, knihovny, detail, přehrávač s pokračováním
  a automatickým dalším dílem), IPTV z M3U, hledání napříč vším, prohlížeč se záložkami, spořič s fotkami,
  oznámení, časovač vypnutí, úprava domovské obrazovky.
- **Hub** (`hub/`, Node 24 bez buildu): servíruje TV aplikaci i mobilní ovladač, propojuje je přes WebSocket,
  ovládá Samsung po síti (tlačítka, spouštění aplikací, Wake-on-LAN), drží tajemství (Immich, Home Assistant,
  Claude) a vykonává příkazy.
- **Mobilní ovladač** (`/remote.html`): párování QR kódem, přepínání Tlačítka / Trackpad (trackpad ovládá
  kurzor televize, na Samsungu nativní, jinde kurzor aTV, nebo posouvá výběr), hlasitost, zapnutí/vypnutí TV,
  psaní na TV, příkazy hlasem nebo textem, časovač. Se Samsungem jdou tlačítka i kurzor přímo do televize,
  takže fungují i v Netflixu a v prohlížeči.
- **Filmy z torrentů** (dlaždice Filmy, výsledky v Hledat): vlastní katalog (magnet odkazy nebo .torrent URL
  přidané z mobilu, pro díla, ke kterým máte práva) a Internet Archive (volná díla, každá položka má torrent).
  Vyhledávání řazené podle relevance (název, popularita, hodnocení), filtr jazyka a titulků. Hub streamuje už
  během stahování (WebTorrent, přeskakování přes HTTP range), zjistí zvukové stopy přes ffprobe, převádí přes
  ffmpeg, když formát přehrávač neumí nebo je zvolená jiná zvuková stopa, a titulky SRT převádí na WebVTT
  (včetně Windows-1250). Nepoužívané torrenty po 2 hodinách maže i s daty (`data/torrents`).
- **Sdílená logika** (`shared/`): parser českých příkazů, M3U, prostorová navigace, Jellyfin stream, protokol (testy ve vitest).

## Spuštění v Dockeru (hub + Jellyfin)

```bash
npm install
npm run up        # docker compose s LAN adresami tohoto počítače
npm run seed      # jen pro test: založí Jellyfin (atv/atv), knihovny z ./media, Quick Connect
npm run smoke     # end-to-end test v headless Chrome s vlastním hubem na :8091 (vaši TV ani otevřená okna nezasáhne)
```

- TV aplikace: `http://<ip-počítače>:8090/`, ovladač: `http://<ip-počítače>:8090/remote.html`, Jellyfin: `:8096`
- Filmy a seriály: `MEDIA_DIR=/cesta/k/filmům npm run up` (výchozí `./media`, struktura `Filmy/`, `Seriály/`).
- Ovládání v prohlížeči: šipky, Enter = OK, Esc/Backspace = Zpět.

## Vývoj

```bash
npm run hub       # hub na :8090 (data v ./data)
npm run dev       # Vite na :5173, /api a /ws přesměruje na hub
npm run typecheck && npm test
```

## Konfigurace hubu

`data/config.json` (vzor `config.example.json`), proměnné prostředí mají přednost:

| Klíč | Proměnná | K čemu |
|---|---|---|
| `samsung.host`, `samsung.mac` | `SAMSUNG_HOST`, `SAMSUNG_MAC` | ovládání Samsungu po síti a Wake-on-LAN; první připojení je potřeba povolit na televizi |
| `jellyfinUrl` | `JELLYFIN_URL` | výchozí server v přihlášení |
| `iptv.playlist` | `IPTV_PLAYLIST` | M3U (URL nebo soubor v `data/`) |
| `immich.url`, `immich.apiKey`, `immich.albumId` | `IMMICH_URL`, `IMMICH_API_KEY` | fotky ve spořiči |
| `homeAssistant.url`, `.token`, `.scenes.playing/stopped` | `HA_URL`, `HA_TOKEN` | scény při přehrávání |
| `anthropicApiKey` | `ANTHROPIC_API_KEY` | příkazy, kterým pravidla nerozumí, převede Claude |
| `weather.lat/lon/name` | `WEATHER_LAT`… | počasí (Open-Meteo, bez klíče) |
| `publicUrl` | `HUB_PUBLIC_URL` | adresa pro QR kód (jinak podle připojení TV) |

**Oznámení** (např. zvonek z Home Assistantu): `POST /api/notify` s `Authorization: Bearer <notify token>`
(token je v `data/state.json` a v logu hubu), tělo `{"title": "Někdo zvoní", "text": "…", "image": "https://…"}`.
**Příkazy z automatizací** (Siri zkratky, HA): `POST /api/command` se stejným tokenem, tělo `{"text": "pusť Netflix"}`.

Příklady příkazů: „pusť Netflix“, „pusť Mandaloriana“, „přepni na ČT24“, „najdi Star Wars“, „otevři seznam.cz“,
„pauza“, „pokračuj“, „zesil o 5“, „vypni zvuk“, „zapni televizi“, „vypni za půl hodiny“, „zruš časovač“, „domů“.

## Nasazení na Samsung (Tizen)

1. Nainstalujte Tizen Studio (stačí CLI) a v Package Manageru doplňte **Samsung Certificate Extension**
   a **TV Extensions**.
2. Na televizi: Aplikace → na ovladači 1-2-3-4-5 → Developer mode **On**, Host PC IP = IP tohoto počítače → restart televize.
3. `~/tizen-studio/tools/sdb connect <ip-televize>:26101` a `sdb shell 0 getduid` (DUID televize).
4. Tizen Studio → Certificate Manager → **+** → Samsung → TV → profil `atv` (přihlášení Samsung účtem,
   do distributor certifikátu přidejte DUID televize).
5. `npm run up` (hub musí běžet) a `TV_IP=<ip-televize> npm run deploy:tizen`: build s adresou hubu,
   podpis, instalace a spuštění.
6. ID aplikací ověřte přes `sdb shell 0 applist` a opravte je v `shared/apps.ts` (označená `VERIFY`).

LG: `npm run build:webos`, `ares-package build/webos`, `ares-install`. TCL/Android: `npm run build:android`,
projekt v Android Studiu s `platforms/android/*` a obsahem `build/android` v `app/src/main/assets/www`.

## Omezení

- Netflix, Disney+, YouTube a Telly se spouštějí jako nativní aplikace televize. Jejich obsah nejde přehrát uvnitř aTV (DRM).
- Prohlížeč aTV zobrazuje stránky z Chromia na hubu a přenáší obraz bez zvuku; bez Chromia nabídne vestavěný prohlížeč televize.
- Hlas přímo v prohlížeči mobilu funguje jen přes HTTPS. Přes HTTP v místní síti použijte diktování na klávesnici.
- Wake-on-LAN z Dockeru na Macu nedojde do sítě; pro zapínání televize spusťte hub přímo (`npm start`).

## Herci a filmografie

Dlaždice **Herci** a tlačítko ve **Filmech** otevřou hledání herců. Profil ukazuje
filmy s obaly, rokem a rolí, řaditelné od nejnovějších nebo nejstarších. Film
z TMDB otevře hledání jeho původního názvu a roku v aTV; dostupnost přehrávání
závisí na výsledcích hledání. Na hlavní stránce se zobrazí také řádek herců.

Pro úplnou filmovou databázi přidejte vlastní TMDB API klíč (v3) nebo API Read
Access Token do `data/config.json` jako `"tmdbApiKey": "…"`, případně nastavte
`TMDB_API_KEY`, a restartujte hub (`npm run up -- hub`). Klíč zůstává na hubu.
Získáte ho v [nastavení účtu TMDB](https://www.themoviedb.org/settings/api).
Bez klíče se použije přihlášená knihovna Jellyfin: její herci a pouze filmy v ní.
Obsazení v detailu filmu Jellyfinu vede na stejný profil. Bez obou zdrojů obrazovka
vysvětlí, co je potřeba připojit. Seriálové role tato filmografie nezahrnuje.

`npm run import:actors` načte redakční výběr **100 známých herců** (80 zahraničních
a 20 českých/slovenských) ze `shared/actor-selection.ts`. U každého ověří filmovou
roli za posledních 30 let, stáhne jeho filmografii včetně rolí a odkazů na obaly a
uloží ji do `data/actors-library.json`. Filmografie obsahují i starší filmy daného
herce; období vymezuje výběr osob. Jde o výběr, ne objektivní žebříček popularity.
Import nepřepisuje dosavadní výběr, dokud nemá všech 100 různých profilů.

Po importu restartujte hub (`npm run up -- hub`). Výchozí přehled pak nabízí
uložený výběr po 20 hercích na stránku; hledání podle jména nadále prohledává
celou TMDB. Metadata vybraných herců fungují i bez nového dotazu na TMDB,
fotografie a obaly se načítají z jejího obrazového serveru. Pro aktualizaci
filmografií spusťte import znovu. Importuje se katalog filmů, nikoliv videosoubory.

## Přehrávání a stahování torrentů

Torrenty se stahují jen na hub (`data/torrents`), televize přehrává běžný stream z hubu.

- **Při přehrávání** hub sleduje, kde přehrávač čte, a vždy nejdřív stahuje **10 minut filmu od
  tohoto místa** (okno se posouvá s přehráváním i při přetočení). Zbytek souboru se dotahuje na
  pozadí s nižší prioritou, takže stahování nestojí, ani když přehrávač zrovna nic nečte.
- **Před spuštěním** se čeká na zásobu (60 s dopředu, nebo méně, když stahování jasně stíhá),
  obrazovka ukazuje postup a nabízí **Přehrát hned**. Pokračování od uložené pozice připravuje
  zásobu od ní.
- **⬇ Stáhnout do Knihovny** (detail filmu) stáhne vybraný soubor celý, i s titulky stejného
  jména, a zkopíruje ho do `media/Filmy/Název (rok)/` (v Dockeru `MEDIA_DIR`, mimo Docker
  `libraryDir`/`ATV_LIBRARY`), kde ho najde Jellyfin. Průběh je v detailu a v **Archivní filmy →
  Stahování do Knihovny**; rozpracovaná stahování pokračují i po restartu hubu.
- Knihovnu pak obnoví hub, pokud má `JELLYFIN_API_KEY` (Jellyfin → Ovládací panel → Klíče API),
  jinak televize přihlášená do Jellyfinu jako správce. Data torrentu se smažou po 2 h nečinnosti.

## Pokračovat ve sledování

Hlavní stránka spojuje rozkoukané položky Jellyfinu s torrenty a ostatními videi
přehrávanými přímo v aTV. Karta ukazuje obal, uložený čas a průběh; výběr naváže
na uloženou pozici včetně zvoleného zvuku a titulků. Torrent se před pokračováním
znovu otevře, takže může pokračovat i po restartu hubu.

Historie aTV se ukládá na daném zařízení do localStorage každých 10 sekund,
při pauze a odchodu. Uchovává posledních 50 videí sledovaných alespoň 5 sekund;
dokončená videa (nebo alespoň 95 % délky) se odstraní. Živé vysílání se neukládá.
Starší přehrávání před zavedením historie nelze zpětně doplnit. Jellyfin nadále
ukládá svou historii na serveru; samostatné aplikace Netflix a Disney+ ji aTV nesdílejí.

## Veřejné torrent indexy

Hledání automaticky prohledává také API Bay a Torrents CSV. Výsledky ukazují index,
velikost a počet seedů; stejné infohashe se sloučí. Vyberte výsledek, počkejte na
načtení souborů a stop a zvolte **Přehrát**. Hub streamuje přes stávající WebTorrent
přehrávač s podporou přetáčení a překódování přes ffmpeg.

Indexy se dotazují souběžně s osmivteřinovým limitem, výsledky se ukládají na minutu.
Výpadek jednoho indexu neblokuje ostatní zdroje. Dostupnost přehrávání závisí na peerech;
počet seedů z indexu může být zastaralý. Jazyky veřejných výsledků se odhadují z názvu,
titulky se ověří až po otevření torrentu; filtr „Jen s titulky“ proto tyto výsledky
před ověřením nezahrnuje. Vyhledávání nic nestahuje; připojení k torrentu začne otevřením detailu.

## Jackett: SkTorrent, YTS, 1337x, The Pirate Bay a TheRARBG

```bash
docker compose --profile torrents up -d jackett flaresolverr
```

Otevřete `http://localhost:9117`, přidejte indexery **Sk-CzTorrent**, **YTS**, **1337x**,
**The Pirate Bay** a **TheRARBG**. Sk-CzTorrent vyžaduje váš účet; přihlášení nastavte
přímo v Jackettu. Ostatní indexery jsou veřejné. Dostupnost závisí na konkrétním webu;
Pro 1337x je připravená služba FlareSolverr; v nastavení Jackettu zadejte
FlareSolverr API URL `http://flaresolverr:8191`. Služba nemá veřejně vystavený port.
TheRARBG je samostatný web inspirovaný RARBG, nikoli původní služba RARBG.

Do `data/config.json` přidejte (API Key najdete nahoře v Jackettu):

```json
{
  "jackett": {
    "url": "http://jackett:9117",
    "apiKey": "API klíč z Jackettu"
  }
}
```

Při spuštění hubu mimo Docker použijte `http://localhost:9117`. Alternativně nastavte
`JACKETT_URL` a `JACKETT_API_KEY`. Seznam zdrojů se přebírá přímo z nakonfigurovaných
indexerů Jackettu přes jeho `t=indexers&configured=true` API. Staré lokální
`indexer`/`indexers` a proměnné `JACKETT_INDEXER(S)` už výběr neomezují.
Přidání a odebrání zdroje se provádí v Jackettu bez restartu aTV. Seznam má cache
30 sekund; již probíhající nebo opakovaný dotaz může používat výsledky až dvě minuty.
Read-only `/api/media/providers` ukazuje převzaté zdroje a jejich podporu filmového hledání.

Hub hledá souběžně pouze filmy a seriály (Torznab 2000/5000). Zdroje bez těchto
kategorií se pro filmové hledání nepoužijí. Při připojeném Jackettu se API Bay
a Torrents CSV nepřidávají zvlášť; bez Jackettu zůstávají záložními veřejnými zdroji.
Internet Archive a vlastní knihovna jsou samostatné katalogy. aTV zobrazuje výsledky průběžně a ukazuje,
na které zdroje ještě čeká a které nejsou dostupné. 1337x má limit 60 sekund kvůli
Cloudflare ověření, ostatní Jackett indexery 20 sekund. Opakované dotazy sdílejí
stejné hledání po dobu dvou minut.
Nefunkční indexer neblokuje výsledky ostatních. API klíč a autentizované torrentové
odkazy zůstávají na serveru; zachovávají se v `data/jackett-sources.json` i přes restart.
Do TV se posílá neprůhledné ID. Stejné známé infohashe se ve výsledcích sloučí.
Jazyky vycházejí z metadat indexeru a názvu; skutečné zvukové stopy se ověří v detailu.

## Prohlížeč uvnitř aTV

Při otevření aTV v běžném prohlížeči lze do polí hledání a obrazovkové klávesnice
psát přímo, vybírat text a používat ⌘C/⌘V (macOS), Ctrl+C/Ctrl+V nebo kontextovou
nabídku. Vložení při neaktivním poli nahradí text aktuálního hledání/klávesnice.
Na televizích zůstává ovládání přes obrazovkovou klávesnici a ovladač.

Dlaždice **Prohlížeč** otevírá stránky přímo v aTV. V Dockeru je Chromium součástí
hubu; při místním spuštění se použije nainstalovaný Chrome, případně `CHROME_PATH`.
Lišta umožňuje zadat adresu, vracet se, obnovovat stránku, psát a spravovat záložky.
Na stránce šipky pohybují kurzorem, OK kliká a u horního/dolního okraje se roluje.
Zpět prochází historii stránky a pak vrací ovládání do lišty. Funguje i myš a mobilní trackpad;
text lze zadávat z mobilu nebo přes **Psát**. Přihlašovací relace zůstávají
v `data/browser-profile`. Všichni diváci sdílejí jednu stránku.

**Se zvukem** (tlačítko v liště, jen hub v Dockeru): Chromium běží na virtuální obrazovce (Xvfb)
se virtuální zvukovou kartou (PulseAudio) a ffmpeg je nahrává jako živý HLS stream
(`/api/browser/av/live.m3u8`). Televize pak ukazuje video se zvukem se zpožděním kolem 1–3 s;
klikání a psaní dál míří přímo do stránky. Zachytávání běží jen při sledování (vypne se 30 s
po posledním požadavku) a vytíží zhruba jedno jádro CPU. Obsah s DRM (Netflix apod.) nehraje.

**Ovládání z mobilu nebo počítače**: záložka **Web** v ovladači (`/remote.html`) ukazuje
stejnou stránku živě. Klepnutí kliká, tažení roluje, nahoře je adresa, zpět/vpřed a psaní do
stránky. **Na televizi** otevře adresu v prohlížeči aTV na televizi (stejně jako příkaz
„otevři …“).

Pozor: prohlížeč na hubu nemá vlastní přihlášení, vidí ho každý v místní síti, kdo otevře aTV.
Nepřihlašujte se v něm k citlivým účtům. Google navíc přihlášení z prohlížečů ovládaných
programem často odmítá.

## Virtuální myš

**Nastavení → Ovládání → Virtuální myš**: *jen v prohlížeči* (výchozí), *všude* nebo
*vypnuto*. Šipky ovladače hýbou kurzorem (při držení zrychluje), OK kliká; ve „všude“ šipka
na okraji obrazovky posune obsah, přehrávač a galerie si šipky ponechávají. Bez myši se
v prohlížeči ◀ ▶ přeskakuje po odkazech (Tab), ▲ ▼ roluje a OK otevírá.

## iVysílání

Dlaždice **iVysílání** (a skupina v **Hledat**) používá veřejné API České televize: živé kanály
ČT1, ČT2, ČT24, ČT sport, ČT :D, ČT art a ČT3, hledání pořadů a dílů a seznam dílů pořadu.
Hub vždy vyžádá stream bez DRM a přesměruje přehrávač na čerstvou adresu (tokeny vyprší);
pořady jen s DRM ukážou hlášku, že je v aTV přehrát nejde. Skryté titulky jsou v přehrávači
vypnuté a zapínají se šipkou ▼. Archiv se pamatuje v „Pokračovat ve sledování“.

`npm run smoke:browser` ověřuje obrazovku přes oddělený hub a místní testovací web,
včetně klikání, českého textu, historie, rolování a záložek; na konci vypíše cestu
ke screenshotům. Již nasazený hub lze otestovat přes
`ATV_BROWSER_TEST_HUB=http://localhost:8090 node scripts/browser-smoke.mjs`
(v tom případě se použije jeho sdílená stránka prohlížeče; testovací web musí být
z kontejneru dostupný přes `host.docker.internal`).

## Klávesnice a návrhy slov

Klávesnice používá QWERTZ bez diakritiky. Klávesy ◀ ▶ posouvají kurzor v textu; psaní i **Smazat znak** pracují na jeho místě. Přepínač **ÁČĚ · Diakritika** zobrazí
háčky a čárky nad písmeny, **123 / #+** přepne čísla a symboly. Nad klávesami se
nabízejí doplnění posledního slova, včetně diakritiky a slov z výsledků hledání.
Vybraný návrh zachová předchozí text a přidá mezeru. Návrhy se počítají místně;
u hesel se nezobrazují. Při přerušení spojení s hubem nabízí detail filmu tlačítko
**Zkusit znovu**.

Výsledky hledání se řadí nejprve podle shody názvu (bez technických značek vydání),
potom podle dostupnosti a počtu seedů. Popularita nepřebije přesnější shodu ani
neposune pokračování před přesně hledaný film. Počty zhlédnutí z Internet Archive
se nesrovnávají s počtem seedů. Hledání českým názvem zatím automaticky nepřekládá
názvy do originálu; u zahraničních indexů může být potřeba původní název.

Pokud indexer poskytne plakát, aTV ho zobrazí ve výsledcích i v detailu. Obrázky
z Jackettu procházejí přes hub (`/api/media/<id>/poster`); API klíč ani interní
adresa Jackettu se neposílají klientovi. Chybějící nebo nedostupný obrázek nahradí
název filmu.

### Audio and individual torrent sources

Home → **Torrentové zdroje** opens a search restricted to the selected configured movie/audio indexer. **Archivní filmy** is the former Films tile; its catalog and Internet Archive contents are unchanged.

**Audio** searches Jackett's audio category (3000) across configured audio-capable indexers, including AudioBook Bay. Open a result to list tracks/chapters in natural filename order. MP3, M4A/M4B and WAV play directly; other supported audio formats use the hub's FFmpeg MP3 stream. Choose a track to play it; Back returns to the track list. Playback progress uses the existing continue-watching history. Playback is of individual tracks, not an automatic album queue.

Artwork prefers `cover.jpg`, `folder.jpg`, `front.jpg` (also PNG/JPEG) inside the torrent; otherwise the indexer's poster or a best-effort MusicBrainz/Cover Art Archive lookup is used. Missing artwork does not prevent playback. MusicBrainz requests are serialized and cached in memory. Covers are not guaranteed for every edition or single. Adult-only categories remain excluded.

### Musicians

Home → **Muzikanti** and the **300 známých muzikantů** row expose a curated cross-generation selection of 300 solo artists and bands, including 60 Czech/Slovak names. This is an editorial selection, not an objective popularity ranking. Profiles contain artist photos, the releases listed in Deezer's catalogue (albums, singles and EPs), release dates, cover art and up to ten top tracks. Selecting a release or track opens Audio search; metadata availability does not imply a playable torrent is available.

Run `npm run import:musicians` to populate `data/musicians-library.json`, then restart the hub. Public Deezer metadata requires no additional API key. The importer resolves exact names, selects the most-followed matching artist, rejects ambiguous matches, follows album pagination and checkpoints each completed profile in `data/musicians-import/`. It only replaces the live library when all 300 unique profiles have photos and releases. Remove a profile's checkpoint to refresh that artist's data before re-running the import. Images remain hosted by Deezer; catalogue coverage and different editions can vary.

### Art gallery

Home → **Umělci · Galerie** browses a curated selection of public-domain artworks from Wikimedia Commons. Artist cards and details include portraits from Wikipedia / Wikimedia Commons. Open an artist, then a work or **Spustit galerii**. Images retain their proportions; black margins are intentional for differently shaped works.

Gallery controls: Left/Right changes works, OK pauses/resumes, Up/Down opens settings, Back closes settings or exits. The display interval cycles through 5/15/30 seconds, 1/5/15 minutes, 1 hour and indefinite. The interval persists per device. Countdown starts after the image loads; settings and pause suspend it. HUD hides after four seconds and the aTV screensaver does not interrupt the gallery. Failed images show a recoverable message. Images and portraits are fetched and cached by the hub for older TVs.

Run `npm run import:art`, then restart the hub. Import includes only image records with a matching artist and an explicit Public domain license. Artist portraits use Wikipedia's page image. This is a selected collection, not a complete catalogue. Source: https://commons.wikimedia.org/ .

### Expanded libraries

`npm run expand:actors` preserves the original 100 profiles and adds 300 distinct verified actors from `shared/actor-expansion.ts`, for 400 total. It checkpoints filmographies and only replaces the library once all 400 are available. The original seed import refuses to shrink an expanded library.

`npm run import:art` selects 100 artists with a portrait and at least one matching public-domain work from `shared/art-selection.ts`. Wikipedia portraits are queried in batches and Commons metadata is cached; API retry limits are respected. The existing art library is replaced atomically only after all 100 are verified. Artist browsing is paginated. Gallery changes retain the previous image during loading and fade the new image in over 800 ms; loading is shown only before the first image. Reduced-motion preferences shorten the fade.
