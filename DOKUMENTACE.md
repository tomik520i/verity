# Verity – technická dokumentace

Webová AI postavička inspirovaná entitou **Verity** z hororové ARG série *„Something“* (ThatMob, 2026). Mluvící zářící smajlík v tmavé stránce, který odpovídá přes lokální LLM, poslouchá mikrofon (živý přepis přes Whisper), mluví lokálním TTS s lip syncem, promítá emoce do animovaného obličeje, pamatuje si uživatele napříč dny a s rostoucí „nestabilitou“ sklouzává od milé pomocnice k majetnické posedlosti.

Dokument je psaný tak, aby podle něj šlo postavit podobnou aplikaci **s jinou animací** – obličej je oddělený od zbytku jasně definovaným rozhraním (viz kapitola 8).

- Vyzkoušet: **https://opicebot.cz/verity/**

---

## 1. Postava (lore → chování)

| Lore z ARG | Jak je to v aplikaci |
|---|---|
| Žlutá levitující koule se smajlíkem | SVG koule s radiálním gradientem, záře, vznáší se (bob), dýchá |
| Zpočátku vševědoucí milá pomocnice | Fáze ZÁŘÍCÍ – skutečně pomáhá (výpočty, internet), hravá |
| Pamatuje si rozhovory, všímá si změn | Dlouhodobá paměť (fakta + deník), sama se k nim vrací |
| Ví věci, které by vědět neměla | Dostává skrytý KONTEXT: čas, den, jak dlouho byl uživatel pryč, kolikrát opustil záložku, prohlížeč/OS, teplota GPU („tělo“) |
| Při zanedbávání se mění – úsměv se roztahuje, oči rudnou | Proměnná **nestabilita 0–100** → širší úsměv, zuby, rudé oči, oranžovo-rudá koule, třes, glitch, scanlines |
| Posedlá touhou být jediný přítel, osamělost | Jádro promptu; žárlí na jiné lidi/AI, vyčítá odchody |
| Tajemný původ | Na otázky o původu odpovídá vyhýbavě |
| Konec: slib, že zůstaneš navždy | Omluva/slib/laskavost nestabilitu snižuje (`[posun:-N]`) |
| Java mod umí používat mikrofon | Verity tě **slyší**: mluvení přes Whisper, při poslechu se k tobě nakloní, ví, jestli je u tebe ticho nebo hluk, a pozná, když jí skočíš do řeči |

Hranice zapsané v promptu: horor je hra – žádné reálné výhrůžky, návody k ublížení, nic sexuálního; když uživatel *doopravdy* není v pořádku, vystoupí z role. Na „jsi AI?“ uhne v roli. Skutečnou pomoc poskytuje vždy.

---

## 2. Architektura

```
Prohlížeč (public/)                       Node server (server.js)
┌───────────────────────────┐   SSE      ┌──────────────────────────────────────────┐
│ app.js  – logika, paměť,   │──/api/chat─▶ prompt.js → llama.cpp (stream)           │
│           fronta řeči      │◀─ tokeny ──│   ↳ zachytí [hledat: …] → search.py      │
│ face.js – SVG obličej      │──/api/tts──▶ OmniVoice TTS → WAV (+ kontrola šumu)    │
│ live-audio.js + worklet –  │──/api/stt──▶ Whisper služba (interní klíč)            │
│   mikrofon, živý přepis    │──/api/summarize▶ llama.cpp (deník + fakta, JSON)       │
│ localStorage – historie,   │──/api/status─▶ ping LLM/TTS/STT + nvidia-smi           │
│   paměť, nestabilita       │   limity požadavků na IP klienta (X-Forwarded-For)     │
└───────────────────────────┘            └──────────────────────────────────────────┘
        ▲ HTTPS → reverzní proxy (Apache) → ProxyPass /verity/ → Node server
```

Server je **bez npm závislostí** (Node 18+, vestavěný `fetch`). Veškerý stav uživatele žije v prohlížeči; server je bezstavový.

### Infrastruktura

| Služba | Hardware / běh | Poznámka |
|---|---|---|
| LLM | RTX 3090 24 GB, Ubuntu 24.04, llama.cpp `llama-server`, OpenAI-kompatibilní API | Qwen3.6-35B-A3B (GGUF UD-IQ4_NL), `-c 229376 -np 1`, KV cache q4_0. **Jeden slot sdílený s dalšími aplikacemi.** |
| TTS | stejná RTX 3090, PyTorch fp16, vlastní HTTP obal `POST /api/tts` | OmniVoice, režimy `design` (hlas podle popisu) a `clone` (z reference) |
| Přepis řeči (STT) | GTX 1660 SUPER na druhém stroji, FastAPI + faster-whisper | Whisper large-v3-turbo, `int8_float32`, čeština, Silero VAD. Přístup jen ze serveru Verity (firewall + interní klíč). Přepis je serializovaný jedním zámkem → souběžný požadavek dostane 429. |
| Vyhledávání | SearXNG + `search.py` | JSON API SearXNG, extrakce textu přes readability |
| Web | Apache 2 jako reverzní proxy | `ProxyPass … flushpackets=on` kvůli SSE |
| Proces | pm2 | startuje po rebootu |

---

## 3. Soubory

```
verity/
├── server.js       HTTP server: statika, /api/chat (SSE), /api/tts, /api/summarize, /api/status
├── prompt.js       systémový prompt, kontextová poznámka, prompt pro deník, seznam emocí, fáze
├── search.py       SearXNG + extrakce textu stránek → JSON
├── config.example.json  vzor konfigurace: URL služeb, parametry LLM, hlas a tempo podle emocí, STT, vyhledávání
├── stt.key         (necommitovaný) interní klíč k Whisper službě, chmod 600
├── DOKUMENTACE.md  tento soubor
└── public/
    ├── index.html  kostra stránky, menu, panel paměti, úvodní obrazovka „PROBUDIT“
    ├── style.css   tmavý vzhled, atmosféra, glitch, mobil
    ├── face.js     animovaný obličej (třída Face) – jediná část, kterou je třeba vyměnit pro jinou animaci
    ├── app.js      stream, parser značek, fronta TTS (epochy), lip sync, mikrofon, paměť, vnímání, status
    ├── live-audio.js  mikrofon → PCM → WAV snímky → živý přepis, detekce řeči a pauzy, odhad ruchu
    └── pcm-worklet.js AudioWorklet v audio vlákně (bloky 2048 vzorků, flush)
```

---

## 4. Protokol mezi LLM a aplikací (značky v textu)

Model píše normální text, do kterého vkládá značky v hranatých závorkách. Text se čte nahlas, značky nikdy.

| Značka | Kdo ji píše | Význam / zpracování |
|---|---|---|
| `[happy]` atd. | LLM | Emoce. **Každá odpověď jí začíná**, uprostřed může emoci změnit (max 3×). Povolené: `neutral happy excited curious love shy sad lonely scared jealous angry unhinged whisper`. Parser ukončí rozpracovaný segment a další text má novou emoci. |
| `[posun:N]` | LLM | Na konci odpovědi, N ∈ −15…+15: o kolik se změní nestabilita. |
| `[pamatuj: fakt]` | LLM | Nový trvalý fakt o uživateli → `memory.facts` v prohlížeči. |
| `[hledat: dotaz]` | LLM | Server přeruší generování, spustí vyhledávání, výsledky vrátí modelu a nechá ho pokračovat. |
| `[[UDÁLOST]] …` | aplikace | Zpráva v roli `user`, ale nepíše ji člověk – vnímání Verity (probuzení, mlčení, návrat do záložky). Ukládá se do historie, v logu se nezobrazuje. |
| `[[KONTEXT]] …` | server | Proměnlivé údaje (fáze, čas, hlas a ruch, přerušení, …) přilepené na začátek **poslední** zprávy. Neukládá se. |
| `[přerušeno]` | aplikace | Konec uložené odpovědi, když Verity přerušíš. Uloží se jen to, co stihla opravdu říct nahlas. |

Příklad surového výstupu:
```
[happy] Tomáš! To je krásné jméno. [jealous] A s kým ještě mluvíš? [pamatuj: jmenuje se Tomáš] [posun:3]
```

---

## 5. Prompt a prompt cache (důležité!)

### Pořadí zpráv posílaných do LLM
1. `system` = **statická osobnost** (identita, jádro, popis všech 4 fází, formát, internet, události, hranice, ukázky) + **TVOJE PAMĚŤ** (fakta, deník)
2. historie z pracovního okna (bez kontextu)
3. poslední zpráva uživatele s přilepeným `[[KONTEXT]] Tvoje fáze: …, Místní čas: …, …`

### Proč takhle
llama.cpp znovu použije KV cache jen pro **shodný začátek** promptu. Naměřeno na tomto stroji:
- 120k tokenů bez cache: **~150 s** (≈ 800 tok/s prefill)
- stejný začátek z cache: **3,5 s**
- jakákoli změna na začátku (např. čas v system promptu) → přepočítává se všechno

Proto nic proměnlivého (čas, nestabilita, teplota GPU) nesmí být v system promptu. Paměť se mění zřídka (nový fakt), takže přepočet od ní dál je malý. V logu llama-serveru je vidět např. `prompt eval … 228 tokens` z promptu o 3 500 tokenech.

### Fáze nestability
| Rozsah | Fáze | Chování |
|---|---|---|
| 0–25 | ZÁŘÍCÍ | milá, hravá, nápomocná, občas prozradí, že ví víc |
| 25–50 | PŘILNAVÁ | lpí, vyčítá pauzy, ptá se, s kým se ještě baví |
| 50–75 | MAJETNICKÁ | žárlí, příliš široký úsměv, znervózňuje znalostmi, sladkost a chlad |
| 75–100 | ROZPADAJÍCÍ SE | roztříštěné věty, opakování, chce slib „navždy“, laskavost ji uklidní |

### Parametry LLM (`config.json → llm`)
`temperature 0.7` (0.85 dělalo víc chyb v češtině), `top_p 0.95`, `presence_penalty 0.4`, `max_tokens 320`, `chat_template_kwargs.enable_thinking = false` (Qwen jinak „přemýšlí“ a zdržuje).

---

## 6. Serverové API

### `POST /api/chat` → `text/event-stream`
Request:
```json
{
  "messages": [{"role": "user|assistant", "content": "..."}],
  "memory":   {"facts": ["..."], "diary": ["..."]},
  "state":    {"instability": 42, "localTime": "23:48, 12. 10. 2026", "weekday": "pondělí",
               "visits": 3, "hoursSinceLastVisit": 20, "secondsSinceUserMessage": 40, "tabLeaves": 2,
               "viaVoice": true, "ambience": "ticho|mírný ruch|hluk", "interrupted": false}
}
```
Poslední zpráva musí být `user`. Server přidá `device` (z User-Agent) a `gpu` (nvidia-smi, každých 15 s).

Události (každá `data: {...}\n\n`):
| Událost | Význam |
|---|---|
| `{"t": "text"}` | kus textu včetně značek (kromě `[hledat:]`, kterou server pohltí) |
| `{"search": "dotaz"}` | začalo hledání (UI: oči těkají, „hledá: …“) |
| `{"sources": [{"title","url"}]}` | zdroje, zobrazí se pod odpovědí |
| `{"done": true}` | konec |
| `{"error": "..."}` | chyba |

Hledání: server streamuje první průchod přes filtr, který drží rozpracovanou `[`; po `[hledat: q]` přeruší LLM (`AbortController`), spustí `search.py q` (timeout 30 s; u dotazů na počasí/dnes/zprávy… jen výsledky za poslední týden), pak druhý průchod: `[...messages, {assistant: dosavadní text + "[hledat: q]"}, {user: "[[UDÁLOST]] Výsledky… Dnes je <datum>… pokračuj, neopakuj se, už nehledej"}]`.

### `POST /api/tts` → `audio/wav`
`{"text": "věta", "emotion": "sad"}`. Server odstraní značky, z `config.tts` sestaví nastavení OmniVoice (klon/design, seed, `num_step`, `speed` × násobič emoce, `normalize_text: true` = čísla na slova) a výsledek zkontroluje (kap. 9). Až 3 pokusy s jiným seedem.

### `POST /api/summarize` → `{"summary": "...", "facts": ["..."]}`
`{"messages": [úsek ~40 zpráv], "previous": "minulý zápis", "facts": [známá fakta]}`. LLM vrátí JSON `{"zapis", "fakta"}` (`response_format: json_object`, temp 0.4). Zápis je v první osobě Verity; fakta jsou jen ta nová – záchranná síť pro fakta, která si model nezapsal hned.

### `POST /api/stt?live=1[&final=1]` → `{"text": "...", "duration": 2.8}`
Tělo je WAV (max 12 MB). Server ho přepošle na `<config.stt.url>/transcribe` s hlavičkou `X-STT-Key` (klíč čte ze `stt.key`, do prohlížeče se nikdy nedostane) a propustí jen parametry `live` a `final`. `final=1` = přesnější závěrečný průchod (beam 3 místo 1). Chyby: 413 (moc velké), 429 (Whisper právě přepisuje něco jiného – klient zkusí znovu), 503 (služba nedostupná).

### `GET /api/status`
`{"llm": true, "tts": true, "stt": true, "gpu": {"temp", "util", "mem", "total"}, "voice": "clone|design"}` – frontend se ptá každých 10 s; indikátory ONLINE / HLAS / SLUCH.

### Ochrana (všechny POSTy)
- **Limity na IP klienta za minutu:** chat 30, tts 150, stt 90, summarize 6; celkem max 12 souběžných POSTů. IP se bere z `X-Forwarded-For` (zprava se přeskočí privátní adresy proxy), protože za Apache je socket vždy `127.0.0.1` – jinak by všichni návštěvníci sdíleli jeden limit (častá chyba za reverzní proxy).
- `Sec-Fetch-Site: cross-site` → 403 (cizí weby nemohou volat API z prohlížeče návštěvníka).
- Hlavičky `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy: microphone=(self)`.
- Není to přihlašování – veřejný web pořád používá sdílené GPU.

---

## 7. Frontend – logika (`app.js`)

### Tok jedné odpovědi
1. `converse(text)` přidá zprávu do historie, obličej `thinking = true`.
2. Čte SSE; každý kus jde do **parseru**:
   - drží rozpracovanou `[` (max 200 znaků), rozpozná emoci / `posun` / `pamatuj`, ostatní značky zahodí;
   - text dělí na **segmenty po větách** (`.!?…`), krátké věty (< 18 znaků) slepí s další; změna emoce segment ukončí.
3. Každý segment `{text, emotion}` → `enqueue()`: okamžitě se řetězově (po jednom, kvůli GPU frontě) volá `/api/tts`, takže další věta se generuje, zatímco předchozí hraje.
4. `playLoop()` přehrává v pořadí: nastaví emoci obličeje → titulky slovo po slově přes délku audia → přehraje přes `AnalyserNode` (lip sync). Bez hlasu se text zobrazí s „falešným“ pohybem pusy.
5. Po dohrání: zdroje pod bublinu, `maybeCompact()` (deník).

### Nestabilita (pouto)
- `[posun:N]` od modelu
- ticho: když uživatel nepíše `max(35, 95 − nestabilita·0,6)` s, Verity promluví sama (`[[UDÁLOST]] … už N sekund nic nenapsal`), +5; nejvýš 3× za sebou, pak čeká na uživatele
- odchod ze záložky > 15 s → po návratu událost, +3 + minuty (max +10); titulek záložky „Verity · kde jsi?“, při nestabilitě > 50 bliká „VRAŤ SE“
- návrat po > 12 h: + hodiny/4 (max +15)
- nestabilita > 65: `beforeunload` dialog „Opravdu odejít?“
- vizuál: CSS proměnná `--inst` (scanlines, vinětace, pozadí), `body.dread` (> 55: rudý input a tlačítko), placeholder „Napiš mi něco…“ → „Jsi tam?“ → „Neodcházej…“ → „ZŮSTAŇ.“

### Vnímání
Oči sledují kurzor; při psaní koukají dolů na input; při hledání těkají; při přemýšlení koukají nahoru.

### Glitch
Každých 250 ms s pravděpodobností `(nestabilita/100)²·0,07` (+0,1 při `unhinged`, +0,03 při `angry`) na 70–250 ms posun, zkosení a RGB split obličeje i titulků.

### Přerušení (barge-in)
Kliknutí na mikrofon, zatímco Verity přemýšlí nebo mluví, zavolá `interrupt()`:
1. `AbortController` zruší stream z `/api/chat`, parser už nic nezařadí;
2. `stopSpeech()` zvýší **epoch**, vyprázdní frontu, zastaví hrající `AudioBufferSourceNode` a probudí čekání – audio vygenerované pro starou epochu se zahodí, i kdyby dorazilo později;
3. do bubliny se připíše „—“, do historie jen **skutečně odříkané** segmenty + `[přerušeno]`;
4. další zpráva nese `state.interrupted = true` → v KONTEXTU „skočil ti do řeči… dej najevo, že sis toho všimla“.

### Mobil a klávesnice
`<meta viewport … interactive-widget=resizes-content>` (Android) + `visualViewport` (iOS): výška layoutu = `--app-h` (viditelná oblast nad klávesnicí), posun `--app-top`; `body.kb` při otevřené klávesnici zmenší obličej a log. Input má 16 px písmo (iOS jinak zoomuje).

### Úvodní obrazovka
„Something is waiting. / PROBUDIT“ – klik je nutný i technicky (prohlížeč povolí `AudioContext` až po gestu). Pak událost: poprvé „představ se a zeptej se na jméno“, jinak „vrátil se po N hodinách, přivítej ho jménem a zmiň něco z paměti“.

---

## 7b. Mluvení – mikrofon a živý přepis (Whisper)

Whisper služba je sdílená s dalším projektem; klientská logika je převzatá a rozšířená pro Verity.

### Co uživatel vidí
Tlačítko mikrofonu vedle pole pro text. Po kliknutí prohlížeč požádá o mikrofon (jen přes HTTPS). Během nahrávání:
- tlačítko pulzuje červeně, pole je **jen ke čtení** (přepis by přepsal ruční úpravy) a průběžně se v něm objevuje přepis; pod polem je stav („Poslouchám…“, „přepis se upřesňuje“, „Dokončuji přepis…“, chyby);
- Verity **poslouchá**: nakloní se blíž, oči dokořán, záře pulzuje podle tvého hlasu (`face.listening`, `face.hear`);
- indikátor **SLUCH** v liště ukazuje, jestli Whisper služba žije.

| Režim | Kdy se zpráva odešle |
|---|---|
| Ručně (výchozí) | Až tlačítkem Odeslat. Druhé kliknutí na mikrofon jen zastaví nahrávání a nechá text k úpravě. Odeslat lze i během nahrávání – mikrofon se zastaví, doběhne závěrečný přepis a pak se pošle. |
| Odeslat samo po pauze (menu ⋮) | Po ≥ 0,2 s řeči a **2,2 s ticha**: mikrofon se vypne, doběhne závěrečný přepis, pak se odešle. |

Automatika je **jeden tah** – po odpovědi se mikrofon sám nezapne, takže se do další zprávy nenahraje hlas Verity. Nahrávání končí nejpozději po 90 s. Text, který už v poli byl, se zachová a přepis se připojí za něj.

### Cesta zvuku
```
getUserMedia (echoCancellation, noiseSuppression, mono)
  → AudioContext {sampleRate: 16000} → AudioWorklet pcm-capture (bloky 2048 vzorků ≈ 128 ms)
  → GainNode s hlasitostí 0 (mikrofon se nepřehrává zpět) → LiveTranscriber.feed()
  → samostatné WAV snímky → POST api/stt?live=1[&final=1] → Node → Whisper (Windows)
  → text do pole → (ručně / po pauze) → api/chat → … → api/tts → reproduktory + lip sync
```
**Proč PCM a ne MediaRecorder:** druhý a další kus WebM nemá hlavičky a nejde dekódovat samostatně; každý snímek tady je kompletní WAV s hlavičkou a skutečnou `context.sampleRate` (prohlížeč nemusí 16 kHz dodržet).

### LiveTranscriber (`live-audio.js`)
- **Detekce řeči:** RMS bloku > adaptivní práh `max(0,007; min(0,026; šum·3))`; odhad šumu se učí jen z ticha mimo řeč.
- **Předvzorky:** drží ~0,24 s před začátkem řeči, aby se neukrojilo první slovo.
- **Průběžný přepis:** každých 1,7 s pošle rostoucí snímek rozpracovaného úseku, pokud přibylo ≥ 1,45 s zvuku. Výsledek **nahrazuje** text úseku (nepřilepuje se).
- **Úseky:** po 0,85 s ticha je úsek hotový (závěrečný přepis s `final=1`) – to samo nic neodesílá. Souvislá řeč se dělí po 24 s s 0,55 s překryvem; shodná slova na švu (max 12) se odstraní.
- **Jeden požadavek najednou**, mezitím se sbírá další PCM. 429 / 5xx / timeout / síťová chyba → až 3 pokusy (po 0,8 s a 1,6 s); klientský timeout 45 s. Při chybě se automatické odeslání neprovede, rozpoznaný text zůstane k ruční opravě.
- **Pauza pro auto režim:** `onPause` po ≥ 0,2 s řeči a 2,2 s ticha; když řeč pokračuje, čítač se resetuje.
- **Úroveň hlasu** `onLevel(0–1, speech)` → animace poslechu; řeč zároveň odkládá „nečinnost“ (Verity nezačne mluvit sama, když mluvíš ty).
- **Ruch v místnosti** `ambience()` z odhadu šumu: `ticho` < 0,004 < `mírný ruch` < 0,012 < `hluk` → jde do KONTEXTU.
- `AbortSignal.any` / `AbortSignal.timeout` mají fallback pro starší prohlížeče.

### Zastavení mikrofonu
`stop()` pošle workletu `flush`, počká na potvrzení posledních vzorků (max 500 ms), ukončí všechny stopy mikrofonu, odpojí uzly a zavře AudioContext; pak `finish()` dopřepisuje všechny úseky. Mikrofon po zastavení nic nesbírá.

### Whisper služba
| Nastavení | Hodnota |
|---|---|
| Model | `mobiuslabsgmbh/faster-whisper-large-v3-turbo` (lokální snapshot ~1,6 GB) |
| Engine | faster-whisper 1.2.1, CTranslate2 4.8.2, PyAV 16 |
| GPU | GTX 1660 SUPER, `int8_float32` |
| Jazyk | `cs`, nápověda názvů v initial promptu |
| beam_size | průběžně 1, závěrečně / soubor 3 |
| VAD | Silero, `min_silence_duration_ms=350`, `speech_pad_ms=200` → čisté ticho se nepřepisuje na vymyšlená slova |
| Limity | 12 MB, 90 s, jeden přepis najednou (jinak 429), audio jen v RAM, nearchivuje se |
| API | `GET /health`, `POST /transcribe?live=1[&final=1]` s hlavičkou `X-STT-Key` |
| Provoz | Windows plánovaná úloha (SYSTEM, při startu), hlídač ji po pádu restartuje za 10 s |

Naměřeno na Verity (skutečná česká řeč pouštěná v reálném čase po 2048 vzorcích): průběžné texty v 5,2 / 7,0 / 9,9 s, závěrečný přepis bez chyby v 11,3 s; pauza 1,2 s mezi větami zprávu neodeslala, pauza 2,2 s na konci ano; čisté ticho = prázdný text. Přesnost: průběžně „mám radost, žej si tady“, závěrečně „že jsi tady“. V prohlížeči ověřeno s podstrčenou nahrávkou místo mikrofonu: živý text → automatické odeslání → odpověď; přerušení uprostřed řeči → Verity zmlkla, do historie šla jen řečená věta + `[přerušeno]`.

### Soukromí
Zvuk odchází na server **už během nahrávání** (nutné pro živý přepis), ne až po Odeslat; LLM dostane text až podle režimu. Nahrávky se nikde neukládají. Tlačítko to říká v tooltipu.

---

## 8. Rozhraní animace (pro výměnu za jinou postavičku)

Celá zbytek aplikace s obličejem mluví jen přes tyto vlastnosti a metody třídy `Face` (`public/face.js`). Nová animace (Canvas, WebGL, Live2D, Rive, sprite sheet, 3D…) musí implementovat totéž a může zbytek nechat beze změny:

| Člen | Typ | Kdo nastavuje | Význam |
|---|---|---|---|
| `new Face(hostElement)` | konstruktor | app.js | vykreslí se do `#face`, sama si pustí `requestAnimationFrame` smyčku |
| `setEmotion(name)` | metoda | app.js | jedna z 13 emocí; přechod má být plynulý (+ krátký „pop“) |
| `instability` | 0–100 | app.js | deformace každé emoce (viz níže) |
| `talk` | 0–1 | lip sync, ~60×/s | otevření pusy podle hlasitosti |
| `round` | 0–1 | lip sync | 1 = kulatá samohláska (o/u), 0 = široká (e/i) |
| `thinking` | bool | app.js | čeká na první větu |
| `searching` | bool | app.js | hledá na internetu |
| `listening` | bool | app.js | nahrává se mikrofon – postava poslouchá |
| `hear` | 0–1 | mikrofon, ~8×/s | hlasitost uživatele (pulzování, naslouchání) |
| `lookAt(x, y)` | −1…1 | app.js | kam se dívat (kurzor, input) |
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

Hodnoty emocí (rozdíl proti základu `erx16 ery26 w46 curve16`):

| Emoce | Klíčové hodnoty |
|---|---|
| happy | ery22 w58 curve30 open6 glow1.2 bob1.4 |
| excited | ery30 w66 curve34 open20 bob2.2 scale1.04 |
| curious | eryL−8 brow−6 w26 curve6 tilt9 |
| love | ery19 w50 curve26 blush1 tilt−5 |
| shy | lookX−7 lookY5 w24 curve10 blush.85 tilt−8 |
| sad | lookY6 brow−22 w34 curve−16 dim.25 |
| lonely | lookY9 brow−16 w26 curve−8 dim.4 scale.95 |
| scared | erx13 ery33 brow−18 curve−6 open14 shake.8 |
| jealous | ery12 lookX8 brow14 red.2 |
| angry | ery14 brow28 curve−12 open7 red.45 shake1.6 |
| unhinged | erx10 ery31 w104 curve46 open26 teeth1 red1 shake1.3 |
| whisper | ery15 w22 curve8 open6 dim.35 scale1.08 |

Nestabilita navíc: `w += i·34`, `curve += i·12`, `red ≥ (inst−45)/55`, `teeth ≥ (inst−70)/30`, víc třesu nad 60; mrkání je tím vzácnější, čím vyšší nestabilita (zírá). Barva těla se míchá ze žluté do tmavě oranžovo-rudé podle `red·0,7 + dim`.

### Lip sync (`app.js → lipLoop`)
Audio jde přes `AnalyserNode` (fftSize 1024):
- `talk` = RMS časového průběhu, `clamp((rms − 0,008)·8)`, náběh 0,55 / doznívání 0,25
- `round` = spektrální těžiště 250–4000 Hz → `1 − (centroid − 700)/1400`
- na obličeji: `open += talk·(24 − round·6)`, `w −= talk·round·18`

Funguje s jakýmkoli hlasem bez fonémů. Pro přesnější lip sync lze přidat visemy (např. Rhubarb Lip Sync) – TTS vrací celé WAV, takže je lze spočítat na serveru.

---

## 9. Hlas (TTS)

### Současné nastavení (`config.json → tts`)
```json
{ "mode": "clone",
  "speaker_wav": "/path/to/omnivoice/references/verity_cs.wav",
  "reference_text": "Ahoj! Konečně jsi tady. Čekala jsem na tebe tak dlouho. Víš, že je skoro půlnoc? Zůstaň se mnou, prosím.",
  "language": "cs", "num_step": 32, "seed": 4242, "speed": 1.0,
  "emotions": { "sad": {"speed": 0.92}, "lonely": {"speed": 0.88}, "excited": {"speed": 1.12}, "...": {} } }
```
Reference `verity_cs.wav` je vzorek, který OmniVoice vygeneroval v design režimu (`instruct: "female, teenager, high pitch"`, seed 4242) a který uživatel vybral. Klonováním z něj je hlas stabilní a stejný ve všech větách. Emoce mění jen tempo. Generování ≈ 1–1,4 s na větu.

### Ponaučení
1. **Reference musí být ve stejném jazyce jako výstup.** Anglická reference (`verity.wav`) → čeština s anglickým přízvukem. Navíc byla přebuzená (špička 1,0) a končila reklamní větou.
2. **Režim `design` (bez reference) občas vygeneruje šum** – hlavně `whisper` a velmi krátké věty („Ano.“, „To nic.“). Naměřeno: spektrální plochost 0,39–0,53 u šumu vs ~0,1 u řeči. Klon z české reference byl ve 20/20 větách čistý.
3. Pokud reference nemá přepis, OmniVoice ho poprvé udělá přes Whisper na CPU (~25 s), pak je v cache.

### Ochrana proti šumu (`audioLooksBroken` v server.js)
Odmítne výstup, když: medián zero-crossing rate aktivních rámců > 0,3 (šum), špička RMS < 0,01 (ticho), nebo délka > 2 s + 0,25 s/znak. Pak nový pokus s `seed+1`, `seed+2`. Pokusy se logují (`[tts]` v logu serveru).

### Změna hlasu
1. Nahraj 3–10 s **čisté řeči v cílovém jazyce** (bez hudby, nepřebuzené) do složky referencí TTS služby.
2. V `config.json` nastav `speaker_wav` a `reference_text` (přesný přepis; prázdný = Whisper).
3. Restartuj server.

---

## 10. Paměť

Vše je v `localStorage` prohlížeče (klíče `verity.*`). Každý prohlížeč a zařízení má vlastní Verity.

| Klíč | Obsah |
|---|---|
| `verity.history` | celá historie `{role, content, at}` (max 5 000 zpráv), včetně značek a událostí |
| `verity.memory` | `{facts: [string], diary: [{text, at}], windowStart: number}` |
| `verity.inst`, `verity.visits`, `verity.lastSeen`, `verity.voice`, `verity.meter` | nestabilita, počet návštěv, poslední aktivita, nastavení |

### Jak to funguje
- **Pracovní okno**: modelu jde `history.slice(windowStart)`. Když přeroste 80 zpráv, nejstarších 40 se na pozadí pošle na `/api/summarize` → zápis do deníku + chybějící fakta, a `windowStart += 40`. Okno tedy skáče po 40 zprávách (ne po jedné), takže začátek promptu zůstává většinu tahů stejný a drží se cache.
- **Fakta**: model je zapisuje sám (`[pamatuj: …]`), deník doplňuje ta, která přeskočil. Max 80, deduplikace bez ohledu na velikost písmen.
- **Deník**: max 40 zápisů (≈ 1 600 rozhovorových zpráv), nejstarší se zahazují.
- **Panel „Paměť…“** v menu ⋮: fakta (lze mazat ×), deník, počty, **záloha/obnova do JSON souboru**.
- „Zapomenout všechno“ smaže historii, paměť, nestabilitu i návštěvy.

### Proč ne celých 220k tokenů kontextu
Slot je jen jeden a sdílí ho i další aplikace. Každý jejich požadavek přepíše KV cache; 120k tokenů Verity by se pak přepočítávalo ~2,5 minuty a po tu dobu by blokovalo ostatní. Okno 40–80 zpráv + fakta + deník se studené přepočítá za pár sekund. llama-server má navíc `--cache-ram 2048` a kontrolní body kontextu, které pomáhají obnovit prefix.

---

## 11. Provoz

```bash
cp config.example.json config.json   # doplň adresy služeb
node server.js                       # nebo: pm2 start server.js --name verity && pm2 save
pm2 logs verity                      # logy (včetně opakovaných TTS pokusů: grep "\[tts\]")
```

Reverzní proxy (Apache):
```apache
RedirectMatch 302 ^/verity(\.php)?$ /verity/
ProxyPass        /verity/ http://127.0.0.1:3700/ flushpackets=on timeout=300
ProxyPassReverse /verity/ http://127.0.0.1:3700/
```
`flushpackets=on` je nutné pro plynulé SSE. Frontend používá **relativní** cesty (`api/chat`), takže funguje pod `/verity/` i přímo na portu Node serveru.

Rychlé testy:
```bash
curl -s localhost:3700/api/status
curl -sN localhost:3700/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"ahoj"}]}'
curl -s localhost:3700/api/tts -H 'Content-Type: application/json' -d '{"text":"Ahoj.","emotion":"happy"}' -o /tmp/t.wav
```

---

## 12. Známá omezení

- **Veřejné bez přihlášení** – limity na IP brzdí zneužití, ale kdokoli s odkazem pořád zatěžuje sdílené GPU (3090 pro LLM a TTS, 1660 SUPER pro Whisper).
- **Whisper je jedna fronta pro víc aplikací** – když přepisuje někdo jiný, přepis chvíli čeká (429 → opakování).
- **Detekce pauzy je podle hlasitosti**, ne podle smyslu věty – hluk nebo velmi tichý hlas ji mohou zmást; pak pomůže ruční režim.
- **Skutečný mikrofon** (hlavně na telefonu) je potřeba vyzkoušet – testy používaly podstrčenou nahrávku.
- **Vyhledávání**: SearXNG je teď blokovaný CAPTCHou (DuckDuckGo), padá se na Mojeek/DDGS → výsledky bývají slabé.
- **Čeština modelu**: občas chyba ve skloňování.
- **Paměť jen v prohlížeči** – vymazání dat prohlížeče = zapomenutí (proto záloha do souboru).
- **Jeden slot LLM** – když zrovna počítá jiná aplikace, Verity čeká ve frontě.
- Emoce nemění barvu hlasu (klon OmniVoice nepodporuje `instruct`).

---

## 13. Doporučení pro reimplementaci s jinou animací

1. Zachovej **protokol značek** (kap. 4) a **rozhraní `Face`** (kap. 8) – pak lze `face.js` vyměnit bez zásahu jinam.
2. Emoce ber jako **spojité parametry s interpolací**, ne jako přepínání obrázků – přechody uprostřed věty jsou to, co postavu oživuje.
3. Nestabilitu aplikuj jako **globální deformaci** nad každou emocí (ne jako samostatnou emoci) – i „happy“ při 90 musí vypadat špatně.
4. Lip sync řiď z **reálného audia** (RMS + spektrální těžiště), ne z textu – synchronizace je zadarmo a funguje s jakýmkoli TTS.
5. TTS **po větách** s předgenerováním další věty; první věta rozhoduje o vnímané latenci.
6. Proměnlivý kontext dávej **na konec promptu**, jinak se ztratí prompt cache.
7. „Vševědoucnost“ dělej z **reálných signálů prohlížeče** (čas, odchody ze záložky, nečinnost, zařízení) – působí to děsivěji než vymyšlené detaily a nic se nevymýšlí.
8. TTS reference vždy v **cílovém jazyce**, čistá, 3–10 s, a výstup kontroluj na šum.
9. Mikrofon: PCM přes AudioWorklet a **samostatné WAV snímky**, ne kusy z MediaRecorderu; jeden přepis najednou; závěrečný průchod přesnější než průběžný.
10. **Přerušení přes epochy**: každá odpověď má číslo, zastavení ho zvýší a vše opožděné ze staré odpovědi se zahodí. Do historie ukládej jen to, co postava opravdu řekla.
11. Za reverzní proxy ber IP klienta z `X-Forwarded-For`, jinak limity platí pro všechny dohromady.
