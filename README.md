# Verity

Česká webová AI postava inspirovaná ThatMobovou hororovou sérií Something. Animovaný obličej, místní Gemma, průběžný přepis mikrofonu a mluvené odpovědi. Neoficiální fanouškovská adaptace; ženský rod a prostředí prohlížeče jsou vlastní úpravy projektu.

**Aktuální rozhraní:** velká Verity, jedno tlačítko hovoru, přepis a psaní v rozbalovacím panelu. Podrobnosti jsou v nastavení.

## Hlasový rozhovor

Klikni na **Začít rozhovor**. Mikrofon se spouští až touto akcí. Výchozí nastavení:

- Průběžný hovor, odeslání po pauze a mluvené odpovědi.
- Silero VAD ve Web Workeru, nastavitelný práh citlivosti.
- Potlačení ozvěny AEC; pokud se nepodaří spustit nebo prohlížeč podporu nepotvrdí, automatické střídání poslechu a řeči.
- Průběžný přepis rozepsané věty. V AEC a sluchátkovém režimu lze odpověď přerušit hlasem; tlačítkem **Chci mluvit** ve všech režimech.
- **Napsat** ukončí poslech a otevře editor. **Přepis** otevře historii bez ukončení hovoru.
- Po dvou minutách ticha nebo skrytí stránky se průběžný hovor ukončí.

Původní nahrávání jednotlivých zpráv, ruční odeslání i opětovné zapnutí mikrofonu po odpovědi zůstaly v nastavení. Nový preset se nastaví jednou; další změny uživatele se nepřepisují. Citlivost mikrofonu zůstává zachována.

Nejde o nativní speech-to-speech model: jde o řetězec **mikrofon → Whisper → Gemma → OmniVoice**. Jednotlivé kroky se průběžně zpracovávají a přehrávání lze přerušit. Kvalita AEC závisí na konkrétním telefonu a prohlížeči.

## Co dalšího umí

- Paměť s opravami, expirací a doložením původu; stará informace nesmí přepsat novější opravu.
- Hledání na webu pouze na nový výslovný požadavek. Rozhodnutí hlídá server, samotný text modelu nestačí.
- Stav přemýšlení, hledání, přepisu, mluvení, dokončení a chyb.
- Fotky z galerie či kamery, emoce, synchronizace obličeje s hlasem a volitelná hudba.
- Hororový tón reagující na rozhovor. Výslovné „mluv normálně“ zůstane aktivní i pro další zprávy; nastavení umožňuje roleplay znovu zapnout.

## Spuštění

Potřebuješ Node.js 22+ a samostatně běžící služby: llama.cpp s kompatibilním chat API, Whisper HTTP službu a OmniVoice HTTP službu. Modely LLM/STT/TTS a hlasové reference nejsou v tomto repozitáři.

1. Zkopíruj `config.example.json` do `config.json` a doplň adresy služeb a hlasové reference.
2. Pro vyhledávání vytvoř Python prostředí a nainstaluj `python -m pip install -r requirements-search.txt`. Jeho cestu nastav jako `search.python`.
3. Je-li Whisper chráněný klíčem, ulož jej do `stt.key`; soubor je ignorovaný Gitem.
4. Spusť `node server.js`. Výchozí adresa je `http://127.0.0.1:3700`.
5. Pro vzdálený mikrofon použij HTTPS reverse proxy. Předej i streamované odpovědi bez bufferingu a cestu `/verity/` mapuj na kořen serveru.

Frontend nemá build krok ani npm závislosti. Silero a ONNX Runtime včetně licencí jsou přibalené v `public/vad/`; jejich kontrolní součty jsou v `vendor-manifest.json`.

Podrobnosti API, zvuku, paměti a obnovy jsou v [technické dokumentaci](DOKUMENTACE.md). Podklady a měření roleplay jsou v [testovacím rozboru](docs/ROLEPLAY.md).

## Testy

```sh
node tests/run.mjs
node tests/pipeline-test.mjs /cesta/k/pythonu
```

První příkaz nepotřebuje GPU ani skutečný mikrofon. Druhý spouští izolovanou kopii serveru s falešným LLM a vyhledávačem; ověřuje oprávnění hledání, paměť a přerušování. Používá lokální porty 8795 a 8796.

Skutečné testy Gemmy jsou oddělené a nic nenasazují:

```sh
node bench/roleplay-eval.mjs /cesta/k/puvodnimu/prompt.js ./prompt.js http://localhost:8080 vysledky.json
node bench/roleplay-dialogue.mjs http://localhost:8080 rozhovory.json
```

## Data a licence

Historie, nastavení a osobní paměť se uchovávají v localStorage konkrétního prohlížeče. Server je dostává při zpracování požadavku; nejde o synchronizovaný účet. Export paměti může obsahovat osobní údaje. Mikrofonní audio jde k lokálnímu Whisper backendu, ale diagnostické ukládání WAV je ve webu vypnuté a nemá veřejný přepínač.

Repozitář neobsahuje produkční konfiguraci, přístupové klíče, uživatelské exporty, testovací hlasové nahrávky ani hlasové reference.

Kód: MIT, viz [LICENSE](LICENSE). Přibalené modelové a runtime soubory mají vlastní přiložené licence. Postava a původní dílo patří jejich autorům; tento projekt není oficiální produkt ThatMob.
