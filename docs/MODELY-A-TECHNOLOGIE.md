# Modely a technologie Verity

Inventář ověřený proti běžícím službám a zdrojům **8. listopadu 2026**. Jde o současné nasazení, nikoli o povinné verze pro každou instalaci. Přesné revize, které nelze doložit, jsou výslovně označené.

## Modely

| Úloha | Použitý model / soubor | Kde a jak běží |
| --- | --- | --- |
| Rozhovor, roleplay, plánování hledání, práce s pamětí | Gemma 4 26B A4B IT, upravená varianta `gemma-4-26B-A4B-it-ultra-uncensored-heretic-Q5_K_S.gguf` | Ubuntu, RTX 3090, llama.cpp, GGUF Q5_K_S |
| Obrazový adaptér Gemmy | `gemma-4-26B-A4B-it-mmproj-BF16.gguf` | Stejný llama-server; propojuje obrazový vstup s LLM |
| Přepis češtiny | `mobiuslabsgmbh/faster-whisper-large-v3-turbo` | Windows, GTX 1660 SUPER, CUDA, `int8_float32` |
| Detekce řeči | Silero VAD v5, `silero_vad_v5.onnx` | Prohlížeč, ONNX Runtime Web ve Web Workeru, lokální inference |
| Syntéza hlasu | OmniVoice; lokální modelová karta identifikuje `k2-fsa/OmniVoice` | Ubuntu, RTX 3090, PyTorch FP16, attention SDPA |
| Základ textové části OmniVoice | `Qwen/Qwen3-0.6B`, uvedený v kartě TTS modelu; tokenizer Qwen2Tokenizer | Součást OmniVoice, nikoli samostatný chatbot |
| Zvukový tokenizér / dekodér OmniVoice | `eustlb/higgs-audio-v2-tokenizer`, třída HiggsAudioV2TokenizerModel | Načítá jej kód OmniVoice; převod mezi zvukem a zvukovými tokeny |
| Volitelný přepis TTS reference | Whisper large-v3-turbo | CPU int8 v hlasové službě, pouze když chybí reference_text; nejde o přepis mikrofonu |
| Hlas Verity | Referenční `verity_cs.wav`, šepot `verity_whisper.wav` a jejich přepisy | Voice cloning v OmniVoice; reference není v GitHubu |

Přepisový checkpoint má lokální snapshot `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf`. Přesná upstream revize upravené Gemmy, projektoru, OmniVoice a jeho kodeku není z nasazení doložená; názvy souborů nejsou náhradou za hash checkpointu. OmniVoice reference vznikla voice designem (female, teenager, high pitch, seed 4242); provoz používá klonování, základní rychlost 1 a 32 kroků, s úpravami podle emocí.

Starší zmínka o Qwenu jako hlavním konverzačním modelu už současnému nasazení neodpovídá. Qwen je zde pouze doložený základ hlasového modelu. Není zapojen samostatný embedding model, reranker, cloudový Realtime model ani neuronový model pro potlačení ozvěny.

Silero: 2 327 524 B, SHA-256 `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`. Úplné hashe přibaleného browser runtime a licence uvádí [vendor-manifest.json](../vendor-manifest.json).

## Běhové prostředí

| Část | Ověřené verze a nastavení |
| --- | --- |
| Webové API | Node.js 18.19.1, vestavěné moduly; PM2 6.0.10. Pro novou instalaci README doporučuje Node.js 22+ |
| HTTPS reverse proxy | Apache 2.4.58 na Ubuntu |
| LLM server | llama.cpp 0.7.0-dev, build 1, commit `f3fb2fc`; kontext 214 272 tokenů, parallel 1, GPU layers 999, KV cache K/V q4_0 |
| Windows STT | Python 3.12.14, faster-whisper 1.2.1, CTranslate2 4.8.2, PyAV 16.0.1, ONNX Runtime 1.31.0 |
| STT HTTP | FastAPI 0.143.0, uvicorn 0.54.0; port 8767 |
| STT CUDA knihovny | nvidia-cublas-cu12 12.9.2.10, nvidia-cudnn-cu12 9.27.0.42 |
| TTS | Python 3.12.3, torch a torchaudio 2.8.0+cu128, transformers 5.3.0, Flask 3.1.3; port 5000 |
| Browser VAD | onnxruntime-web 1.31.1, lokální WASM, jedno inference vlákno uvnitř workeru |
| Vyhledávání | SearXNG 2025.9.11+7c1ebc0; Python requests 2.32.5, beautifulsoup4 4.13.5, ddgs 9.5.5, readability-lxml 0.8.4.1 |

LLM používá port 8080, webové API 3700. Porty hlasových služeb jsou interní; veřejný klient používá API webu přes HTTPS. Adresy, klíče a soukromé cesty do tohoto inventáře nepatří.

## Technologie v prohlížeči a tok dat

Frontend tvoří HTML, CSS, JavaScript ES moduly a SVG obličej. Nemá framework ani build krok. Používá getUserMedia, Web Audio, AudioWorklet, Web Worker, WASM, Canvas pro přípravu fotek, Screen Wake Lock a localStorage. Text server posílá jako SSE; klient jej čte přes ReadableStream.getReader().

```text
mikrofon v nativní frekvenci
  → AudioWorklet + FIR převzorkování na 16 kHz
  → Silero ve workeru + uživatelský práh dBFS
  → průběžný / finální Whisper přepis
  → Gemma + pravidla osobnosti, paměti a oprávnění hledat
  → textové segmenty → OmniVoice → WAV → Web Audio + animace
```

Whisper pracuje v češtině, s beam size 1 pro průběžný a 3 pro finální přepis. Běží jeden modelový worker, čtyři CPU vlákna; condition_on_previous_text je vypnuté. Vnitřní VAD faster-whisper používá min_silence_duration_ms 350 a speech_pad_ms 200.

AEC zajišťuje prohlížeč s místní WebRTC výstupní smyčkou. Smyčka nepoužívá STUN/TURN. Záložní režim střídá řeč a poslech. Test mikrofonu v nastavení používá stejný vstup a VAD, ale končí u měřáku: bez přepisu, odeslání zvuku a ukládání nahrávky.

Paměť je strukturovaný JSON s původem, změnami a expirací v localStorage, bez vektorové databáze. Hledání používá SearXNG a čtení webových stránek; server povoluje hledání pouze podle aktuálního výslovného požadavku.

## Obrázky

Galerie umožňuje hromadný výběr; přidávat lze i další sady, vložením nebo přetažením. **Limit aplikace je 10 obrázků na zprávu**. Nejde o tvrzení, že model má pevný limit právě 10. Každý vstup se zmenší na nejvýše 1280 px a JPEG; do historie jdou jen miniatury 160 px, plná obrazová data jen s aktuální zprávou.

API přijímá `images: [dataURL, ...]`; starší `image: dataURL` zůstává podporováno. Povolené jsou JPEG/PNG/WebP, nejvýše 8 000 000 znaků na obrázek a 16 MiB znaků dohromady. Celé tělo požadavku má limit 20 MiB. Obrázky se Gemmě předávají jednotlivě v původním pořadí před textem; neslepují se do koláže. Model může detail přehlédnout, zejména na malém textu nebo složité sadě.

Ověření 8. 11. 2026 na místním LLM: sady 5 a 10 očíslovaných karet vrátily správně všechna čísla v pořadí (7,84 s a 12,37 s). To ověřuje příjem a jednoduché čtení sady, nikoli bezchybnost analýzy skutečných fotografií. V prvním testu jednobarevných ploch model ve výčtu vynechal poslední bílou plochu, přestože požadavek přijal.

## Zdroje a obsah repozitáře

- [Gemma 4: modelová karta Google](https://ai.google.dev/gemma/docs/core/model_card_4) — rodina modelu, obrazový vstup a doporučené pořadí obrázků před textem; nejde o kartu konkrétní heretic úpravy.
- [llama.cpp](https://github.com/ggml-org/llama.cpp) — lokální LLM server.
- [OmniVoice](https://github.com/k2-fsa/OmniVoice) — upstream uvedený v lokální modelové kartě.
- [Technická dokumentace Verity](../DOKUMENTACE.md) — lifecycle hlasu, titulky, API, soukromí a obnova.

Repozitář obsahuje web, Node proxy, Python vyhledávání, testy a přibalený Silero/ONNX browser runtime. Instalace a váhy LLM/STT/TTS, hlasová reference, konfigurace služeb, klíče a osobní záznamy jsou mimo repozitář. Samotný clone GitHubu proto nenainstaluje celý GPU stack; soukromé adresy se doplňují podle config.example.json.
