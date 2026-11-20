# DVN CLOTHING

Statische Coming-soon-Seite für **dvnclothing.com**, ohne externe JavaScript-, Schrift- oder CDN-Abhängigkeiten.

## Übernommener Projektstand

- Monochromes Layout mit Wellen, lokal eingebundener Manrope-Schrift und animierten Countdown-Ziffern aus dem vorhandenen Repository.
- Launch: **6. Dezember 2026, 00:00 Uhr Europe/Berlin**. Der Zeitpunkt steht zentral im `datetime`-Attribut von `index.html`; JavaScript liest ihn dort aus.
- Die beiden zuletzt bereitgestellten Logos sind unverändert als `assets/dvn-emblem.png` (Header) und `assets/dvn-wordmark.png` (Footer) eingebunden.
- Admin-Link zur bestehenden Cloudflare-Pages-Verwaltung.
- Mobile Ansicht und Berücksichtigung reduzierter Bewegung.
- Footer mit Impressum, Nutzungsbedingungen, Kontakt- und Servicehinweisen.
- Sprachschalter oben rechts mit lokal gezeichneten Deutschland-/UK-Flaggen. Deutsch ist der Standard; die Wahl wird lokal gespeichert und gilt auch auf den rechtlichen Seiten. Wenn der Browser den Speicher sperrt, funktioniert der Wechsel weiterhin für die aktuelle Seite.
- Der Sprachwechsel übersetzt auch Countdown-Beschriftungen, Screenreader-Texte, Datum und Seitentitel.

`impressum.html` und `terms.html` sind eigenständig erreichbare Seiten mit deutschem Inhalt auch ohne JavaScript. Die Terms sind ein Muster für die private Coming-soon-Vorschau und keine Verkaufs-AGB. Die angegebene Kontakt-E-Mail `service@dvnclothing.com` ist im Impressum und im Footer direkt verlinkt.

Die Erweiterung ist zur Prüfung über GitHub vorbereitet. Ein Push oder Pull Request veröffentlicht die Änderungen am Quellcode; ein Produktionsdeploy hängt von der eingestellten Cloudflare-Integration ab.

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

GitHub Actions führt Syntaxprüfung, Countdown- und Sprachwechsel-Tests und Build aus und legt `dvnclothing-pages` als herunterladbares Build-Artefakt ab. Der Workflow führt keinen eigenen Produktionsdeploy aus. Eine vorhandene Cloudflare-Git-Integration kann weiterhin gemäß ihren eingestellten Branch-Regeln deployen.

DNS und Custom Domains werden im Cloudflare-Dashboard verwaltet und sind nicht Bestandteil dieser Quellcodeänderung.
