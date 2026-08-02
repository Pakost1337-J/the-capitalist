# Monopoly Club / The Capitalist — reference asset manifest

Downloaded into `assets/reference/monopoly-club/` on 2026-08-02.

## Source status

| Source | Result |
|--------|--------|
| https://en.monopoly-club.com/ | Live HTTP returns only a JS redirect to `/lander` (114 bytes). HTTPS TLS handshake fails from this environment. No real game assets served. |
| http://www.monopoly-club.ru/ | HTTP 200 empty / Coming Soon — no assets. |
| https://www.monopoly-club.com/ / https://monopoly-club.com/ | Same lander redirect stub as EN. |
| static.monopoly-club.com / cdn.monopoly-club.com | TLS fail / unreachable. |
| Wayback CDX `monopoly-club.ru/*` | OK — many historical HTML + `/images/*` (UI/dice/logos). |
| Wayback CDX `monopoly-club.com/images/*` | **Best source** — Dec 2020 snapshot of board/UI/chips/shares. |
| Wayback `en.monopoly-club.com` | Homepage HTML (gzip) with embedded rules + company descriptions + 38-field board DOM. |

## What was downloaded (highlights)

### board/
- `board.png` (~714 KB) — full board texture with company logos/prices painted in
- `board-center.png` (~616 KB) — center logo/art
- Player chips (`chip1`–`chip5`, `chips/chip_*_norefl.png`, `field_chip*`)
- Dice UI: `diceHands.png`, `diceSpy.png`; RU-era `dice.png`, `diceWithCup.png`, `activate_dice.png`
- Share markers: `shares/*.png` including CHN/KO variants

### ui/
- Leather/wood chrome: `leather.png`, `leather-circle.png`, `table.png`, `woodenShelf.png`, `seam-big.png`
- Atmosphere: `bg.jpg`, `lights.png`, `header.jpg` (RU)
- Owner color borders (`owner_colors/*`), hall chips, chat/timer bits

### logos/
- `logo_300x300.png`, `logo_160x160.png`, `logo_red.png`, `cover.jpg`, `favicon.png`, `stamp.png`
- RU: `monopoly_logo.png`, `monopoly-club.jpg`
- Language flags: `languages/{en,ru,de,es,fr,it,pt}.png`

### docs/
- `rules-en-extracted.txt` / `.html` — full in-page rules
- `board-and-rules.md`, `company-descriptions.md`, `company-list.txt`
- `board-fields.csv` — 38 fields with side + share country class
- Wayback CDX dumps, `best-urls.txt`, `file-inventory.txt`

### css/
- `min-bundle.css` (~492 KB) — archived combined CSS including `field_new.css`, `hall.css`, `main.css`

### html/
- Decompressed EN homepage, RU 2011/2012 hall pages, help page, live stub HTML

## Board / rules data found

- **Start capital:** $1,500,000; **2–5 players**; **2-minute turns**
- **Special fields:** Start, Chance, Force Majeure, Customs, Tax (6%), Offshore, Customs Clearance
- **Companies (29):** Rolls-Royce, McDonald's, BP, BBC, Samsung, Danone, Hennessy, Disney, L'Oreal, IKEA, Volvo, Armani, Versace, Ferrari, Sony, Coca-Cola, Canon, Toyota, Hyundai, Siemens, Adidas, Ford, Mercedes, Alibaba, Lenovo, Huawei, Xiaomi, Nestle, Rolex
- **Exact buy prices / rent tables:** not in static HTML/JS archives found. Prices appear baked into `board.png` and filled via live socket/API into `.fieldPrice`.
- HTML board: **38** cells (`field1`–`field38`), not classic 40.

## Failed / unavailable

- Live game image CDN (all paths redirect to lander)
- HTTPS to en.monopoly-club.com (TLS errors here)
- Direct `/css/field_new.css` & `/css/hall.css` Wayback fetches at guessed timestamps (soft-404 HTML) — use `min-bundle.css` instead
- Game client JS with numeric price tables not present in archived `js/` (only jQuery); logic was likely behind auth / websocket (`connect.monopoly-club.com`)
- SWF CDX for RU returned 503 on one attempt; Flash client not retrieved
- Google/web search for loose sprites not executed as a separate API (Wayback CDX was far more productive)

## Best still-working URLs

See `docs/best-urls.txt`. Prefer Wayback `id_` links from Dec 2020 `monopoly-club.com` for images.