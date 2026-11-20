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

Cloudflare Pages baut den Produktionsbranch `main` über die Git-Verknüpfung. Assets kommen aus `dist/`, Pages Functions unter `functions/` aus dem Repository. Für eine interaktive lokale Prüfung von Functions und Assets nach dem Build im Projektverzeichnis `npx wrangler@4.165.0 pages dev dist` starten. Der Python-Webserver dient ausschließlich der statischen Vorschau. Ein manueller Deploy einschließlich Functions ist aus dem Repository-Stamm per `npx wrangler@4.165.0 pages deploy dist --project-name dvnclothing --branch main` möglich.

GitHub Actions führt Syntaxprüfung, Countdown- und Sprachwechsel-Tests und Build aus und legt `dvnclothing-pages` als herunterladbares Build-Artefakt ab. Der Workflow führt keinen eigenen Produktionsdeploy aus. Eine vorhandene Cloudflare-Git-Integration kann weiterhin gemäß ihren eingestellten Branch-Regeln deployen.

DNS und Custom Domains werden im Cloudflare-Dashboard verwaltet und sind nicht Bestandteil dieser Quellcodeänderung.

## Google-Anmeldung

Der Konto-Dialog steht auch während der Einrichtung zur Verfügung. Nach dem Hinterlegen der Produktions-Secrets und einem erneuten Deployment führt er zu Google.

1. In [Google Auth Platform](https://console.cloud.google.com/auth/clients) eine **Webanwendung** erstellen. Die autorisierte Weiterleitungs-URI lautet exakt `https://dvnclothing.com/api/auth/callback`. Marke und Zielgruppe für die vorgesehenen Nutzer konfigurieren. Bei einer App im Testmodus die erlaubten Testkonten eintragen.
2. Die Client-JSON aus Google herunterladen und außerhalb des Git-Repositorys aufbewahren. Die Datei enthält den Client-Secret.
3. Im Projektverzeichnis mit einem Cloudflare-Konto mit Bearbeitungsrechten für das Pages-Projekt **dvnclothing** anmelden. Den zweiten Befehl mit dem eigenen Dateipfad ausführen. Beide Befehle funktionieren in PowerShell und unter Linux.

```sh
npx wrangler@4.165.0 login
npm run setup:google -- "PFAD/ZUR/GOOGLE-CLIENTDATEI.json"
```

Das Skript prüft den Client und die Weiterleitungs-URI, erzeugt einen zufälligen Sitzungsschlüssel und sendet alle drei Werte über die Standardeingabe an Wrangler. Es prüft das Produktionsprojekt und stoppt, falls bereits Login-Secrets existieren. Bestehende Sitzungen behalten damit ihren Schlüssel. Für eine bereits teilweise eingerichtete Umgebung die fehlenden Werte gezielt unter **Settings → Variables and Secrets → Production** ergänzen. Die Bindungen heißen `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` und `AUTH_COOKIE_SECRET`.

4. Unter **Workers & Pages → dvnclothing → Deployments** den neuesten Produktionsbuild erneut ausführen. Danach muss [der Sitzungsstatus](https://dvnclothing.com/api/auth/session) vor dem Login `{"configured":true,"user":null}` anzeigen. Auf der Startseite **Konto → Mit Google anmelden** wählen und anschließend die Abmeldung prüfen.

Google liefert nur die Basisidentität (Name und E-Mail). Der Login legt eine signierte, sieben Tage gültige HttpOnly-Sitzung an. Er synchronisiert derzeit weder den lokalen Warenkorb noch Bestellungen zwischen Geräten.
