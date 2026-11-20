# DVN CLOTHING

Statische Coming-soon-Seite für **dvnclothing.com**, ohne externe JavaScript-, Schrift- oder CDN-Abhängigkeiten.

## Übernommener Projektstand

- Monochromes Layout mit Wellen, lokal eingebundener Manrope-Schrift und animierten Countdown-Ziffern aus dem vorhandenen Repository.
- Launch: **6. Dezember 2026, 00:00 Uhr Europe/Berlin**. Der Zeitpunkt steht zentral im `datetime`-Attribut von `index.html`; JavaScript liest ihn dort aus.
- Vorhandenes weißes DVN-CLOTHING-Logo mit transparentem Hintergrund, unverändert als `assets/dvn-logo-white.png` eingebunden.
- Admin-Link zur bestehenden Cloudflare-Pages-Verwaltung.
- Mobile Ansicht und Berücksichtigung reduzierter Bewegung.

Weitere frühere Anforderungen konnten nicht zuverlässig abgerufen werden. Dieses Repository enthält eine Coming-soon-Seite; zusätzliche Shop-Funktionen sind hier nicht spezifiziert.

## Lokal prüfen

Node.js 22 oder neuer reicht; es werden keine npm-Pakete benötigt.

```sh
npm run check
npm test
npm run build
python3 -m http.server 3000 --directory dist
```

Anschließend `http://localhost:3000` öffnen. Der Countdown verwendet die absolute Berliner Launch-Zeit unabhängig von der Zeitzone des Geräts. Nach Ablauf zeigt er null und einen Hinweis an; er behauptet nicht, dass bereits ein Shop verfügbar ist.

## Cloudflare Pages

| Einstellung | Wert |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | 24 |

Alternativ den **Inhalt von `dist/`** per Direct Upload hochladen. Nur die explizit ausgewählten Website-Dateien werden in dieses Verzeichnis kopiert. `_headers` enthält die Cloudflare-Sicherheits- und Cache-Header; der lokale Python-Server wendet diese nicht an.

GitHub Actions führt Syntaxprüfung, Countdown-Tests und Build aus und legt `dvnclothing-pages` als herunterladbares Build-Artefakt ab. Der Workflow führt keinen eigenen Produktionsdeploy aus. Eine vorhandene Cloudflare-Git-Integration kann weiterhin gemäß ihren eingestellten Branch-Regeln deployen.

DNS und Custom Domains werden im Cloudflare-Dashboard verwaltet und sind nicht Bestandteil dieser Quellcodeänderung.
