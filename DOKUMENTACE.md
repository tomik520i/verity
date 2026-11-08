# Verity – technická dokumentace
Stav implementace: 8. listopadu 2026.

**[Spustit živou Verity na opicebot.cz/verity](https://opicebot.cz/verity/)** · [Mapa posloupnosti](README.md#mapa-fungování)

Přesné modely, kvantizace a verze služeb: [Modely a technologie](docs/MODELY-A-TECHNOLOGIE.md).

## Architektura

Prohlížeč zobrazuje SVG postavu a ovládá hlasový rozhovor. Node server zprostředkovává Gemmu přes llama.cpp, syntézu OmniVoice, přepis Whisper a samostatný Python vyhledávač. LLM, STT a TTS jsou externí služby se svou instalací, modelem a GPU. Testovaná LLM varianta: Gemma 4 26B A4B, kvantizace Q5_K_S; server používá její kompatibilní chat API.

| Soubor | Úloha |
| --- | --- |
| server.js | API, streamování, kontrola hledání, paměť, proxy hlasových služeb |
| prompt.js | Osobnost, fáze, pravidla formátu a kontext posledního tahu |
| research.js | Výslovný záměr hledat, dotaz, zpracování a kontrola výsledků |
| memory-prompts.js | Extrakce a shrnutí osobních faktů |
| public/app.js | Stav hovoru, přepis, TTS fronta, ovládání a lokální data |
| public/live-audio.js | Mikrofon, segmenty řeči, průběžný a finální Whisper přepis |
| public/pcm-worklet.js | Nativní PCM a převzorkování |
| public/dialogue.js | Ukončování tahů po pauze, přerušení odpovědi |
| public/vad.js, vad-worker.js | Silero a ONNX Runtime mimo hlavní vlákno |
| public/echo-output.js | Lokální WebRTC cesta výstupu pro AEC |
| public/voice-preferences.mjs | Jednorázová migrace hlasového presetu a ověření AEC |
| public/conversation-mode.mjs | Výslovná volba roleplay / normálního rozhovoru |
| public/memory-core.mjs | Ověření důkazu, expirace, konflikty a výběr paměti |
| public/activity.js | Stav práce pro rozhraní |
| public/face.js, photo.js | Animace a práce s fotografií |

## Mikrofon a přepis

Mikrofon se nikdy nezapíná načtením stránky. Kliknutí vytvoří AudioContext a vyžádá getUserMedia. Vstup používá nativní frekvenci zařízení; nežádá vynucených 16 kHz. Automatické zesilování a potlačení šumu jsou vypnuté. AEC se žádá pouze v AEC režimu.

AudioWorklet převádí PCM na 16 kHz průběžným filtrem, včetně návaznosti bloků a antialiasingu. Převzorkování a přenos vzorků nečekají na výpočet Silera. Silero se načítá dopředu ve workeru; VAD spojuje neuronovou pravděpodobnost, uživatelský práh dBFS a časové podmínky.

Přepis se posílá po částech přes API a zobrazuje se v rozepsané zprávě i stručně pod postavou. Průběžný výsledek může Whisper změnit. Na hlavní obrazovce jsou současně dva označené řádky Verity / Ty: celá právě přehrávaná odpověď a rozepsaná nebo poslední odeslaná lidská zpráva. Text po odeslání ani po vypnutí mikrofonu nemizí. Delší výměnu lze v řádku posunout; úplná historie zůstává v panelu Přepis. Odeslání do LLM čeká na finální přepis aktuálního tahu; neodesílá každé částečné slovo zvlášť.

Průběžný režim po ukončení hovoru ani po návratu do záložky nespouští automatické monology. Starší režim si původní reakce na nečinnost zachovává.

Průběžný hovor používá jeden otevřený mikrofon. Pauza je přibližně 1,05 s po koncové interpunkci, 1,4 s obecně a 2 s při zjevně nedokončené větě. Klient potlačuje dvojí odeslání, čeká na finální STT a hlídá změnu generace při ukončení. Pozdě dokončené oprávnění mikrofonu po zrušení vede k okamžitému uvolnění zařízení.

Starší režim nahrává jednotlivou zprávu, maximálně 90 s; automatické odeslání používá pauzu 2,2 s. Navazující starší konverzační režim znovu otevírá mikrofon po odpovědi a při nečinnosti jej zavírá. V průběžném režimu jsou tyto dvě starší volby neaktivní.

## Test citlivosti v nastavení

Otevření nastavení přeruší odpověď, zastaví běžný hovor a zapne místní test mikrofonu. Kalibrace je nahoře: ukazuje vstup v dBFS, pravděpodobnost řeči ze Silera, posuvný práh a zelené označení řeči, která by prošla. Změna prahu platí okamžitě. Při vypnutém Silero se používá hlasitostní detektor.

Režim monitorOnly v live-audio.js vrací výsledek po VAD měření, před bufferováním zvuku, segmentací a plánováním STT. Také pump, publish a finish mají samostatnou blokaci. Diagnostika je vynuceně vypnutá, takže test neposílá audio do Whisperu ani Verity a neukládá WAV. Načíst se mohou pouze místní modelové/runtime soubory prohlížeče.

Zavření nastavení, přechod do chatu/paměti nebo skrytí stránky test zruší a uvolní mikrofon. Po třech minutách se vypne i s otevřeným nastavením; lze ho znovu spustit. Hovor se po testu sám neobnovuje. Kontrola generace zavře i stream z pozdě uděleného oprávnění a ignoruje staré callbacky.

## Ozvěna a přerušení

AEC není frekvenční vyříznutí hlasu. Prohlížeč dostává výstupní referenci přes místní WebRTC smyčku a u mikrofonu se žádá echoCancellation. Smyčka nepoužívá STUN/TURN ani externího příjemce. Kvalita jejího účinku není zaručena samotným potvrzením nastavení.

- **AEC:** mikrofon poslouchá i při řeči. Dostatečně dlouhá detekce lidské řeči přeruší výstup a starý požadavek.
- **Sluchátka:** stejná možnost přerušení bez AEC filtrů.
- **Střídání:** při přehrávání a 900 ms po něm se vstup blokuje. Vynuluje se také pre-roll a zahodí se pozdní přepis potlačeného úseku.

Selhání spuštění AEC nebo nepotvrzené echoCancellation automaticky přepne na střídání. Rozpojení již běžící smyčky přepne režim a zastaví hovor se srozumitelnou zprávou; další kliknutí mikrofon otevře ve střídání. Pokud konkrétní telefon potvrzuje AEC, ale ozvěna přetrvává, lze střídání zvolit ručně.

## Odpověď a animace

Chat server vrací SSE události s textem, přemýšlením, hledáním a zdroji. Klient čte stream přes ReadableStream.getReader(), také kvůli kompatibilitě mobilních prohlížečů. Parser rozděluje text na mluvené segmenty a odstraňuje řídicí značky emocí a posunu.

Segmenty se syntetizují předem a přehrávají v pořadí. Přerušení ruší LLM, požadavky TTS i zvukovou frontu. Do historie přerušené odpovědi se zapisují dokončené vyslovené věty, nikoli to, co zaznít nestihlo. AnalyserNode řídí otevírání úst. Emoce ovlivňují výraz a parametry syntézy.

V živém hovoru režim přemýšlení „automaticky“ upřednostňuje rychlou odpověď. Volba „vždy“ zůstává dostupná, ale může výrazně prodloužit čekání.

## API a externí služby

| Cesta | Účel |
| --- | --- |
| GET api/status | Dostupnost LLM, STT, TTS a stav GPU |
| POST api/chat | Zprávy, paměť, stav, images (až 10 data URL); odpověď SSE |
| POST api/memory | Návrh ověřených změn paměti z lidské zprávy |
| POST api/summarize | Kompakce paměti s validací |
| POST api/tts | Text, emoce a intenzita → WAV |
| POST api/stt | WAV → český přepis |
| POST api/consolidate | Sloučení ověřené paměti |

Konkrétní payload a směrování proxy jsou v server.js. Whisper služba musí podporovat rozhraní očekávané proxy; samotná instalace knihovny Whisper nestačí. Adresy a klíče se nastavují v config.json a stt.key. Hlasový klon vyžaduje odpovídající referenční WAV a přesný přepis. Tyto soubory nejsou distribuovány.

## Fotky

Galerie podporuje hromadný výběr až 10 obrázků; další výběr sadu doplní. Výběry se zpracovávají postupně ve frontě, aby zachovaly pořadí. Při přípravě nelze zprávu předčasně odeslat. Náhledy lze odebírat jednotlivě nebo všechny. Obrázky z galerie, schránky a přetažení mají stejnou cestu. Kamera přidá jednu fotografii do existující sady. API zachovává starší pole image, nové používá images. Limity a způsob předání modelu jsou v inventáři modelů výše.

## Hledání

Právo hledat určuje aktuální výslovná lidská zpráva. Starý pokyn v historii, zmínka o hrách, stížnost na hledání ani klientský příznak toto právo nedávají. Kontrola je na serveru, ne pouze v promptu.

Server odděluje plánování dotazu a zpracování výsledků od osobnosti. Zachytí nevyžádanou značku modelu, zahodí její předehru a omezeně zopakuje běžnou odpověď bez webu. Výsledky mají kontrolu úplnosti, počtu a ukončení generování. Selhání se hlásí jako selhání, ne jako dokončený seznam. Syntetické testy tyto cesty ověřují bez skutečného internetového hledání.

## Paměť a soukromí

Paměť v2 používá klíče, text, typ, původ, čas vytvoření/změny, expiraci a doslovný důkaz z lidské zprávy. Změna stejného klíče nahrazuje starou; zrušení plánu nemusí přidávat nový fakt. Starší asynchronní výsledek nepřepíše novější opravu ani ruční smazání.

| Typ | Platnost |
| --- | --- |
| Identita a ruční fakt | Do změny / smazání |
| Preference | 180 dní |
| Aktuální situace | 90 dní |
| Plán | 7 dní, případně datum + den, nejvýše 30 dní |
| Dočasný stav | 24 hodin |
| Ověřený archiv | 30 dní, nejvýše 12 položek |

Nejvýše 60 aktivních položek, do promptu výběr nejvýše 24. Expirace se pouhým načtením neobnovuje. Citace, hypotézy a roleplay nejsou osobní skutečnosti. Asistentovy značky pamatuj/zapomeň se ignorují. Migrace staré paměti vytváří místní zálohu; starý deník se nepovažuje automaticky za ověřený.

Běžný provoz ukládá historii a nastavení v prohlížeči, nikoli zvukové WAV. Serverové provozní logy obsahují identifikátor požadavku a stavy, ne plný přepis konverzace. Server odmítá diagnostický parametr source=1 a nepředává do Whisperu požadavek na ukládání ani ze starých otevřených stránek. Nasazovatel řeší vlastní informační povinnosti podle skutečného provozu; tato implementace sama není potvrzením právní shody.

## Nasazení a obnova

Před změnou zálohuj existující zdroje a soukromou konfiguraci odděleně. Nezveřejňuj config.json, stt.key, osobní exporty ani hlasové reference. Při aktualizaci dodrž konzistentní dvojici serveru a public modulů; index s novou verzí cache publikuj až po ostatních souborech.

Po restartu ověř API status, hlavní obrazovku, otevření nastavení a textovou zprávu. Pro návrat obnov soubory ze stejné zálohy a restartuj server. Lokální testy digitálního signálu neověřují akustiku fyzického telefonu; reálný hlasitý reproduktor vyžaduje zkoušku na zařízení.

## Ověření

Spustitelné regresní testy jsou v tests/. Pokrývají převzorkování 16/32/44,1/48/96 kHz, hranice audio bloků, rušení, návrat po výpadku workeru, citlivost Silera, blokování ozvěny, tahy rozhovoru, jednorázovou migraci, paměť a serverovou kontrolu hledání. Roleplay testy a jejich omezení jsou v docs/ROLEPLAY.md.

## Postava, fáze a rozhraní pro uživatele

Verity je neoficiální adaptace žluté postavy ze série Something od ThatMob. Projekt převádí motiv zdánlivě milé pomocnice a postupně neklidné přítomnosti do prohlížeče. Ženský rod, hlas a konkrétní ovládání jsou úpravy tohoto projektu. Zdroje k předloze a rozbor promptů jsou v [ROLEPLAY.md](docs/ROLEPLAY.md); popis implementace není tvrzení, že každý její detail pochází z původního díla.

| Motiv | Implementace |
| --- | --- |
| Zářící žlutý smajlík | SVG koule, radiální gradient, záře, plynulé dýchání a vznášení |
| Postupná změna výrazu | Nestabilita 0–100 ovlivňuje úsměv, zuby, oči, třes a barevnost |
| Pamatuje si předchozí rozhovory | Ověřená paměť v2 a místní historie; žádné domýšlení osobních faktů z roleplay |
| Všímá si přítomnosti | Čas, návraty, opuštění záložky, stav mikrofonu, hrubý odhad ruchu a GPU telemetrie |
| Naslouchá člověku | Face.listening a Face.hear, přepis a přerušení řeči |
| Atmosféra místo obtěžování | V živém hovoru se nespouští monology při tichu ani blokace odchodu ze stránky |
| Možnost vystoupit z role | Výslovné „mluv normálně“ se uchová; horor lze znovu zapnout v nastavení |

| Nestabilita | Fáze | Zamýšlený tón |
| --- | --- | --- |
| 0 až méně než 25 | Zářící | Milá, hravá, nápomocná |
| 25 až méně než 50 | Přilnavá | Větší zájem a neklid |
| 50 až méně než 75 | Majetnická | Sladkost střídá chlad a znepokojivý výraz |
| 75–100 | Rozpadající se | Roztříštěný projev a výraznější deformace obličeje |

Jde o pravidla roleplay promptu, ne o záruku konkrétní repliky. Krizová situace a výslovné přání běžné odpovědi mají přednost před hraním postavy. Automatické testy hodnotí odděleně formát, chování a latenci; jejich úspěch není zárukou libovolného rozhovoru.

## Protokol značek a sestavení promptu

Model vrací text se značkami, které se nečtou nahlas.

| Značka | Úloha a kontrola |
| --- | --- |
| [emoce:intenzita], např. [amused:65] | 29 výrazů v public/emotions.json; intenzita 20–100. Starý formát [happy] stále funguje. Změna ukončí segment. |
| [mood:warm] | Dlouhodobější nálada: warm, playful, focused, tender, uneasy, gloomy, eerie. Nečte se nahlas. |
| [posun:N] | Změna nestability, omezená aplikací; u výsledků hledání se výstup normalizuje na posun 0 |
| [hledat: dotaz] | Zachytí server. Bez aktuálního oprávnění hledat se příslib i značka zahodí a následuje omezená oprava běžné odpovědi |
| [pamatuj: ...], [zapomeň: ...] | Starý protokol; dnes se ignoruje a nesmí měnit paměť |
| [[UDÁLOST]] | Událost vytvořená aplikací, ne osobní výrok člověka. Nelze z ní získat nové osobní fakty |
| [[KONTEXT]] | Serverový kontext posledního tahu: čas, fáze, hlas, přerušení a právo hledat |
| [[FOTKA]] | Značka přiloženého obrázku v textové historii; skutečná obrazová data jdou jen s aktuálním požadavkem |
| [přerušeno] | Označení nedokončené asistentovy odpovědi v historii |

Příklad současného výstupu:

```text
[happy] Jsem tady. [curious] Co mi chceš ukázat? [posun:0]
```

Pořadí promptu: system se statickou osobností a vybranou ověřenou pamětí → pracovní historie → poslední uživatelská zpráva s aktuálním kontextem. Při obrázcích tvoří poslední zprávu obsahové části image_url následované textem. Údaje o čase a právě probíhající interakci se nepřidávají na začátek celého promptu.

llama.cpp může využít KV cache jen pro shodný prefix. Paměť a historie jej mění méně často než hodiny či úroveň nestability. Historické měření původního nasazení uvádělo přibližně 150 s pro studený prompt 120k tokenů a 3,5 s s cachovaným prefixem; jde o staré měření, nikoli aktuální benchmark Gemmy. U sdíleného jediného slotu může požadavek jiné aplikace výhodu cache změnit.

Příklad konfigurace používá temperature 0.7, top_p 0.95, presence_penalty 0.4, základní max_tokens 320, history_limit 200 a thinking auto. Režim auto v živém hovoru vypíná reasoning kvůli latenci; mimo hovor rozhoduje podle obsahu. Vyhledávání a opravy odpovědí mají vlastní vyšší, omezený rozpočet. Extrakce paměti a výběr citací používají teplotu 0 a JSON formát.

## Podrobné kontrakty API

Adresy jsou relativní k webu; při nasazení pod /verity/ tedy například /verity/api/chat.

### Chat a SSE

```json
{
  "messages": [{"role": "user", "content": "Porovnej tyto obrázky."}],
  "memory": {"version": 2, "entries": [], "diary": [], "windowStart": 0},
  "state": {
    "instability": 20, "localTime": "18:30", "weekday": "neděle",
    "visits": 2, "hoursSinceLastVisit": 1, "secondsSinceUserMessage": 5,
    "tabLeaves": 0, "viaVoice": false, "liveVoice": false,
    "ambience": "ticho", "interrupted": false, "roleplayPaused": false
  },
  "thinking": "off",
  "images": ["data:image/jpeg;base64,..."]
}
```

Ukázkový řetězec obrázku je zástupný; skutečné API vyžaduje platné obrazové data URL. Poslední zpráva musí mít roli user. Neznámé role a netextové zprávy v messages se zahazují; obsah zprávy server omezuje na 4000 znaků. Hodnoty state se validují a samotný klient nemůže příznakem udělit svolení k hledání. Server doplňuje User-Agent a dostupnou GPU telemetrii.

| SSE událost | Význam |
| --- | --- |
| {"t":"..."} | Text včetně podporovaných řídicích značek |
| {"thinking":true/false} | Stav přemýšlení; nikoli zveřejnění řetězce vnitřních úvah |
| {"search":"dotaz"} | Skutečně spuštěné hledání |
| {"sources":[{"title":"...","url":"..."}]} | Zdroje pod odpovědí |
| {"done":true} | Řádné dokončení |
| {"error":"..."} | Selhání; nemá se zobrazit jako úspěšné dokončení |

Každá událost má formát data: JSON a dva konce řádku. Klient drží neúplný blok mezi čteními streamu. Zrušení požadavku se přes AbortController předává i LLM a práci na hledání.

### Paměť, archiv a stará kompatibilita

- POST api/memory přijímá message, at a memory. Vrací operations: validované změny s klíčem a doložením v lidské zprávě. Události, citace modelu a hypotézy se neberou jako fakt. Neúplná JSON generace se odmítne; chyba vrátí 502 a prázdné operace.
- POST api/summarize přijímá messages z uzavíraného pracovního úseku. Výsledek má summary, facts: [] a verified: true. Obsahují jej pouze citace skutečně nalezené v lidských zprávách. Starý previous ani asistentův příběh nesmí vytvořit nový osobní fakt.
- POST api/consolidate slouží starým klientům a vrací forget: [], deprecated: true. Současnou paměť nečistí starým indexovým protokolem.

### Hlasové služby

POST api/tts přijímá text, emotion a volitelnou intensity (0–1, výchozí 0,65) a vrací WAV. Proxy odstraní značky, složí parametry z konfigurace a přidá tempo či referenci emoce. Interní OmniVoice HTTP obal očekává:

```json
{
  "text": "Ahoj!",
  "speaker_wav": "/path/to/reference.wav",
  "settings": {
    "voice_mode": "clone", "reference_text": "Přesný přepis reference.",
    "language": "cs", "num_step": 32, "seed": 4242,
    "speed": 1.0, "normalize_text": true
  }
}
```

Interní odpověď je JSON s audio_base64, ze kterého veřejná proxy vrátí WAV. Parametr instruct patří do voice design režimu. Instalace samotné knihovny OmniVoice tento HTTP kontrakt nevytvoří.

POST api/stt?live=1[&final=1] přijímá WAV (max 12 MB) a vrací text a duration. Proxy předá audio na interní /transcribe s X-STT-Key. Klíč se do prohlížeče nedostává. Příliš velký vstup vrací 413, obsazená služba 429 a nedostupný přepis 503. source=1 je odmítnuto a diagnostické ukládání se nepředává ani při debug=1.

GET api/status vrací llm, tts, stt, gpu a voice. Klient kontroluje služby každých 10 s. GPU obsahuje teplotu, využití a obsazenou/celkovou paměť, pokud je nvidia-smi dostupné.

### Limity a proxy

Za minutu na klientskou IP: chat 30, TTS 150, STT 90, summarize 6, memory a consolidate 30. Současně nejvýše 12 POSTů. Cross-site požadavek hlásící Sec-Fetch-Site: cross-site je odmítnut. Odpovědi mají nosniff, same-origin referrer policy a microphone=(self).

IP se určuje z X-Forwarded-For za reverzní proxy. Vlastní nasazení musí zajistit, že přímý veřejný klient nemůže obejít proxy a libovolně podvrhnout tento řetězec. Tyto limity nejsou přihlašování; veřejný odkaz stále používá sdílené GPU.

## Detail mikrofonní cesty

PCM je zvolené proto, aby každý odeslaný WAV obsahoval vlastní hlavičku; pozdější části MediaRecorder WebM nelze obecně dekódovat samostatně. AudioWorklet běží v audio vlákně a posílá bloky 2048 vzorků při výstupních 16 kHz. Nativní mikrofon se nepřevádí v hlavním vlákně a potichu se připojí do grafu přes GainNode s nulovou hlasitostí.

### VAD, hystereze a snímky

| Prvek | Současné chování |
| --- | --- |
| Uživatelský práh | −70 až −10 dBFS, výchozí −50; změna se použije za běhu |
| Začátek se Silero | Pravděpodobnost alespoň 0,5 a překročení uživatelského prahu alespoň 0,1 s |
| Pokračování se Silero | Pravděpodobnost alespoň 0,35 a úroveň nad prahem minus 4 dB |
| Konec VAD úseku | Přibližně 0,8 s bez znělé řeči; odeslání celého tahu řídí zvlášť dialogue.js |
| Bez Silera | Hlasitostní hystereze; při chybě workeru se přejde na tento režim |
| Automatický práh bez explicitního nastavení | Začátek 9 dB nad šumem, nejníže −64 dBFS; konec 5 dB nad šumem, nejníže −68 dBFS |
| Odhad šumu | Prvních 0,5 s kalibrace; pak mimo řeč rychle dolů a pomalu nahoru |
| Pre-roll | Přibližně 0,8 s se Silero, 0,35 s při hlasitostním VAD |
| Krátký úsek | Méně než 0,3 s znělé řeči bez textu se zahodí |
| Průběžný snímek | Timer 1,7 s; posílá se, když přibylo nejméně 1,45 s zvuku |
| Dlouhá souvislá řeč | Rozdělení po 24 s, překryv 0,55 s a odstranění shodných slov na švu |
| Síť | Jeden STT požadavek současně; další PCM se mezitím sbírá |
| Chyba STT | Omezené opakování pro 429/5xx/síť, text zůstane k opravě a nesmí se falešně odeslat |
| Nic není slyšet | Po 3 s bez vstupu nad −75 dBFS se zobrazí upozornění |
| Ruch | ticho pod −58 dBFS, mírný ruch do −45 dBFS, jinak hluk |

Výsledek snímku nahrazuje rozpracovaný text úseku. Prosté přilepování každého dílčího výsledku by opakovalo slova, protože Whisper znovu přepisuje rostoucí úsek. Závěrečný průchod může opravit předchozí rozpoznání.

stop() nejprve dobere worklet přes flush, uvolní stopy a odpojí uzly; pak dokončí přepis. cancel() zvuk a přepis okamžitě zruší. Sdílený AudioContext zůstává aplikaci, vlastní se uzavírá. Po zrušení se kontroluje generace i revision, takže pozdní výsledek STT nebo workeru nemůže obnovit zrušený tah.

### Historická měření a nová kontrola

Původní dokumentace uváděla test dvou českých vět při špičkách −17, −48 a −54 dBFS a ve šumu −39 dBFS. Starší pevný RMS práh 0,007 tichou řeč rozsekával; test po úpravě rozpoznal dva úseky. První verze měla průběžné výsledky v 5,2 / 7,0 / 9,9 s a finální v 11,3 s. Tyto údaje zachováváme jako historický záznam původního vývoje, nikoli současný rychlostní slib nebo nové měření telefonu.

Současné testy ověřují převzorkování v pěti frekvencích, potlačení aliasingu, hranice bloků, uvolnění zařízení, zrušení opožděné inference, VAD práh, několik navazujících tahů a nulové audio požadavky místního testu. Akustickou ozvěnu skutečného telefonu nelze prokázat pouhými digitálními testy.

## Frontend: odpověď, stav, mobil a hudba

Parser drží neuzavřenou značku mezi kusy streamu, rozlišuje emoci a text a dělí projev na věty. Krátké věty může spojit do segmentu; změna emoce vytvoří hranici. TTS požadavky se řetězí, přehrávání postupuje ve stejném pořadí. Dokončené segmenty se připojují do společného řádku titulků, takže příchod nové věty nesmaže předchozí. Při čtení starší části titulku se uživateli automaticky neodscrolluje obsah.

interrupt() ruší chat i frontu zvuku. Číslo epochy brání přehrání opožděné syntézy. Po přerušení se uchovají dokončené vyslovené segmenty a značka přerušení; nezařadí se text, který ještě vůbec nebyl přehrán. Stav práce rozlišuje přepis, hledání, čekání na hlas, skutečné dokončení a chybu.

Oči sledují kurzor, při psaní input, při hledání těkají a při čekání hledí nahoru. Glitch se řídí nestabilitou a emocí, ale volba Bez blikání a systémové prefers-reduced-motion vizuální efekty omezují. Živý režim po odchodu ani při nečinnosti nepokračuje sám; původní reakce na ticho zůstávají jen ve starších režimech.

Layout reaguje na visualViewport a na mobilní klávesnici. Psaní i úplná historie jsou v panelu, hlavní obrazovka zachovává výraznou postavu a dva řádky titulků. Kliknutí Začít rozhovor povolí audio a spustí mikrofon, Raději psát otevře editor. Načtení stránky samo mikrofon nespouští.

Hudbu lze přidat jako vlastní public/podkres.mp3; není distribuovaná v repozitáři. Nástroj tools/beats.py vytvoří údaje o tempu, jinak se použije 120 BPM. Hudba se při odpovědi ztlumí, při mikrofonu a jeho místním testu se stáhne na nulu. Face.dance a Face.musicPhase řídí jemné plynulé houpání.

## Uložení dat a kompakce historie podrobně

| Klíč / struktura | Obsah |
| --- | --- |
| verity.history | Nejvýše 5000 položek role, content, at, případně thumbs; starší thumb zůstává čitelný |
| verity.memory | Verze 2: entries, diary, windowStart a metadata pro opravy či smazání |
| verity.inst, verity.visits, verity.lastSeen | Nestabilita, návštěvy, poslední aktivita |
| Hlasové preference | Live/auto/conv, Silero, práh dBFS, zvukový režim a jednorázová migrace presetu |
| Zálohy migrace / importu | Původní lokální stav, aby šel zkontrolovat či obnovit |

Při překročení pracovního okna 60 zpráv se archivuje nejstarších 30. Celá historie zůstává uložená, do promptu se vybírá pracovní úsek a omezená ověřená paměť. Archiv není osobní deník psaný modelovou fantazií: obsahuje doložené lidské citace, nejvýše 12 zápisů s expirací 30 dní. Při selhání shrnutí se historie nezahodí.

Panel Paměť podporuje úpravu a smazání jednotlivých položek, přidání ručního faktu i export a import JSON. Ruční smazání chrání před opožděným výsledkem staré extrakce. Export obsahuje osobní data a patří do soukromé zálohy. Vymazání dat prohlížeče odstraní paměť daného zařízení; nejde o serverový účet ani automatickou synchronizaci.


## Rozhraní animace (pro výměnu za jinou postavičku)

Celý zbytek aplikace s obličejem mluví jen přes tyto vlastnosti a metody třídy `Face` (`public/face.js`). Nová animace (Canvas, WebGL, Live2D, Rive, sprite sheet, 3D…) musí implementovat totéž a může zbytek nechat beze změny:

| Člen | Typ | Kdo nastavuje | Význam |
|---|---|---|---|
| `new Face(hostElement, {catalog, ambient})` | konstruktor | app.js | vykreslí se do `#face`, sama si pustí `requestAnimationFrame` smyčku |
| `setEmotion(name)` | metoda | app.js | jedna z 29 emocí; kompatibilní zkratka pro perform |
| `perform({emotion,intensity,mood})` | metoda | přehrávač | výraz, nálada a gesto současně s konkrétním segmentem |
| `cancelGesture()` | metoda | přerušení řeči | zahodí probíhající gesto |
| `expression.describe()` | metoda | UI a kontext | popis výrazu a nálady |
| `motion`, `idleEnabled`, `awake`, `attending` | 0–1 / bool | app.js | živost, povolení idle, probuzení a aktivní interakce |
| `speaking`, `noFlash`, `reducedMotion` | bool | app.js | přehrávání a omezení efektů |
| `horrorEnabled` | boolean | app.js → Face | zapíná hororovou choreografii; normální rozhovor ji vypíná |
| `onExpression(state)` | callback | face.js → app.js | aktualizace malého ukazatele nálady |
| `instability` | 0–100 | app.js | deformace každé emoce (viz níže) |
| `talk` | 0–1 | lip sync, ~60×/s | otevření pusy podle hlasitosti |
| `round` | 0–1 | lip sync | 1 = kulatá samohláska (o/u), 0 = široká (e/i) |
| `thinking` | bool | app.js | čeká na první větu |
| `searching` | bool | app.js | hledá na internetu |
| `listening` | bool | app.js | nahrává se mikrofon – postava poslouchá |
| `hear` | 0–1 | mikrofon, ~8×/s | hlasitost uživatele (pulzování, naslouchání) |
| `lookAt(x, y)` | −1…1 | app.js | kam se dívat (kurzor, input) |
| `dance`, `musicPhase` | 0–1, radiány | hudba | jemné houpání podle tempa podkresu |
| `emotion` | string | čte app.js | aktuální emoce (glitch, parser) |
| CSS `--glow`, `--glow-size` na hostu, `--emo-glow` na `:root` | barva, px | face.js | záře postavy a barva pozadí stránky |

### Současná SVG implementace
Všechny rysy jsou spojité parametry, každý snímek se interpolují k cíli (`k = 1 − 0.0015^dt`):

| Parametr | Význam |
|---|---|
| `erx`, `ery`, `eryL` | poloměr očí, otevření, asymetrie levého oka |
| `lookX`, `lookY` | posun pohledu |
| `brow`, `browOp` | úhel obočí (+ zlé, − smutné), viditelnost |
| `w`, `curve`, `open` | polovina šířky úst, úsměv (+) / mračení (−), otevření |
| `teeth`, `blush`, `red` | zuby, ruměnec, rudost očí/těla |
| `shake`, `tilt`, `bob`, `scale`, `glow`, `dim` | třes, náklon, vznášení, velikost, záře, ztmavení |

Ústa jsou dvě kvadratické Bézierovy křivky: koutky `y = base − curve/2`, horní ret řídicí bod `base + 1,5·curve`, dolní `+ 2·open`. Zuby jsou vzorek ořezaný tvarem úst.

Hodnoty emocí jsou ve společném katalogu public/emotions.json. Intenzita a pozvolná nálada je skládají s výchozí pózou. Úplný popis vzhledu, použití a klidových režimů: [docs/EMOCE.md](docs/EMOCE.md).

| Emoce | Gesto | Cílové hodnoty proti základu |
|---|---|---|
| neutral | settle | výchozí póza |
| happy | nod | ery:22 w:58 curve:34 open:13 glow:1.2 bob:1.1 smileEye:1 |
| excited | perk | erx:18 ery:30 w:66 curve:34 open:28 glow:1.4 bob:1.5 scale:1.04 sparkle:1 starEye:1 |
| curious | tilt | ery:28 eryL:-8 brow:-6 browOp:0.7 w:26 curve:6 open:4 tilt:9 |
| love | soften | ery:19 w:50 curve:26 open:4 blush:1 glow:1.3 tilt:-5 smileEye:0.4 heartEye:1 |
| shy | avert | ery:20 lookX:-7 lookY:5 w:24 curve:10 blush:1 tilt:-8 scale:0.97 sweat:0.3 |
| sad | bow | ery:22 lookY:6 brow:-22 browOp:1 w:34 curve:-16 glow:0.7 dim:0.25 bob:0.5 tear:0.8 watery:1 |
| lonely | bow | ery:21 lookY:9 lookX:4 brow:-16 browOp:0.8 w:26 curve:-8 glow:0.5 dim:0.4 bob:0.4 scale:0.95 |
| scared | recoil | erx:22 ery:38 brow:-18 browOp:0.9 w:22 curve:-6 open:32 shake:0.5 glow:0.8 sweat:1 shock:1 |
| jealous | sideeye | ery:12 lookX:8 brow:14 browOp:0.8 w:40 curve:6 red:0.2 tilt:4 mouthBias:5 |
| angry | shake | ery:14 brow:36 browOp:1 w:44 curve:-12 open:7 red:0.45 shake:0.6 glow:1.1 anger:1 puff:0.55 |
| unhinged | still | erx:10 ery:31 w:100 curve:44 open:24 teeth:1 red:1 shake:0.7 glow:1.4 scale:1.04 browAsym:5 |
| whisper | lean | ery:15 lookY:3 w:22 curve:8 open:6 glow:0.6 dim:0.35 scale:1.08 bob:0.3 |
| calm | settle | ery:22 w:43 curve:15 glow:1.05 bob:0.6 smileEye:0.15 |
| amused | chuckle | ery:17 w:63 curve:31 open:25 smileEye:1.2 browOp:0.3 blush:0.15 tilt:-4 |
| proud | perk | ery:20 w:58 curve:25 browOp:0.5 brow:3 lookY:-3 scale:1.025 sparkle:0.7 mouthBias:8 |
| relieved | exhale | ery:19 w:47 curve:21 brow:-7 browOp:0.55 smileEye:0.7 bob:0.7 |
| grateful | nod | ery:21 w:45 curve:23 blush:0.6 tilt:-3 glow:1.15 smileEye:0.3 watery:0.4 |
| empathetic | soften | ery:24 brow:-15 browOp:0.8 w:35 curve:7 tilt:-5 glow:0.9 bob:0.5 watery:0.45 |
| worried | tilt | ery:28 brow:-23 browOp:1 w:30 curve:-5 lookY:1 tilt:4 dim:0.08 sweat:0.55 |
| confused | tilt | ery:24 eryL:-8 brow:-4 browAsym:20 browOp:1 w:30 curve:1 mouthBias:7 tilt:10 question:1 |
| skeptical | sideeye | ery:15 eryL:5 brow:3 browAsym:23 browOp:1 w:35 curve:3 mouthBias:9 lookX:5 tilt:-5 flatEye:0.8 |
| surprised | recoil | erx:25 ery:39 brow:-16 browOp:0.9 w:24 curve:0 open:37 scale:1.02 shock:1 |
| embarrassed | avert | ery:20 eryL:3 brow:-7 browAsym:9 browOp:0.75 w:35 curve:9 mouthBias:8 blush:1 lookY:6 tilt:-7 sweat:1 flatEye:0 |
| determined | nod | ery:21 brow:13 browOp:0.85 w:44 curve:10 lookY:-1 scale:1.02 glow:1.1 sparkle:0.4 |
| disappointed | exhale | ery:15 brow:-12 browOp:0.8 w:38 curve:-8 lookY:5 dim:0.16 bob:0.5 flatEye:1 |
| playful | wink | ery:22 eryL:-6 brow:4 browAsym:8 browOp:0.65 w:54 curve:23 mouthBias:12 tilt:7 blush:0.15 smileEye:0 |
| tired | exhale | ery:12 brow:-6 browOp:0.4 w:32 curve:4 lookY:5 dim:0.18 bob:0.4 tilt:-3 flatEye:1 |
| offended | huff | ery:12 lookX:17 brow:14 browOp:1 w:22 curve:-10 open:1 mouthBias:4 blush:0.4 tilt:-12 puff:1 |

Nestabilita navíc: `w += i·34`, `curve += i·12`, `red ≥ (inst−45)/55`, `teeth ≥ (inst−70)/30`, víc třesu nad 60; mrkání je tím vzácnější, čím vyšší nestabilita (zírá). Barva těla se míchá ze žluté do tmavě oranžovo-rudé podle `red·0,7 + dim`.

### Lip sync (`app.js → lipLoop`)
Audio jde přes `AnalyserNode` (fftSize 1024):
- `talk` = RMS časového průběhu, `clamp((rms − 0,008)·8)`, náběh 0,55 / doznívání 0,25
- `round` = spektrální těžiště 250–4000 Hz → `1 − (centroid − 700)/1400`
- na obličeji: `open += talk·(24 − round·6)`, `w −= talk·round·18`

Funguje s jakýmkoli hlasem bez fonémů. Pro přesnější lip sync lze přidat visemy (např. Rhubarb Lip Sync) – TTS vrací celé WAV, takže je lze spočítat na serveru.

---


## Hlas (TTS)

### Příklad nastavení (`config.json → tts`)
```json
{ "mode": "clone",
  "speaker_wav": "/path/to/omnivoice/references/verity_cs.wav",
  "reference_text": "Přesný přepis skutečné referenční nahrávky.",
  "language": "cs", "num_step": 32, "seed": 4242, "speed": 1.0,
  "emotions": { "sad": {"speed": 0.92}, "lonely": {"speed": 0.88}, "excited": {"speed": 1.12}, "...": {} } }
```
Reference `verity_cs.wav` je vzorek, který OmniVoice vygeneroval v design režimu (`instruct: "female, teenager, high pitch"`, seed 4242) a který uživatel vybral. Klonováním z něj je hlas stabilní a stejný ve všech větách. Emoce mění tempo; whisper navíc používá vlastní šepotanou referenci. Starší dokumentace uváděla generování přibližně 1–1,4 s na větu; nejde o nově změřený limit.

### Ponaučení
1. **Reference musí být ve stejném jazyce jako výstup.** Anglická reference (`verity.wav`) → čeština s anglickým přízvukem. Navíc byla přebuzená (špička 1,0) a končila reklamní větou.
2. **Režim `design` (bez reference) občas vygeneruje šum** – hlavně `whisper` a velmi krátké věty („Ano.“, „To nic.“). Historické měření původní verze: spektrální plochost 0,39–0,53 u šumu vs ~0,1 u řeči. Původní záznam uvádí 20/20 čistých vět s českou referencí; není to záruka každé další generace.
3. Pokud reference nemá přepis, OmniVoice ho poprvé udělá přes Whisper na CPU (~25 s), pak je v cache.

### Ochrana proti šumu (`audioLooksBroken` v server.js)
Odmítne výstup, když: medián zero-crossing rate aktivních rámců > 0,3 (šum), špička RMS < 0,01 (ticho), nebo délka > 2 s + 0,25 s/znak. Pak nový pokus s `seed+1`, `seed+2`. Pokusy se logují (`[tts]` v logu serveru).

### Změna hlasu
1. Nahraj 3–10 s **čisté řeči v cílovém jazyce** (bez hudby, nepřebuzené) do složky referencí TTS služby.
2. V `config.json` nastav `speaker_wav` a `reference_text` (přesný přepis; prázdný = Whisper).
3. Restartuj server.

---


## Provoz: příkazy a reverzní proxy

```bash
cp config.example.json config.json   # doplň adresy služeb
node server.js                       # nebo: pm2 start server.js --name verity && pm2 save
pm2 logs verity                      # logy (včetně opakovaných TTS pokusů: rg "\[tts\]")
```

Reverzní proxy (Apache):
```apache
RedirectMatch 302 ^/verity(\.php)?$ /verity/
ProxyPass        /verity/ http://127.0.0.1:3700/ flushpackets=on timeout=300
ProxyPassReverse /verity/ http://127.0.0.1:3700/
```
Ověř, že proxy nebufferuje SSE; uvedené flushpackets=on zachovává příklad z nasazení. Frontend používá **relativní** cesty (`api/chat`), takže funguje pod `/verity/` i přímo na portu Node serveru.

Rychlé testy:
```bash
curl -s localhost:3700/api/status
curl -sN localhost:3700/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"ahoj"}]}'
curl -s localhost:3700/api/tts -H 'Content-Type: application/json' -d '{"text":"Ahoj.","emotion":"happy"}' -o /tmp/t.wav
```

---


## Doporučení pro reimplementaci s jinou animací

1. Zachovej **protokol značek** a **rozhraní `Face`** uvedené výše – pak lze `face.js` vyměnit bez zásahu jinam.
2. Emoce ber jako **spojité parametry s interpolací**, ne jako přepínání obrázků – přechody uprostřed věty jsou to, co postavu oživuje.
3. Nestabilitu aplikuj jako **globální deformaci** nad emocí. Při uklidnění, věcné pomoci a soucitu ji dočasně utlum; vypnutý roleplay ji vypíná zcela.
4. Lip sync řiď z **reálného audia** (RMS + spektrální těžiště), ne z textu – synchronizace je zadarmo a funguje s jakýmkoli TTS.
5. TTS **po větách** s předgenerováním další věty; první věta rozhoduje o vnímané latenci.
6. Proměnlivý kontext dávej **na konec promptu**, jinak se ztratí prompt cache.
7. „Vševědoucnost“ dělej z **reálných signálů prohlížeče** (čas, odchody ze záložky, nečinnost, zařízení) – působí to děsivěji než vymyšlené detaily a nic se nevymýšlí.
8. TTS reference nejlépe v **cílovém jazyce**, čistá, 3–10 s, a výstup kontroluj na šum.
9. Mikrofon: PCM přes AudioWorklet a **samostatné WAV snímky**, ne kusy z MediaRecorderu; jeden přepis najednou; závěrečný průchod přesnější než průběžný.
10. **Přerušení přes epochy**: každá odpověď má číslo, zastavení ho zvýší a vše opožděné ze staré odpovědi se zahodí. Do historie ukládej jen to, co postava opravdu řekla.
11. Za reverzní proxy ber IP klienta z `X-Forwarded-For`, jinak limity platí pro všechny dohromady.


## Anime herectví a klidové režimy (8. 11. 2026)

Tři vrstvy: Gemma volí krátký výraz a intenzitu; ExpressionState plynule mění náladu; Face přidává lokální choreografii a lip sync. IdleDirector nekomunikuje se serverem. Protokol i výchozí rychlosti hlasu používají společný katalog. Při skutečné výtce server přidá věcný pokyn do kontextu, aby nová uraženost nepřebila uznání chyby. Nejde o bezchybný klasifikátor.

Průběžný parser uchovává značky i přes hranice síťových chunků. Přehrávač přepne výraz teprve po přípravě audia a kontrole aktuální epochy, při přerušení zahodí čekající segmenty i gesta. Textový režim používá stejné segmenty. Přehled a reprodukovatelné testy: [Emoce](docs/EMOCE.md), [Simulace](docs/EMOCE-A-SIMULACE.md).

Nastavení verity.expressiveness (0–100, výchozí 85) a verity.idleAnimations (výchozí true) se ukládá přes existující localStorage store v prohlížeči; při nedostupném úložišti použije výchozí hodnoty. Bez blikání a systémové omezení pohybu mají přednost.

## Hororová režie a kontext (8. 11. 2026)

public/horror-director.mjs přidává k výrazu šest reakcí: mask, stare, tilt, loom, fracture a release. Bez síťových požadavků a zvuku; řízení přes Face.perform a fázi. Při přerušení se choreografie ruší, při poslechu/přemýšlení/hledání ustupuje. Uklidnění, focused/tender odpověď a soucit tlumí vysokou nestabilitu také vizuálně. roleplayPaused okamžitě nastaví horrorEnabled=false a klidný výraz. Omezení pohybu potlačí časované motivy; statický výraz zůstává.

[Přehled hororu, zdroje a simulace](docs/HOROR.md). [Podrobná kompakce a paměť](docs/KONTEXT-A-PAMET.md) výslovně rozlišuje posledních 40 zpráv, výběr doložených citací po překročení 60 a dlouhodobá fakta. Archiv není souhrnem celého fikčního příběhu.
