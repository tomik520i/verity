# Verity – technická dokumentace
Stav implementace: 8. listopadu 2026.

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

Přepis se posílá po částech přes API a zobrazuje se v rozepsané zprávě i stručně pod postavou. Průběžný výsledek může Whisper změnit. Odeslání do LLM čeká na finální přepis aktuálního tahu; neodesílá každé částečné slovo zvlášť.

Průběžný režim po ukončení hovoru ani po návratu do záložky nespouští automatické monology. Starší režim si původní reakce na nečinnost zachovává.

Průběžný hovor používá jeden otevřený mikrofon. Pauza je přibližně 1,05 s po koncové interpunkci, 1,4 s obecně a 2 s při zjevně nedokončené větě. Klient potlačuje dvojí odeslání, čeká na finální STT a hlídá změnu generace při ukončení. Pozdě dokončené oprávnění mikrofonu po zrušení vede k okamžitému uvolnění zařízení.

Starší režim nahrává jednotlivou zprávu, maximálně 90 s; automatické odeslání používá pauzu 2,2 s. Navazující starší konverzační režim znovu otevírá mikrofon po odpovědi a při nečinnosti jej zavírá. V průběžném režimu jsou tyto dvě starší volby neaktivní.

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
| POST api/chat | Zprávy, paměť, stav; odpověď SSE |
| POST api/memory | Návrh ověřených změn paměti z lidské zprávy |
| POST api/summarize | Kompakce paměti s validací |
| POST api/tts | Text a emoce → WAV |
| POST api/stt | WAV → český přepis |
| POST api/consolidate | Sloučení ověřené paměti |

Konkrétní payload a směrování proxy jsou v server.js. Whisper služba musí podporovat rozhraní očekávané proxy; samotná instalace knihovny Whisper nestačí. Adresy a klíče se nastavují v config.json a stt.key. Hlasový klon vyžaduje odpovídající referenční WAV a přesný přepis. Tyto soubory nejsou distribuovány.

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
