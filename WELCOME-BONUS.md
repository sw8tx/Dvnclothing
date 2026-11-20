# Persönlicher Willkommensbonus

Der Bonus beträgt 15 % auf die erste Bestellung und wird im angemeldeten Konto angezeigt. Die Ausgabe ist auf einen Bonus pro bestätigter E-Mail-Adresse und Anmeldekennung begrenzt. Ein anderer Anmeldeweg mit der gleichen Adresse erhält erst Zugriff, nachdem die Person beide Wege im Konto bestätigt und verbunden hat. Der Adressvergleich verwendet die getrimmte, kleingeschriebene Adresse. Alias-Adressen werden eigenständig behandelt.

Die bestehende D1-Bindung heißt `DVN_AUTH_DB`. Vor Freischaltung des Bonus die Migrationen `migrations/0003_welcome_bonus.sql` und `migrations/0004_account_links.sql` auf die Datenbank anwenden. Ein Ausfall des Bonus betrifft ausschließlich den Bonus-Endpunkt. Die Tabelle enthält die Anmeldekennung, einen adressbezogenen Hash, den persönlichen Code, den Erstellzeitpunkt, den Sperrstatus und gegebenenfalls die beiden Stripe-Sandbox-IDs. Der persönliche Rabattcode lässt sich im Konto kopieren.

## Konto-API

| Anfrage | Ergebnis |
| --- | --- |
| GET /api/account/bonus | Eigener Bonus oder `{"bonus":null}` |
| POST /api/account/bonus | Erzeugt den persönlichen Code einmalig oder liefert den vorhandenen zurück |
| HTTP 409 mit `account_link_required` | Diese Adresse hat bereits einen Bonus unter einem getrennten Anmeldeweg. Beide Anmeldewege im Konto bestätigen und verbinden. |
| Antwort bei vorhandenem Bonus | `{"bonus":{"code":"…","percentOff":15,"firstOrderOnly":true}}` |

Alle Kontoaufrufe benötigen eine gültige Sitzung. POST prüft den Origin. Die API übernimmt die Identität aus der verifizierten Sitzung. Die Antwort wird nicht zwischengespeichert. Die Ausgabe und die Besitzprüfung erfolgen in einer D1-Transaktion. Falls zwei getrennte Anmeldekennungen vor einer Adressänderung bereits eigene Codes hatten und später verbunden werden, wird der älteste Code angezeigt. Beim nächsten POST sperrt die Anwendung den zusätzlichen Code in D1 und deaktiviert eine vorhandene Stripe-Sandbox-Promotion.

## Stripe-Sandbox

Optional `STRIPE_TEST_SECRET_KEY` als verschlüsseltes Pages-Secret konfigurieren und die Functions erneut deployen. Zulässig sind ausschließlich Testschlüssel. Ein eingeschränkter Schlüssel benötigt Lese- und Schreibzugriff auf Customers, Coupons und Promotion Codes. Anschließend bei einem angemeldeten Testkonto POST aufrufen. Dieser Schritt bereitet einen Sandbox-Coupon mit 15 %, einmaliger Dauer und einen individuellen Promotion Code für genau einen Sandbox-Kunden vor. Der Promotion Code erlaubt maximal eine Einlösung und verlangt eine erste Transaktion. Stripe erhält einen nicht zustellbaren Test-Alias. Die Sandbox-IDs stehen nach erfolgreicher Vorbereitung in D1.

Bei jedem ersten Kontoaufruf pro Anmeldung kann die Oberfläche POST verwenden. Dieser idempotente Aufruf löst keine E-Mail aus. Ohne Testschlüssel ist der persönliche Code weiterhin in DVN gespeichert. Bei vorübergehenden Stripe-Fehlern kann derselbe POST wiederholt werden. Der Adapter sucht bereits angelegte Objekte, verifiziert ihre Eigenschaften und verwendet Idempotenzschlüssel. Der Coupon hat eine feste ID. Eine abgelaufene oder bereits verbrauchte Promotion wird nicht neu ausgegeben.

Die Sandbox erzeugt ausschließlich Customer-, Coupon- und Promotion-Code-Objekte. Bei einer späteren Checkout-Integration muss die serverseitige Bestellung dem bereits zugeordneten Kunden gehören und die zugeordnete Promotion verwenden. Die Vorschau nimmt keine Zahlungen entgegen. Testobjekte sind ausschließlich in der Stripe-Sandbox gültig.

[Stripe Promotion Codes](https://docs.stripe.com/api/promotion_codes/create) · [Coupons](https://docs.stripe.com/api/coupons/create) · [Idempotenz](https://docs.stripe.com/api/idempotent_requests)
