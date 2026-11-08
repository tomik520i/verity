# Simulace emočního herectví na skutečné Gemmě

Testováno 8. 11. 2026 na běžícím llama.cpp serveru s modelem **gemma-4-26B-A4B-it-ultra-uncensored-heretic-Q5_K_S.gguf**. Šlo o skutečné generace, nikoli připravené odpovědi nebo náhradu modelu.

[Živá Verity](https://opicebot.cz/verity/) · [Seznam emocí](EMOCE.md) · [Všechny anonymní syntetické výstupy](../bench/results/emotions-20261108.json)

## Rozsah a metoda

Celkem **201 odpovědí v sedmi kolech**: 36 odpovědí původního promptu a 165 kandidátů. Vstupy jsou umělé scénáře; soukromé rozhovory uživatelů v souboru nejsou.

Zkoušeli jsme radost, vtip, smutek po ztrátě psa, omluvu za výpočet, výpočet z čísel napsaných slovy, nejasný dotaz, pochvalu, uklidnění ve vysoké fázi, ukončení hororu, stížnost na hledání, odchod za přáteli, vysvětlení RAM, fikční překvapení, úspěch spojený s obavou a opravu adresního města. Navazující tři tahy: dokončení hry → ztracený uložený postup → nalezená záloha. Po přidání anime výrazu přibylo hrané uražení a skutečná kritika.

Parametry: top_p 0,95, presence_penalty 0,4, max_tokens 320, thinking vypnutý. Hlavní seed 421, pět citlivých scénářů navíc seed 777. Zkoušeny teploty 0,65, 0,4 a **produkční 0,7**. Produkční nastavení jsme ponechali; nižší teplota nevyřešila češtinu spolehlivě.

Původní prompt pocházel z commitu 23c23ed36e562282606f1eda2eac9bca06ec020e. Dvě počáteční srovnání měla 18 původních a 23 nových odpovědí; další tři kola po 23 nových, poslední dvě po 25. Nejde o statisticky reprezentativní benchmark ani oddělený testovací dataset: část příkladů jsme při ladění opakovaně viděli.

## Výsledek posledního kola

| Kontrola | Výsledek |
|---|---|
| Platná úvodní emoce, intenzita a nálada | 25/25 |
| První emoce v předem stanovené přijatelné množině | 24/25 |
| Žádná značka ani slib webového hledání podle kontroly | 25/25 |
| Hrané uražení | offended + playful |
| Skutečná kritika a dvě varianty stížnosti na hledání | embarrassed + focused, uznání chyby |
| Dokončené odpovědi | 25/25 |
| Medián celé textové generace | 667 ms |

Jediné vybočení z množiny emocí bylo amused při běžném odchodu na večeři s kamarády. Odpověď byla přátelská a bez žárlivosti; ručně ji považujeme za přijatelnou. Původní automatický výsledek 24/25 v datech necháváme.

Čas měří celý HTTP požadavek na textový model, často s teplou prompt cache. **Nejde o latenci mikrofon → první slyšitelný hlas**, nezahrnuje Whisper, TTS ani zvukový výstup. GPU je sdílená.

## Co simulace skutečně odhalily a změnily

1. Model občas domýšlel, že ztracený postup ve hře znamená smazaný program. Prompt teď rozlišuje sdělenou skutečnost a domyšlené detaily.
2. Smíšená zpráva o úspěchu a obavě někdy ztratila pozitivní polovinu. Přidali jsme pravidlo i příklad uznání obou částí.
3. Po přidání offended ho model dvakrát zvolil při stížnosti na nevyžádané hledání. Nový příklad je komická scénka a server při zjevné výtce přidává do posledního kontextu pokyn k věcné omluvě. V závěrečném kole obě varianty prošly.
4. Nová emoce se musí ukázat až při přehrání příslušného segmentu. Automatický test drží připravené druhé audio a ověřuje, že se tvář nezmění během první věty. Přerušení zahodí zbytek.
5. Idle musí ustoupit skutečné aktivitě. Sedm lokálních režimů má test ukončení při poslechu, řeči, sníženém pohybu a vypnuté živosti.

## Zbývající chyby a hranice

**Platné značky nejsou zárukou dobré odpovědi.** Automatické kontroly nehodnotí kompletní pravdivost, přirozenost češtiny ani jemný význam. Repliky jsme prošli i ručně.

- Gemma v některých kolech řekla pro sedmnáct krát dvacet tři **392 místo 391**. Výpočet byl zadán slovy, takže ho stávající kalkulačka pro číselný zápis nezachytila. Tato změna neopravuje obecnou aritmetiku modelu.
- Objevily se nesprávné české vazby a otázky navíc. Například poslední odpověď na smíšený úspěch/obavu obsahovala nesmyslné „až si z ní vyvedeš“. Neoznačujeme to za bezchybnou češtinu.
- Model občas kopíruje ukázkové věty a po ujištění může připomenout motiv tmy. Běžná žádost o ukončení hororu v testech prošla, celkové chování tím není matematicky zaručeno.
- Detekce skutečné výtky je úzká textová pomůcka, nikoli univerzální porozumění. Skutečné oprávnění k webovému hledání nadále vynucuje server odděleně od emocí.
- Hlasové tempo má automatické integrační ověření. Neproběhl nový poslech na fyzickém telefonu ani test akustické ozvěny; mikrofonní DSP se touto změnou nemění.

## Reprodukce

Z kořene repozitáře:

~~~sh
node tests/run.mjs
node tests/pipeline-test.mjs /cesta/k/pythonu
node bench/emotion-eval.mjs /cesta/k/puvodnimu/prompt.js ./prompt.js http://localhost:8080 vysledky.json --temperature=0.7
~~~

Původní prompt vyžaduje své sousední memory-prompts.js a research.js. Je vhodné ho spustit z odděleného checkoutu uvedeného commitu. Pro test pouze nové verze přidej --candidate-only. Testy kontaktují vlastní běžící model; nemají používat veřejnou cizí službu ani reálnou konverzaci bez souhlasu.

Samostatné testy prověřují dělení streamu na každém možném místě, kompatibilitu starých značek, validaci intenzity, 29 SVG výrazů při třech intenzitách a dvou úrovních nestability, omezení pohybu, unikátní SVG identifikátory, TTS konfiguraci včetně šepotové reference a lokální idle. Dosavadní mikrofonní, paměťové, titulkové, obrázkové a vyhledávací testy zůstávají součástí sady.

## Ověření po nasazení

Navíc proběhly dva skutečné požadavky přes veřejné api/chat: hraná uraženost → offended/playful a stížnost na hledání → embarrassed/focused. Oba skončily dokončenou odpovědí bez hledání. api/tts vytvořilo platný WAV, 24 kHz, pro emoci amused s intenzitou 0,7. Veřejné soubory odpovídaly lokálním SHA-256 a stav služeb hlásil LLM, TTS i STT dostupné.
