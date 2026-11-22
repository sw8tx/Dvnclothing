# DVN CLOTHING

**First Drop** ist die zweisprachige Shop-Vorschau auf dvnclothing.com. Öffentlich erscheint die Launch-Seite für den 6. Dezember 2026, 00:00 Uhr Europe/Berlin. Nach dem Vorschaupasswort stehen fünf echte DVN-Shirts mit Produktgalerien, Größen S/M/L, Favoriten, Warenkorb und Bestellübersicht zur Verfügung.

Die Launch-Seite verwendet eine kompakte, weiße Countdown-Ansicht. Das Konto-Fenster hat ein eigenes gemeinsames Stylesheet (`account.css`), das auf allen Konto-Seiten unabhängig vom Hero geladen wird. Zahlungslogos sind lokale farbige SVG-Dateien; Herkunft und Lizenz stehen unter `assets/payments/`.

In den Produktgalerien bleibt das Originalfoto an erster Stelle. Die zweite Ansicht enthält ein drehbares 3D-Shirt mit Pfeiltasten, Ziehen, Zoom und Rückkehr zur Vorderseite. Die KI-gestützte Visualisierung ist ausdrücklich als Annäherung gekennzeichnet. Modelle und Viewer werden lokal ausgeliefert und erst bei Auswahl der 3D-Ansicht geladen. Ohne WebGL bleibt das Originalfoto sichtbar.

Der bestätigte Katalog liegt in `catalog.json`: vier Shirts zu 20 €, Define Your Vision zu 22 €, Deutschlandversand 4,90 € und 3–5 Werktage. Original-Produktbilder liegen in `assets/products/`, vier KI-generierte Stylingbilder in `assets/lookbook/`. Herkunft und Bildbearbeitung sind in [docs/asset-sources.md](docs/asset-sources.md) dokumentiert. Kontakt: `service@dvnclothing.com`.

## Lokal prüfen

Node.js 22 oder neuer reicht; es werden keine npm-Pakete benötigt.

```sh
npm run check
npm test
npm run build
npm run dev -- --port 5173
```

Anschließend `http://localhost:5173` öffnen. Der lokale Adapter verwendet einen temporären Sitzungsschlüssel, keine Produktions-Secrets und keine Kundendatenbank. Zum reinen Prüfen des Designs kann `DVN_VISUAL_QA=1 npm run dev` die isolierten Shop-Seiten ohne Anmeldung rendern; dieses Skript wird nicht auf Cloudflare bereitgestellt. Die Sicherheit des echten Vorschauzugangs wird separat in `tests/preview-gate.test.cjs` geprüft. Der Countdown verwendet die absolute Berliner Launch-Zeit unabhängig von der Zeitzone des Geräts und öffnet bei Ablauf nicht automatisch den Verkauf.

## Vorschauzugang und Datenschutz

Die Pages-Middleware schützt `/shop`, `/products/*`, `/checkout`, den Katalog und die zugehörigen Assets. Der Build bündelt Shop-HTML und Katalog in `functions/_private-pages.js`; in `dist/` liegt ausschließlich die öffentliche Launch-Seite als HTML-Fallback. So wird bei einem ausgefallenen Function-Kontingent kein privates Shop-HTML statisch ausgeliefert. Produktbilder liegen in `dist/` und sind bei normalem Function-Betrieb geschützt; für deren Schutz bei einem Plattform-Fail-open muss Cloudflare zusätzlich auf Fail closed stehen.

Der Zugang nutzt `AUTH_COOKIE_SECRET` (mindestens 32 Zeichen) mit eigenem Signaturzweck, ein Secure/HttpOnly/SameSite-Cookie für zwölf Stunden und einen zeitlich begrenzten Schutz vor Fehlversuchen. Das Passwort liegt nicht im Browsercode. `PREVIEW_PASSWORD_SHA256` kann den serverseitigen Standardprüfwert ersetzen. Der Vorschauzugang verursacht keine D1-Abfragen und ist keine Kundenanmeldung.

Gastwarenkörbe verwenden ausschließlich den Sitzungsspeicher des aktuellen Tabs. Angemeldete Warenkörbe bleiben je Kontokennung getrennt. Favoriten werden erst nach Zustimmung zu Komfortfunktionen dauerhaft gespeichert; die Entscheidung lässt sich im Footer ändern. Analyse- und Marketing-Skripte sowie Newsletter wurden nicht ergänzt.

## Zahlungsstatus

Gewählt sind PayPal Business und Stripe; Apple Pay und Google Pay erscheinen im Stripe Checkout nur auf unterstützten Geräten mit passender Wallet. Shop Pay ist nicht Bestandteil dieser Kombination. Der Checkout ist implementiert, bleibt aber standardmäßig gesperrt. Die Endpunkte prüfen Ursprung, Anmeldung, Artikel, Größen, Mengen, Lieferanschrift und serverseitige Preise. Ein Warenkorb reserviert keine Ware; beim Start eines Bezahlvorgangs reserviert D1 die ausgewählte Menge atomar, damit nicht zwei Kunden denselben Bestand kaufen können. Ein Abbruch gibt diese Reservierung einmalig frei. Eine Bestellung wird erst nach verifizierter Anbieterbestätigung als bezahlt markiert; Kartennummern und Prüfcodes werden ausschließlich beim Zahlungsanbieter eingegeben und nicht in D1 gespeichert.

Die fünf Produkte haben je Größe S/M/L fünf bestätigte Stück im Ausgangsbestand. Migrationen [0006](migrations/0006_commerce.sql), [0007](migrations/0007_order_notifications.sql) und [0008](migrations/0008_checkout_details.sql) gehören in dieser Reihenfolge nach 0001–0005 in die gebundene D1-Datenbank; 0008 ist nur einmal ausführbar. Die Bestellansicht unter `/admin/orders` erfordert eine angemeldete E-Mail aus `COMMERCE_ADMIN_EMAILS`. Sie enthält Liefername, Anschrift, E-Mail und die optionale Telefonnummer. Discord erhält ausschließlich Bestellnummer, Artikel, Beträge und Zahlungsstatus. Eine Testmeldung aus der Betreiberansicht erzeugt weder Bestellung noch Zahlung noch Bestandsänderung.

Für **Sandbox-Tests** separate `STRIPE_CHECKOUT_TEST_SECRET_KEY`, `STRIPE_CHECKOUT_WEBHOOK_SECRET`, `PAYPAL_CHECKOUT_CLIENT_ID`, `PAYPAL_CHECKOUT_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` und `PAYPAL_WEBHOOK_ID` im Pages-Projekt als Secrets hinterlegen. Dazu `COMMERCE_MODE=test` und `COMMERCE_ENABLED=true` setzen. Die Endpunkte für signierte Webhooks lauten `https://dvnclothing.com/api/payments/stripe` und `https://dvnclothing.com/api/payments/paypal`. `DISCORD_ORDER_WEBHOOK_URL` muss als Secret und `DVN_AUTH_DB` als Binding vorhanden sein. Der alte Stripe-Testschlüssel für den Willkommensbonus ist kein Checkout-Schlüssel. Testbestellungen sind klar als Sandbox gekennzeichnet und dürfen nicht versendet werden. Erst nach einer erfolgreichen Sandbox-Zahlung, geprüftem Bestand und vollständigen Verkaufs- und Widerrufsinformationen den Livebetrieb planen. Dafür sind eigene Live-Zugänge, `COMMERCE_MODE=live` und `COMMERCE_LEGAL_READY=true` nötig; vor dem Launch-Zeitpunkt bleibt Live trotzdem gesperrt. Bei fehlender Konfiguration gibt `/api/checkout/config` `ready:false` zurück. Referenzen: [Stripe Checkout](https://docs.stripe.com/payments/checkout) und [PayPal Checkout](https://developer.paypal.com/docs/checkout/).

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

Das Skript prüft den Client und die Weiterleitungs-URI, erzeugt bei Bedarf einen Sitzungsschlüssel und sendet die neuen Werte über die Standardeingabe an Wrangler. Es prüft das Produktionsprojekt und stoppt, falls bereits Google-Zugangsdaten existieren. Bestehende Sitzungen behalten damit ihren Schlüssel. Für eine bereits teilweise eingerichtete Umgebung die fehlenden Werte gezielt unter **Settings → Variables and Secrets → Production** ergänzen. Die Bindungen heißen `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` und `AUTH_COOKIE_SECRET`.

4. Unter **Workers & Pages → dvnclothing → Deployments** den neuesten Produktionsbuild erneut ausführen. Danach muss [der Sitzungsstatus](https://dvnclothing.com/api/auth/session) vor dem Login `configured: true` und `user: null` anzeigen. Auf der Startseite **Konto → Mit Google anmelden** wählen und anschließend die Abmeldung prüfen.

Google liefert nur die Basisidentität (Name und E-Mail). Der Login legt eine signierte, sieben Tage gültige HttpOnly-Sitzung an. Angemeldete Warenkörbe und Bestellungen werden dem verifizierten Konto zugeordnet; Gastwarenkörbe bleiben auf den aktuellen Tab begrenzt.

## E-Mail-Anmeldung und Profile in Produktion einrichten

Die Anmeldung per E-Mail verwendet den Absender `DVN CLOTHING <account@dvnclothing.com>`. Die im Footer verlinkte Adresse `service@dvnclothing.com` bleibt der Kontakt für Besucher. Beide Anmeldeverfahren teilen sich den Sitzungsschlüssel.

1. **Versanddomain verifizieren.** In [Resend → Domains](https://resend.com/domains) `dvnclothing.com` hinzufügen. Die für diese Domain angezeigten DKIM- und Return-Path-Einträge mit exakt den vorgegebenen Namen, Typen, Prioritäten und Werten in der Cloudflare-DNS-Zone anlegen. Die Return-Path-MX-Adresse gehört zum von Resend angegebenen Unterhost, üblicherweise `send`. Die vorhandenen Stamm-MX-Einträge für eingehende Post bleiben bestehen. In Resend auf *Verify* klicken und den Status *Verified* abwarten. Unter [API Keys](https://resend.com/api-keys) einen Schlüssel mit der Berechtigung *Sending access* für diese Domain erstellen.
2. **Datenbank vorbereiten.** Im Cloudflare-Konto des Pages-Projekts unter **Storage & databases → D1** eine Datenbank auswählen oder `dvn-auth` erstellen. In deren SQL-Konsole zuerst den Inhalt von [0001_email_signin.sql](migrations/0001_email_signin.sql), danach [0002_profiles.sql](migrations/0002_profiles.sql) ausführen. Der erste Schritt erstellt die Tabellenstruktur für zeitlich begrenzte Anmeldeversuche, der zweite die Profile. Diese Schritte gehören in die Produktionsdatenbank.
3. **Datenbank anbinden.** In **Workers & Pages → dvnclothing → Settings → Bindings** für **Production** ein *D1 Database*-Binding hinzufügen. Als Variable exakt `DVN_AUTH_DB` und als Ressource die eben vorbereitete Datenbank wählen.
4. **Produktions-Secrets setzen.** Unter **Settings → Variables and Secrets → Production** `RESEND_API_KEY` als verschlüsselten Secret speichern. Einen bereits vorhandenen `AUTH_COOKIE_SECRET` beibehalten. Fehlt er, einen zufälligen Schlüssel mit mindestens 32 Zeichen im Passwortmanager erzeugen und ebenfalls als Secret speichern. Für den E-Mail-Login allein sind keine Google-Secrets erforderlich. Zugangsschlüssel gehören ausschließlich in die Secret-Felder.
5. **Aktivieren und prüfen.** Den aktuellen Produktionsbuild im Pages-Dashboard erneut bereitstellen. Auf `https://dvnclothing.com` über **Konto** einen Code für das eigene Testpostfach anfordern. Innerhalb von zehn Minuten im selben Browser bestätigen. Anschließend Profil öffnen, abmelden und prüfen, dass der Profilzugang wieder eine Anmeldung erfordert. Ein grüner Build allein prüft weder das Domain-Signing noch die Zustellung an ein Postfach.

Details zu den Anbieterfunktionen stehen in der [Cloudflare-Dokumentation zu Bindings](https://developers.cloudflare.com/pages/functions/bindings/) und den Resend-Anleitungen für [Domain-Verifizierung](https://resend.com/docs/dashboard/domains/introduction) und [Versandschlüssel](https://resend.com/docs/dashboard/api-keys/introduction).

Bei einem Versandfehler in den Cloudflare-Functions-Logs nach `email_auth_start` suchen. `stage: reserve` bezeichnet die D1-Reservierung. `stage: resend` enthält bei einer Anbieterantwort den HTTP-Status, bei Verbindungsfehlern die Kategorie `transport` oder `timeout`. Zwei Einträge zu derselben Anfrage können einen Wiederholungsversuch mit demselben Resend-Idempotenzschlüssel beschreiben. E-Mail, Code, Cookies und Zugangsschlüssel werden nicht protokolliert. Die Datenbank reserviert den Code vor dem Versand. Ob Resend die Nachricht angenommen hat, lässt sich deshalb am D1-Feld `active` allein nicht ablesen.
