"""Vyhledávání pro Verity: SearXNG (JSON API) + stažení a vyčištění textu stránek.

Použití:  python search.py "dotaz"   → JSON {query, results: [{title, url, text}]}
Adresa SearXNG se bere z proměnné prostředí SEARXNG_URL (nastavuje ji server z config.json).
Závislosti: requests, beautifulsoup4, readability-lxml (volitelně – bez ní se vezme celý text stránky).
"""
import json, os, re, sys
import requests
from bs4 import BeautifulSoup

try:
    from readability import Document
except ImportError:
    Document = None

SEARXNG = os.environ.get('SEARXNG_URL', '').rstrip('/')
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; Verity/1.0)'}


def search(query, max_results=4):
    if not SEARXNG:
        return []
    # U dotazů na aktuální dění chceme jen čerstvé stránky.
    fresh = re.search(r'počas|dnes|zítra|teď|aktuál|zpráv|cena|kurz|výsled|zápas|news|weather|today', query, re.I)
    params = {'q': query, 'format': 'json', 'language': 'cs-CZ', 'safesearch': 0}
    if fresh:
        params['time_range'] = 'week'
    r = requests.get(SEARXNG + '/search', params=params, headers=HEADERS, timeout=15)
    r.raise_for_status()
    out = []
    for item in r.json().get('results', []):
        if item.get('url') and item.get('title'):
            out.append({'title': item['title'], 'url': item['url'], 'text': item.get('content', '')})
        if len(out) >= max_results:
            break
    return out


def fetch_text(url, max_chars=1500):
    r = requests.get(url, headers=HEADERS, timeout=12)
    r.raise_for_status()
    if 'html' not in r.headers.get('Content-Type', '').lower():
        return ''
    if 'charset' not in r.headers.get('Content-Type', '').lower():
        r.encoding = r.apparent_encoding
    html = Document(r.text).summary() if Document else r.text
    text = BeautifulSoup(html, 'html.parser').get_text(' ', strip=True)
    return re.sub(r'\s+', ' ', text)[:max_chars]


def main():
    query = ' '.join(sys.argv[1:]).strip()[:200]
    try:
        results = search(query)
    except Exception as e:
        print(json.dumps({'query': query, 'results': [], 'error': str(e)[:200]}, ensure_ascii=False))
        return
    for r in results[:2]:
        try:
            text = fetch_text(r['url'])
            if len(text) > 40:
                r['text'] = text
        except Exception:
            pass
    print(json.dumps({'query': query, 'results': results}, ensure_ascii=False))


if __name__ == '__main__':
    main()
