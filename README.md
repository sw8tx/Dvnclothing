# DVN CLOTHING

**First Cut** ist die zweisprachige T-Shirt-Shop-Vorschau auf dvnclothing.com. Besucher können Musterteile ansehen, Varianten und Größen auswählen und ihre Auswahl im Browser speichern. Preise, Bestand, Bestellungen und Zahlungsabwicklung sind für einen späteren Verkaufsstart offen.

Die Gestaltung und die [20 untersuchten Shop-Beispiele](design-references.md) sind im Repository dokumentiert. Produktmotive und Kampagnenbild liegen in `assets/shop/`. Die Kontaktadresse lautet `service@dvnclothing.com`.

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
