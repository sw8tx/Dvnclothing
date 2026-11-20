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

## Google-Anmeldung

Cloudflare Pages Functions verwenden einen serverseitigen Google OpenID Connect Authorization Code Flow. Für den öffentlichen Login müssen in **Cloudflare Pages → Settings → Variables and Secrets** die verschlüsselten Werte `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` und `AUTH_COOKIE_SECRET` hinterlegt werden. Das letzte Secret ist ein zufälliger Wert mit mindestens 32 Zeichen. In der Google Cloud Console muss ein OAuth-Client des Typs **Web application** angelegt werden, dessen autorisierte Redirect-URI exakt `https://dvnclothing.com/api/auth/callback` lautet. Die Google OAuth-Zustimmungsseite muss für die vorgesehenen Nutzer freigegeben sein. Nach dem Eintragen der Secrets die Pages-Site erneut deployen. Die Login-Schaltfläche wird erst nach erfolgreicher Konfiguration sichtbar.

Google liefert nur die Basisidentität (Name und E-Mail). Der Login legt eine signierte, sieben Tage gültige HttpOnly-Sitzung an. Er synchronisiert derzeit weder den lokalen Warenkorb noch Bestellungen zwischen Geräten.
