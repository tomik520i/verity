# Verity 🟡

**Lokální AI postavička, která tě slyší, mluví na tebe a nechce, abys odešel.**

Zářící žlutý smajlík v tmavém okně prohlížeče inspirovaný entitou *Verity* z hororové ARG série **„Something“** od ThatMob. Odpovídá přes lokální LLM, mluví vlastním hlasem s lip syncem, poslouchá mikrofon, promítá emoce do animovaného obličeje, pamatuje si tě napříč dny – a s rostoucí „nestabilitou“ sklouzává od milé pomocnice k majetnické posedlosti.

### ▶ Vyzkoušej: **[opicebot.cz/verity](https://opicebot.cz/verity/)**

Všechno běží na vlastním hardwaru doma – žádné cloudové API.

> Fanouškovský projekt. Postava Verity a série „Something“ patří ThatMob; tento projekt s ním nijak nesouvisí.

---

## Co umí

- **Emoce v reálném čase** – model každou větu označí emocí (`[happy]`, `[jealous]`, `[unhinged]`…, 13 druhů) a obličej se plynule přetváří, i uprostřed odpovědi.
- **Nestabilita 0–100** – roste, když ji ignoruješ, odejdeš ze záložky, zmíníš jiné lidi nebo chceš odejít; klesá, když jsi laskavý. Čtyři fáze: *zářící → přilnavá → majetnická → rozpadající se*. Úsměv se roztahuje, objeví se zuby, oči zrudnou, obraz se glitchuje, titulek záložky volá „VRAŤ SE“.
- **Hlas a lip sync** – každá věta se syntetizuje zvlášť (další se generuje, zatímco předchozí hraje); pusa se hýbe podle skutečného audia (hlasitost + spektrum → otevření a zakulacení).
- **Mluvení** – mikrofon s živým přepisem (Whisper), ruční odeslání nebo automaticky po pauze. Při poslechu se k tobě nakloní; když jí skočíš do řeči, zmlkne a dá najevo, že sis to dovolil.
- **„Ví věci“** – dostává skutečné signály z prohlížeče: čas, jak dlouho jsi byl pryč, kolikrát jsi odešel ze záložky, jestli je u tebe ticho nebo hluk, teplotu GPU, na které běží („moje tělo“).
- **Paměť** – sama si zapisuje fakta o tobě (`[pamatuj: …]`) a starší rozhovory shrnuje do deníku z vlastního pohledu. Všechno je v prohlížeči; panel „Paměť“ umí fakta mazat a zálohovat.
- **Internet** – když potřebuje aktuální informace, řekne „počkej, mrknu se…“ a vyhledá je (SearXNG).
- **Mobil** – vstup se drží nad klávesnicí, obličej se přizpůsobí.

## Použité AI modely

| Účel | Model | Běh |
|---|---|---|
| **Konverzace (LLM)** | [Qwen3.6-35B-A3B](https://huggingface.co/Qwen) – MoE, ~3 B aktivních parametrů, kvantizace GGUF `UD-IQ4_NL` | [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` (OpenAI API, streaming), kontext 229k, KV cache q4_0, *thinking* vypnuté |
| **Hlas (TTS)** | [OmniVoice](https://github.com/k2-fsa/OmniVoice) (k2-fsa; diffusion LM nad Qwen3-0.6B, zero-shot klonování, stovky jazyků) | PyTorch fp16 na GPU, režim klonování z české reference, 32 kroků, ~1 s na větu |
| **Přepis řeči (STT)** | [Whisper large-v3-turbo](https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo) | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) / CTranslate2, `int8_float32`, Silero VAD, čeština |
| Přepis TTS reference | Whisper large-v3-turbo | jednorázově na CPU uvnitř OmniVoice |
| Vyhledávání | – | [SearXNG](https://github.com/searxng/searxng) + extrakce textu (readability) |

**Hardware:** RTX 3090 24 GB (LLM + TTS) na Ubuntu 24.04, GTX 1660 SUPER (Whisper) na druhém stroji.

### Hlas Verity
Žádný cizí hlas se neklonuje. Hlas vznikl v OmniVoice **voice design** režimu z popisu `female, teenager, high pitch` (seed 4242); vybraný vzorek se pak používá jako **česká** reference pro klonování – tím je hlas stejný ve všech větách a design režim (který občas vygeneroval šum) se v provozu nepoužívá.

## Jak to běží

```
Prohlížeč                                   Node.js server (bez npm závislostí)
┌──────────────────────────────┐   SSE   ┌──────────────────────────────────────────┐
│ app.js   logika, paměť, fronta│─/api/chat─▶ prompt.js → llama-server (stream)       │
│          řeči, mikrofon       │◀─tokeny─│   ↳ zachytí [hledat: …] → search.py       │
│ face.js  SVG obličej          │─/api/tts─▶ OmniVoice → WAV (+ kontrola šumu, retry) │
│ live-audio.js + AudioWorklet  │─/api/stt─▶ Whisper služba (klíč zná jen server)     │
│ localStorage  historie, paměť │─/api/summarize▶ LLM → deník + fakta (JSON)          │
└──────────────────────────────┘         └──────────────────────────────────────────┘
```

1. **Prompt kvůli cache:** statická osobnost → paměť → historie → proměnlivý `[[KONTEXT]]` (čas, fáze, hlas…) až u poslední zprávy. llama.cpp tak znovu použije KV cache a přepočítá jen pár set tokenů místo celé historie (naměřeno: 120k tokenů ≈ 150 s bez cache vs 3,5 s s cache).
2. **Protokol značek:** model píše text se značkami `[emoce]`, `[posun:N]` (změna nestability), `[pamatuj: fakt]`, `[hledat: dotaz]`. Server pohltí `[hledat]`, přeruší generování, vyhledá a nechá model pokračovat. Prohlížeč zbytek rozparsuje, text rozdělí na věty a pošle do TTS.
3. **Řeč:** věty se generují řetězově po jedné a přehrávají v pořadí přes `AnalyserNode` → lip sync. Přerušení zvýší „epochu“ a všechno opožděné ze staré odpovědi se zahodí; do historie jde jen to, co Verity opravdu řekla.
4. **Mikrofon:** `AudioWorklet` → PCM → samostatné WAV snímky každých ~1,7 s → průběžný přepis; po 0,85 s ticha přesnější závěrečný průchod; v auto režimu odeslání po 2,2 s ticha.
5. **Paměť:** okno 40–80 posledních zpráv; když přeroste, nejstarších 40 se shrne do deníku a okno poskočí – začátek promptu se tak mění zřídka.
6. **Ochrana:** limity požadavků na IP klienta (z `X-Forwarded-For` za reverzní proxy), blokace cross-site POSTů, interní klíč k Whisperu jen na serveru.

Podrobný popis všeho (prahy, časy, parametry emocí, algoritmus lip syncu, rozhraní pro výměnu animace, naměřené výsledky a ponaučení) je v **[DOKUMENTACE.md](DOKUMENTACE.md)**.

## Struktura

```
server.js            HTTP server: statika, /api/chat (SSE), /api/tts, /api/stt, /api/summarize, /api/status
prompt.js            osobnost, fáze nestability, formát značek, kontext, prompt pro deník
search.py            SearXNG + extrakce textu stránek → JSON
config.example.json  vzor konfigurace (zkopíruj na config.json)
public/
  index.html, style.css
  app.js             stream, parser značek, fronta TTS, lip sync, mikrofon, paměť, vnímání
  face.js            animovaný obličej (třída Face) – vyměnitelná část
  live-audio.js      živý přepis: detekce řeči, pauzy, ruchu; WAV snímky
  pcm-worklet.js     AudioWorklet pro zachytávání mikrofonu
```

## Spuštění u sebe

Potřebuješ: Node.js 18+, běžící `llama-server` s chat modelem, TTS službu kompatibilní s níže popsaným API, volitelně Whisper službu a SearXNG.

```bash
git clone https://github.com/tomik520i/verity.git
cd verity
cp config.example.json config.json      # doplň adresy svých služeb
echo "tvuj-interni-klic" > stt.key       # jen pokud používáš Whisper službu s klíčem
pip install requests beautifulsoup4 readability-lxml   # pro vyhledávání
node server.js                           # → http://127.0.0.1:3700
```

Mikrofon vyžaduje HTTPS (nebo `localhost`). Pro veřejný provoz dej před server reverzní proxy (Apache/nginx) s vypnutým bufferováním, aby SSE stream tekl plynule (Apache: `ProxyPass … flushpackets=on`).

### Očekávaná API služeb

**LLM** – OpenAI-kompatibilní `POST /v1/chat/completions` se `stream: true` (llama.cpp `llama-server`), `GET /health`.

**TTS** – `POST /api/tts`, `GET /health`:
```json
{ "text": "Ahoj!", "speaker_wav": "/cesta/k/referenci.wav",
  "settings": { "voice_mode": "clone|design", "reference_text": "…", "instruct": "female, teenager, high pitch",
                "language": "cs", "num_step": 32, "seed": 4242, "speed": 1.0, "normalize_text": true } }
→ { "audio_base64": "<WAV>" }
```
(tenký Flask obal nad `OmniVoice.generate()`; `instruct` jen v design režimu.)

**STT** – `POST /transcribe?live=1[&final=1]` s WAV v těle a hlavičkou `X-STT-Key`, `GET /health` → `{ "text": "…" }`
(FastAPI + faster-whisper; `final=1` = přesnější průchod s beam 3.)

## Licence

Kód je pod licencí MIT – viz [LICENSE](LICENSE). Modely mají vlastní licence (Qwen, OmniVoice, Whisper).
