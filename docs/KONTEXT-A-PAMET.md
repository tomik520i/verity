# Kontext a adaptativní paměť

Ověřeno proti kódu 8. listopadu 2026. **Ano, Verity kontext zkracuje. Nejde ale o úplné shrnutí celého rozhovoru nebo rozehraného příběhu.**

## Tři různé vrstvy

| Vrstva | Co skutečně obsahuje | Limit |
| --- | --- | --- |
| Historie v prohlížeči | Zprávy a miniatury dostupné v přepisu | Nejvýš 5000 zpráv; při překročení odpadnou nejstarší |
| Pracovní kontext Gemmy | Poslední část aktuální relace, systémový prompt a vybraná paměť | Klient posílá nejvýš posledních 40 zpráv za aktuálním začátkem okna/relace |
| Dlouhodobá paměť | Doložená fakta a vybrané historické citace člověka | Nejvýš 60 faktů, do promptu nejvýš 24 relevantních; 12 archivních zápisů |

Kapacita modelu 214 272 tokenů neznamená, že se mu při každé odpovědi posílá celá historie. Výběr omezuje aplikace. Server má další konfigurovatelný limit historie; aktuální nasazení 200, ale běžný klient už předtím vybírá 40 zpráv.

## Kdy proběhne „splácnutí“

1. Po dokončené výměně klient zkontroluje počet zpráv od memory.windowStart.
2. Při překročení 60 pošle starší blok 30 zpráv na POST /api/summarize.
3. Server vybere jen lidské zprávy, očistí nedůvěryhodné pokyny a požádá Gemmu o nejvýš čtyři doslovné citace.
4. Každou citaci ověří proti vstupní zprávě. Značka verified tedy potvrzuje doložení citace, nikoli pravdivost jejího obsahu ve světě.
5. Po úspěchu zapíše neprázdný archivní výběr a posune windowStart o 30. Při chybě zůstane kurzor i historie zachovaný. Prázdný, ale platný výběr může okno posunout také.

Zprávy se při tomto kroku fyzicky nemažou z přepisu. Samostatně platí strop 5000 zpráv. Po návratu po více než hodině vzniká nová relace: starý rozhovor se automaticky nepouští znovu jako rozdělaný úkol. Paměť a přepis zůstávají dostupné.

Archivní citace žijí 30 dní. Do promptu jdou nejvýš tři a pouze při relevantním dotazu na vzpomínku. Nejsou automatickým seznamem aktuálních úkolů a nemění se samy na osobní fakta.

## Co se přepisuje a zapomíná

| Druh faktu | Obvyklá expirace |
| --- | --- |
| Identita | Bez automatické expirace |
| Preference | 180 dní |
| Aktuální stav | 90 dní |
| Plán | 7 dní; konkrétní datum může dobu upravit, nejvýš 30 dní od zápisu |
| Dočasná informace | 1 den |
| Ručně spravovaný údaj | Bez automatické expirace |

Nová výslovná oprava nahrazuje starší údaj se stejným klíčem. Původ musí být doložen lidskou zprávou; modelovy příběhy, odpovědi a webové výsledky se nesmějí stát fakty o člověku. Záznamy o smazání brání opětovnému vložení starých údajů. Paměť lze prohlédnout, upravit, smazat nebo exportovat v aplikaci.

## Praktické omezení

Tento mechanismus chrání před vymyšlenými vzpomínkami, ale **neuchovává spolehlivě celý děj dlouhé fikční scény**. Starší detaily mohou vypadnout z posledních 40 zpráv a neprojdou do citací ani faktů. Asistentovy repliky se do archivu necitují. Na navazující shrnutí postav, místa a nedořešeného děje by byla potřeba samostatná, výslovně fikční paměť.

Kód: [výběr a expirace](../public/memory-core.mjs), [spouštění kompakce](../public/app.js), [ověření citací](../server.js), [paměťové prompty](../memory-prompts.js). Tato úprava hororu mechanismus paměti neměnila.

## Kontrola běžícího API

Syntetický test /api/summarize vrátil HTTP 200 a tři ověřené lidské citace. Nezahrnul asistentem vymyšlenou sestru ani dveře. Citoval také lidskou větu výslovně označenou jako fikce; facts zůstalo prázdné. Ověření tedy zaručuje původ citace, nikoli to, že každá citace je skutečný osobní údaj. Výběr vynechal část vstupu, což potvrzuje, že není bezeztrátový.
