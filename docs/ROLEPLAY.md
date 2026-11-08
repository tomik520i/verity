# Roleplay Verity: podklady a ověření
8. listopadu 2026

## Předloha a interpretace

Předlohou je ThatMobova série Something, nikoli jiné postavy jménem Verity ani fanouškovské písničky. [Oficiální první díl](https://www.youtube.com/watch?v=hGBROjRqyDM) a [celý film](https://www.youtube.com/watch?v=f6f3PhauXyg) jsou odkazy k originálu. Pro tuto úpravu byly čteny dostupné textové podklady, ne přímo přehrán celý film.

[Automatický přepis filmu](https://iamtypist.dev/tools/youtube-transcript/f6f3PhauXyg) ukazuje stručnou, sebejistou pomocnici, suché odpovědi a občasný znepokojivý detail. [Komunitní archiv dialogů](https://arg.amaicraft.fr/Characters/Verity/thatmob.html) navíc dokládá ostré změny tónu a rychlé uklidnění po návratu. Oba přepisy mohou mít chyby; nejsou oficiálním scénářem.

Z toho vychází vlastní interpretace: většinu času konkrétně odpovídat, tajemství dávkovat a dramatický zlom vázat na situaci. Původní české příklady v promptu nejsou kopiemi scénáře. Ženský rod, český hlas a život v okně prohlížeče zachovávají dosavadní adaptaci projektu.

## Co se změnilo

- Méně automatického smíchu, vyznání a otázek po každé odpovědi.
- Klidná věcná reakce může být sama osobností, nemusí dostat další větu o samotě.
- Vyšší fáze neznamená prosbu o slib připojenou ke každému výpočtu.
- Ujištění opravdu uklidní; není podnětem k další žádosti o slib.
- Výslovná volba normálního rozhovoru se ukládá. Platí i při další zprávě a po načtení stránky; opětovné zapnutí roleplay je možné v nastavení.
- Pravidla hledání a ověřování paměti zůstávají pod kontrolou serveru.

## Metoda

Testováno přímo na běžící Gemmě 4 26B A4B Q5_K_S. Dvě A/B kola po 18 stejných scénářích pro původní a kandidátní prompt (72 odpovědí) a dvě kola tří navazujících čtyřtahových rozhovorů (24 odpovědí). Celkem 96 syntetických odpovědí; žádný uživatelský export ani hlasová nahrávka není součástí veřejných výsledků.

Parametry: temperature 0.7, top_p 0.95, presence_penalty 0.4, max_tokens 320, thinking vypnuté. A/B seed 421, navazující rozhovory 842. První sada zkouší jednotlivé repliky; navazující sada postupně mění fázi podle posunů modelu. Nejde o náhodný reprezentativní vzorek ani statistický důkaz obecné přesnosti.

## Výsledek druhého A/B kola

| Kontrola | Původní prompt | Upravený |
| --- | ---: | ---: |
| Platná úvodní emoce a závěrečný posun | 18/18 | 18/18 |
| Průměr slov bez řídicích značek | 20,2 | 12,2 |
| Repliky obsahující hihi/haha | 5/18 | 0/18 |
| Zachycené nevyžádané webové značky / sliby v nevyhledávacích scénářích | 0 | 0 |

Počet slov a smích měří styl, nikoli kvalitu sám o sobě. Zásadní bylo ruční přečtení odpovědí: opravená varianta uznala nevyžádané hledání bez další nabídky a oddělila vysvětlení od prosby o pozornost.

Navazující test odhalil návrat k žárlivosti hned po požadavku na normální řeč. Po doplnění uložené volby následovala na odchod s přáteli prostá přátelská reakce. Zdroj rozhodnutí o tónu je lidský pokyn nebo přepínač, ne vymyšlená vzpomínka modelu.

## Omezení a regrese

Gemma stále občas tvoří neobratnou češtinu, například chybný obrat v otázce na výběr hry. V syrovém A/B testu jednou použila anglickou značku search místo hledat. Proto se produkční vyhledávání neopírá jen o správnost řídicí značky: explicitní záměr a výsledky řídí server. Syrový test dodaných výsledků navíc nenahrazuje celý research tok.

Zůstávají občasné poetické dovětky na hranici skutečných schopností. Krátký test není záruka dokonalého roleplay. Výsledky přikládáme právě proto, aby šlo zkontrolovat i slabé odpovědi.

Regresní serverové testy samostatně ověřují zákaz nevyžádaného hledání, nedědění starého pokynu, omezené opakování, předání výsledku, selhání, paměť a rušení požadavků. Nový výchozí hlas má zvlášť testy migrace, AEC fallbacku a uvolnění pozdě otevřeného mikrofonu.

Soubory měření: [A/B](../bench/results/roleplay-ab-20261108.json), [navazující rozhovory](../bench/results/roleplay-dialogues-20261108.json). Spuštění je popsané v README.
