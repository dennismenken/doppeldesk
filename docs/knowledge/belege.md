# Belege: Verhalten von Rechnung, Gutschrift, Auftrag und Beleg (Voucher)

Stand der Recherche: 18.11.2026. Zweck: Wissensbasis für die Fachlogik von DoppelDesk. Kein Nutzerdokument.

## Quellenkürzel und Belegstufen

| Kürzel | Quelle |
|---|---|
| SPEC | `spec/sevdesk-openapi.yaml` (Version 2.0.0), identisch mit https://api.sevdesk.de/openapi.yaml. Die Redoc-Seite https://api.sevdesk.de/ rendert dieselbe Spec und enthält keinen zusätzlichen Text. Die Tutorial-Texte stehen in `info.description` und in den `tags[].description` der Spec. |
| NEWS | Blog https://tech.sevdesk.com/api_news/ (3 Seiten, Links unten bei den Fakten). Es gibt dort keine Tutorials, nur Änderungsmeldungen. |
| HILFE | Hilfecenter https://intercom.help/sevdesk/de/ (Endnutzer-Doku, nicht API). |
| LIVE | Beobachtungen einer nutzenden Integration am Live-System (13. und 14.10.2026), Quelldokument nicht öffentlich. Schlägt SPEC. |
| DRITT | Drittquellen (MCP-Server, Foren). Nur als Hinweis, nicht verlässlich. |

Belegstufen: **belegt** (SPEC, NEWS, HILFE), **live** (LIVE), **Dritt**, **unbelegt** (Schlussfolgerung oder Wissenslücke). Bei Konflikt gilt LIVE vor SPEC.

Nicht auffindbar: Es gibt keine öffentliche, ausführliche Tutorial-Doku jenseits der Spec. Die alte Doku `https://my.sevdesk.de/apiOverview/index.html` liefert ohne Login nur die Login-Seite. https://tech.sevdesk.com/ enthält keine API-Tutorials. https://github.com/sevdesk hat keine öffentlichen Repositories. Echte Live-Antworten (Beispiel-JSON) stehen nirgends öffentlich, nur Spec-Beispiele.

---

## 1. Rechnung (Invoice)

### 1.1 Typen (`invoiceType`)

Quelle: SPEC, Tag Invoice, Abschnitt "Types and status of invoices".

| Code | Bedeutung |
|---|---|
| RE | normale Rechnung |
| WKR | wiederkehrende Rechnung (erzeugt RE-Rechnungen in festen Intervallen; `accountIntervall` ISO-8601-Dauer, `accountNextInvoice` Timestamp) |
| SR | Stornorechnung |
| MA | Mahnung (`dunningLevel`, `reminderCharge`, `reminderTotal`, `reminderDebit`, `reminderDeadline`) |
| TR | Teilrechnung |
| AR | Abschlagsrechnung |
| ER | Schlussrechnung |

### 1.2 Status (`status`)

Quelle: SPEC, Tag Invoice. Enum im Schema: `"50","100","200","750","1000"`.

| Code | Bedeutung | Anmerkung |
|---|---|---|
| 50 | deaktivierte wiederkehrende Rechnung | nur für `WKR` |
| 100 | Entwurf | noch änderbar |
| 200 | offen / fällig | "offen", solange das Fälligkeitsdatum nicht überschritten ist, sonst "fällig". Der Statuscode ist in beiden Fällen 200. |
| 750 | teilweise bezahlt | eingeführt mit Release 4.181 (13.06.2024), Quelle: https://tech.sevdesk.com/api_news/posts/2024_04_08-new-invoice-status/ . Vorher blieb eine teilbezahlte Rechnung auf 200. `GET /Invoice/{id}/getIsPartiallyPaid` liefert weiterhin `true` für 200er-Rechnungen mit Transaktionen. |
| 1000 | bezahlt | "verknüpft mit einer Transaktion auf einem Zahlungskonto" |

Ein Statuscode für "storniert" existiert in der Spec nicht (siehe 1.5).

Statuswechsel nur über Endpunkte (belegt, SPEC `info.description` "sevdesk-Update 2.0" und https://tech.sevdesk.com/api_news/posts/2024_04_04-changing-status-invoices-cretid-notes/ ):
- Anlage über `saveInvoice` nur mit Status 100. WKR darf zusätzlich mit 50 angelegt werden.
- Erhöhen: `sendViaEmail`, `sendBy`, `bookAmount`.
- Senken: `resetToDraft`, `resetToOpen`.
- `PUT/POST /Invoice/{id}/changeStatus` ist entfernt. Die inoffiziellen Endpunkte `POST/PUT /Invoice` und `/Invoice/{id}` sollen nicht benutzt werden und werden entfernt (https://tech.sevdesk.com/api_news/posts/2024_05_24-enshrined-endpoint/ ). `DELETE /Invoice/{id}` steht ebenfalls nicht in der Spec (LIVE: funktioniert für Entwürfe).
- Die Spec zeigt für `PUT/POST /Invoice/{id}` keine Pfade. DoppelDesk erzeugt diese nicht automatisch aus der Spec.

Validierungsfehler der PUT/POST-Endpunkte von Order, Invoice, Voucher, CreditNote liefern HTTP 422 statt 500 (Release 4.181, 13.06.2024, https://tech.sevdesk.com/api_news/posts/2024_04_08-changes_http_error_codes/ ). Die Spec listet 422 bei `enshrine`, `resetToOpen`, `resetToDraft` und bei `saveVoucher`. Nicht abgefangene Fehler können weiter 500 sein ("sometimes this error will appear if we missed to catch an error which is normally a 400", SPEC `info.description`). Ob einzelne Validierungsfehler real 400 oder 422 liefern: unbelegt, LIVE nennt 400 für die Factory-Kopfprüfung.

### 1.3 Anlage (`POST /Invoice/Factory/saveInvoice`)

Quelle: SPEC Operation `createInvoiceByFactory`, Schema `saveInvoice`.

- Body: `invoice` (Kopf), `invoicePosSave` (Array), `invoicePosDelete`, `discountSave`, `discountDelete`, `takeDefaultAddress`, optional `filename`. Die Spec verlangt in der Beschreibung, dass die letzten vier Parameter immer in dieser Reihenfolge und vollständig mitgesendet werden ("otherwise the request won't work properly"). Ob der Server das real erzwingt: unbelegt.
- `mapAll: true` und `objectName` sind im Kopf und in jeder Position Pflicht ("just needed for our system and you always need to provide them"). Die Semantik von `mapAll` ist öffentlich nicht erklärt. LIVE: ohne `mapAll` antwortet ein Update mit 201 und ändert nichts. Das ist die einzige belegte Wirkung.
- Pflichtfelder Kopf (Schema `Model_Invoice.required`): `invoiceDate`, `contact`, `discount`, `status`, `addressCountry`, `contactPerson`, `taxRate`, `taxRule`, `taxText`, `taxType`, `invoiceType`, `currency`, `mapAll`. Dazu gehört `objectName`. Hinweis: `taxRule` und `taxType` stehen beide in `required`, in Update 2.0 genügt `taxRule`, in 1.0 `taxType` (unbelegt, welches der Server wirklich verlangt).
- Pflichtfelder Position (`Model_InvoicePos.required`): `unity`, `taxRate`, `quantity`, `objectName`, `mapAll`.
- Ein Kontakt ist Pflicht für jeden Status über 100 (SPEC). Ein Entwurf ohne Kontakt ist möglich.
- Eine reguläre Rechnung (RE) darf kein `deliveryDate` nach `invoiceDate` haben. Dafür gilt `invoiceType: AR` (SPEC Operationsbeschreibung).
- Update-2.0-Validierungen (SPEC `info.description`, Abschnitt "Invoicing"):
  - AR und TR nur mit `taxRule` 1 (Regelbesteuerer) oder 11 (Kleinunternehmer).
  - MA mit `reminderCharge` größer 0 nicht anlegbar.
  - AR, TR, ER nur in der Standardwährung des Mandanten.
  - Verarbeitung über Status 100 hinaus ohne Kontakt nicht möglich.
  - `enshrined` ist über die Factory nicht setzbar.
  - ER: `invoiceDate` muss gleich oder später als die Daten zugehöriger AR/TR sein (Schema-Beschreibung, außerdem https://tech.sevdesk.com/api_news/posts/2023_07_11-invoice-date-validation-of-final-invoice/ ).
  - Positions-`taxRate` muss zur `taxRule` passen (0, 7, 19 je Regel, siehe Tabellen in der SPEC), sonst HTTP 422.
- Update über dieselbe Factory mit `invoice.id` und `invoicePosSave[].id`. Positionen werden über `invoicePosDelete` (`[{id, objectName}]`) gelöscht ("Delete positions while adding new ones").
- `takeDefaultAddress`: übernimmt die erste Adresse des Kontakts in `address`. Format des Adressfelds: Zeilen mit `\n`, Beispiel `name\nstreet\npostCode city` (SPEC-Beispiel). Ob und wie das Land angehängt wird: unbelegt.
- `discountSave`: `[{discount: bool (Rabatt oder Aufschlag), text, percentage: bool, value, objectName: "Discounts", mapAll}]`. `discountDelete`: `{id, objectName: "Discounts"}`.
- Antwort: SPEC nennt 201 mit `{invoice: {...}, invoicePos: [...], filename}`. Die Spec zeigt hier keinen `objects`-Wrapper, `createFromInvoice` dagegen schon (`{objects: {creditNote, creditNotePos, discount}}`). Der `objects`-Wrapper ist bei Factory-Antworten sehr wahrscheinlich vorhanden, nicht belegt. Siehe Abschnitt 9, Punkt 1.

Gewählte Annahme für DoppelDesk (zu entscheiden, nicht belegt): neue Rechnung immer Status 100, auch wenn der Client `status: 200` sendet. Die Spec sagt nur, dass sie nur mit 100 angelegt werden kann, nicht ob andere Werte ignoriert oder abgelehnt werden.

### 1.4 Rechnungsnummer

- Nicht Pflicht beim Anlegen (SPEC, Tag Invoice "The invoice number"). Der Server vergibt sie fortlaufend aus dem Nummernkreis. Manuelle Vergabe wird abgeraten.
- Spec-Beispiele: Rechnung `RE-1000`, Gutschrift `GU-1000`, Auftrag/Angebot `Offer-1000`, Beleg `Voucher-1000` (nur Beispielwerte, `header` Beispiel `My RE-1000`, `Invoice RE-1000`).
- Das Format ist im Konto konfigurierbar (https://sevdesk.de/lexikon/rechnungsnummer/ : "Das Format lässt sich in den Einstellungen anpassen"). Genaue Platzhalter-Syntax: unbelegt.
- Nächste Nummer: `GET /SevSequence/Factory/getByType?objectType=Invoice&type=RE` (Gutschrift: `objectType=CreditNote&type=CN`). Dieser Pfad steht im Tag-Text, **fehlt aber in `paths` der Spec** und würde daher nicht automatisch angelegt. Antwortform: unbelegt.
- Zeitpunkt der Nummernvergabe: LIVE belegt, dass Entwürfe eine Nummer tragen und der Gutschrift-Zähler nach Löschen eines nummerierten Entwurfs zurückfällt. Ob das für den Rechnungszähler (RE) genauso gilt: unbelegt (Annahme: ja).
- Stornorechnung: erhält "die nächst freie Nummer aus deinem Rechnungs-Nummernkreis" (HILFE https://intercom.help/sevdesk/de/articles/9154465-stornorechnung-erstellen ). Das Präfix der SR-Nummer (RE oder eigener SR-Kreis): unbelegt. Die Live-Beobachtungen führen "RE, SR, GU" als offen.
- Filter `invoiceNumber`, `invoiceNumberGreater`, `invoiceNumberSmaller`, `orderByInvoiceNumber=ASC|DESC`, `headerStartsWith`, `headerOrNumber` (SPEC, Filterliste). Semantik "Greater/Smaller" auf Zeichenketten oder Zahlen: unbelegt.

### 1.5 Storno (`POST /Invoice/{invoiceId}/cancelInvoice`)

Quellen: SPEC Operationsbeschreibung, HILFE https://intercom.help/sevdesk/de/articles/9154465-stornorechnung-erstellen , LIVE.

Belegt:
- "The cancellation invoice will be automatically paid and the source invoice's status will change to 'cancelled'." (SPEC)
- Erzeugt eine neue Rechnung `invoiceType: SR` mit `origin` auf das Original (LIVE). Ihre Positionen haben negative Beträge, `quantity` bleibt positiv, `payDate` der SR ist `null` (LIVE).
- Nur möglich, solange die Rechnung unbezahlt ist ("offen oder fällig"). Bezahlte Rechnungen: stattdessen Gutschrift mit Grund Minderleistung (HILFE). Das betrifft die Web-UI, die API-Prüfung ist unbelegt. LIVE: ein Testkonto lieferte "Feature with the code 'invoice:cancel' is not available" (Feature-Sperre pro Konto).
- Die SR erhält in der UI den Status "Bezahlt" (HILFE), das Original den Status "Storno".
- HTTP-Status der Antwort laut SPEC: 201 mit einem Rechnungsobjekt (`Model_InvoiceResponse`). Ob dieses Objekt die SR oder das Original beschreibt: unbelegt (Annahme: die SR).

Nicht belegt:
- **Numerischer Status des Originals nach Storno.** Das Spec-Enum enthält keinen "storniert"-Wert (50, 100, 200, 750, 1000). Drittquelle (MCP-Server https://glama.ai/mcp/servers/jaylann/mcp-server-sevdesk/tools/sevdesk_invoices_list ): Das Original behalte den Status "paid" (1000) und die SR verweise auf es. Das passt zu "SR automatisch bezahlt = 1000", ist aber DRITT. Empfehlung: konfigurierbar, Standard 1000 als Annahme kennzeichnen.
- **Status der SR:** Spec/HILFE sagen "automatically paid", also 1000 (belegt für die UI, für die API Annahme). LIVE meldet dazu `payDate: null`.
- **Entwurf stornieren:** nirgends beschrieben. HILFE nennt nur offen/fällig als Vorbedingung. Annahme: Entwurf (100) lehnt ab (Fehlerform unbelegt), stattdessen löschen.
- Bereits stornierte Rechnung erneut stornieren: unbelegt.
- Rechnung mit Status 750 stornieren: unbelegt.
- Alte Clients: `GET /Invoice/{id}/getCancled` (Frage, ob storniert) kommt in der aktuellen Spec nicht vor (nur in alten SDKs, DRITT).

### 1.6 `sendBy`, `sendViaEmail`

Quelle: SPEC.

- `PUT /Invoice/{id}/sendBy`, Body (beide Pflicht): `sendType` (`VPR` Druck, `VP` Post, `VM` Mail, `VPDF` heruntergeladenes PDF) und `sendDraft` (bool). `sendDraft: true` ist "für interne Zwecke" und ändert weder Status noch Buchungen ("will not alter the status of the invoice or create bookings for reports").
- Wirkung bei `sendDraft: false`: Status steigt von 100 auf 200 (LIVE und SPEC "Raising status"). Außerdem werden `sendType` und `sendDate` gesetzt (Feldbeschreibungen: "Is set when using sendBy/sendViaEmail", "The date the invoice was sent"). Format von `sendDate`: unbelegt (Annahme: Zeitstempel wie `invoiceDate`).
- Aufruf bei Status 200 oder höher: unbelegt (Annahme: Status bleibt, `sendType` wird überschrieben).
- `POST /Invoice/{id}/sendViaEmail`: Body `toEmail`, `subject`, `text` (Pflicht), `copy`, `additionalAttachments`, `ccEmail`, `bccEmail`, `sendXml`. "This will automatically mark the invoice as sent." Setzt also dieselben Felder wie `sendBy`. Kein echter Versand im Mock (Nicht-Ziel).
- Kontaktpflicht für alles über Entwurf: SPEC.
- Antwort von `sendBy`: SPEC nennt 200 mit Rechnungsobjekt.

### 1.7 `enshrine` (Festschreiben)

Quellen: SPEC, https://tech.sevdesk.com/api_news/posts/2024_05_24-enshrined-endpoint/ (Release 4.184, 23.07.2024).

- `PUT /Invoice/{id}/enshrine`, kein Body. Setzt `enshrined` auf "current date and time".
- Nur möglich bei Status 200 oder höher (Voucher: 100 oder höher, CheckAccountTransaction: 200 oder höher). Sonst 422 (Spec listet 422, Meldungstext unbelegt).
- Nicht umkehrbar. Eine festgeschriebene Rechnung ist nicht änderbar. Änderungsversuche an `enshrined` (ändern oder löschen) liefern HTTP 422 (NEWS). Was ein sonstiges Update einer festgeschriebenen Rechnung liefert: unbelegt (Annahme: 422).
- `resetToOpen` ist bei festgeschriebener Rechnung oder festgeschriebener Transaktion nicht möglich (SPEC).
- Format `enshrined`: ISO 8601 mit Zeitzone, SPEC-Beispiel `2024-04-08T00:00:00+02:00`. Der Zeitanteil im Beispiel ist 00:00:00, ob live die echte Uhrzeit steht: unbelegt.
- Antwort: Spec liefert für 200 kein Schema (leeres Objekt). Antwortinhalt unbelegt (Annahme: Rechnungsobjekt oder `{"objects": ...}`).

### 1.8 `resetToDraft`, `resetToOpen`

Quelle: SPEC.

- `PUT /Invoice/{id}/resetToOpen`: setzt auf 200 zurück. Verknüpfte Transaktionen werden entkoppelt ("Linked transactions will be unlinked"). Nicht möglich bei festgeschriebener Rechnung oder festgeschriebener Transaktion. Kann den Status nicht auf 200 erhöhen (dafür `sendBy`/`sendViaEmail`). Nicht für WKR.
- `PUT /Invoice/{id}/resetToDraft`: setzt auf 100 zurück, nur aus Status 200. Bei höherem Status zuerst `resetToOpen`. Nicht für WKR.
- Unbelegt: ob `payDate` und `paidAmount` beim Zurücksetzen geleert werden (Annahme: ja, `payDate` null, `paidAmount` 0), ob `sendDate`/`sendType` bleiben, ob die erzeugte CheckAccountTransaction bei Offline-Konten gelöscht oder nur entkoppelt wird (Spec sagt nur "unlinked").
- Fehler 422 laut Spec-Responses. Meldungstext unbelegt.

### 1.9 Zahlung (`PUT /Invoice/{id}/bookAmount`)

Quellen: SPEC (Tag Invoice "How to book an invoice", Operation `bookInvoice`), HILFE https://intercom.help/sevdesk/de/articles/9360905-teilzahlungen-und-sammelbuchungen , LIVE.

Body (JSON): `amount` (number, Pflicht), `date` (integer Unix-Timestamp, Pflicht), `type` (Pflicht), `checkAccount` `{id, objectName: "CheckAccount"}` (Pflicht), optional `checkAccountTransaction` `{id, objectName: "CheckAccountTransaction"}`, optional `createFeed` (bool, "Determines if a feed is created for the booking process").

Typen (`type`, SPEC):

| Code | Bedeutung |
|---|---|
| FULL_PAYMENT | normale Buchung |
| N | Teilbuchung ("historically used for normal booking") |
| CB | reduzierter Betrag wegen Skonto |
| CF | Differenz durch Währungsschwankung (deprecated; bei Voucher und Gutschrift in Update 2.0 nicht mehr unterstützt) |
| O | Minder- oder Mehrbetrag aus sonstigen Gründen |
| OF | Mehrbetrag wegen Mahngebühren |
| MTC | reduzierter Betrag wegen Geldverkehrskosten |

Konto-Logik (SPEC):
- Auf dem Standardkonto (Clearing-/Offline-Konto, `type: offline`) und auf dem Kassenkonto (`register`) wird die passende Transaktion automatisch erzeugt und die Rechnung damit gebucht.
- Bei `type: online` (Bank, finAPI, CSV-Import) muss eine bereits existierende Transaktion über `checkAccountTransaction` übergeben werden ("When the check account is type online, you must provide a transaction; other types will create the transaction."). Fehlen von `id` oder `objectName` führt zu einem Logikfehler ("otherwise a logic error will occur"), Meldungstext unbelegt.
- Unbekanntes Konto: HTTP 404 `No Model_CheckAccount with the id <id> was found` (LIVE).

Wirkung:
- LIVE: `FULL_PAYMENT` setzt Status 1000 und `payDate` als Kalendertag in Europe/Berlin (aus dem Timestamp). Zahlung um 00:30 Uhr Berlin landet auf diesem Tag.
- Teilzahlung: HILFE: Weicht der Transaktionsbetrag vom Rechnungsbetrag ab, muss ein Differenzgrund gewählt werden (bei Teilzahlung "Teilzahlung"). Die Rechnung wird "teilbezahlt" (API-Status 750 seit 4.181), die Transaktion "Gebucht". Ist die Rechnung komplett beglichen, wird sie "Bezahlt" (1000). Das Feld `paidAmount` ("Amount which has already been paid") führt die Summe. Der Wert des Differenzgrunds in der API ist der `type`-Code. Wie `type: N` mit Betrag unter Summe genau wirkt, ist nur teilweise belegt: Status 750 ist laut den Live-Beobachtungen eine Annahme, der Zusammenhang `N` gleich Teilzahlung folgt aus "Partial booking".
- Überzahlung: HILFE: Teilzahlung geht nicht, wenn die Transaktion den Restbetrag übersteigt. Dann "Teil einer Sammelbuchung" (Rechnung "Bezahlt", Transaktion "Zugeordnet" mit offenem Rest). Den API-Code dafür enthält die `type`-Liste nicht (`O` ist die nächstliegende Annahme, unbelegt).
- Skonto (`CB`): Betrag kleiner als Summe, Rechnung wird trotzdem bezahlt (1000) und die Differenz als Skonto verbucht. Genaue Statuslogik: unbelegt (Annahme: 1000 wenn `amount` plus Differenzgrund die Summe ausgleicht).
- `payDate` bei Teilzahlung: unbelegt (Annahme: bleibt `null` bis 1000).
- Voucher-Besonderheit: ein Voucher kann nur gebucht werden, wenn er vorher registriert (Status 100) ist (SPEC).
- Transaktions-Status (`CheckAccountTransaction.status`, SPEC): 100 angelegt, 200 verknüpft, 300 privat, 400 gebucht. Eine bei Offline-Konten automatisch erzeugte Transaktion: Status unbelegt (Annahme 400, `amount` = gebuchter Betrag, `valueDate` = `date`, `payeePayerName` = Kontaktname).
- Antwort: HTTP 200 mit Log-Eintrag laut SPEC: `{id, objectName: "InvoiceLog", additionalInformation, create, creditNote: {id, objectName}, fromStatus, toStatus, ammountPayed, bookingDate, sevClient}`. Auffällig: `ammountPayed` (Tippfehler mit zwei m, auch live so laut Drittdoku https://www.withone.ai/knowledge/sevdesk/conn_mod_def%3A%3AGLMKxPQoBKg%3A%3AjbjDlEzwQguV3HOqMLfVUA/md ), der Schlüssel heißt `creditNote` statt `invoice`, `create` ist als "Date of email creation" beschrieben. Das Beispiel zeigt `fromStatus: "200"`, `toStatus: "1000"`, Werte als Strings. Ob live genauso, unbelegt.
- Der Request-Parameter `date` ist bei Invoice und CreditNote integer, bei Voucher `string/date-time` (Spec-Inkonsistenz).

`GET /Invoice/{id}/getIsPartiallyPaid`: `{"objects": true|false}`. Vollständig bezahlte Rechnungen gelten als nicht teilbezahlt (SPEC).

### 1.10 Summen und Positionen

- Positionsfelder (Schema `Model_InvoicePos`): `quantity`, `price`, `name`, `unity`, `positionNumber`, `text`, `discount` (Prozent), `taxRate`, `priceNet`, `priceGross`, `priceTax`, `sumDiscount`, `sumNetAccounting`, `sumTaxAccounting`, `sumGrossAccounting`, optional `part`.
- `price` ist laut Positionsfeld "either gross or net, depending on the sevdesk account setting", laut Tag-Text hängt es an `showNet` der Rechnung: `showNet: true` heißt, `price` enthält den Nettobetrag, sonst den Bruttobetrag ("determines, if the price you give the invoice positions will be regarded as gross or net"). Der Widerspruch (Konto-Einstellung vs. `showNet`) ist unaufgelöst. Annahme: `showNet` der Rechnung entscheidet.
- Kopfsummen (alle read-only): `sumNet`, `sumTax`, `sumGross`, `sumDiscounts`, plus `...ForeignCurrency` und `...Accounting` ("usually the same as sumNet"). Das Spec-Positionsschema führt keine `sumNet`/`sumGross` je Position auf. LIVE zeigt aber, dass SR- und Gutschrift-Positionen `price`, `priceGross`, `priceNet`, `sumGross`, `sumNet`, `sumTax` führen. LIVE schlägt SPEC.
- Rundung, Reihenfolge von Positionsrabatt, Kopfrabatt (`discountSave`), Skonto (`discount` plus `discountTime` am Kopf) und Steuerberechnung: **nicht dokumentiert**. Annahme: je Position `netto = quantity * price * (1 - discount/100)`, Steuer je Position gerundet auf 2 Stellen, Summen sind Summen der gerundeten Positionen. Mit einem echten Konto prüfen.
- Kopf-`discount` (integer) ist ein Skonto-Prozentsatz: "If the end-customer gets a discount if he pays the invoice in a given time", Tage in `discountTime`. Er ist kein Rabatt auf die Summe. Eine Absolutrabatt-Position läuft über `discountSave`.
- Kopf-`taxRate` ist "not used anymore", Pflicht, Wert egal. Steuer kommt aus den Positionen.
- `smallSettlement` (Kleinunternehmer): keine Umsatzsteuer, `taxRule` 11.
- `taxRule` (Update 2.0, Objekt `{id, objectName: "TaxRule"}`): 1 Umsatzsteuerpflichtig (0/7/19), 2 Ausfuhr (0), 3 innergemeinschaftliche Lieferung (0/7/19), 4 steuerfrei §4 (0), 5 Reverse Charge §13b (0), 11 Kleinunternehmer (0), 17 nicht im Inland steuerbar (0), 18 bis 20 OSS (landesabhängig), 21 Reverse Charge §18b (0). Vollständige Tabelle: SPEC `info.description`. 1.0-Konten verwenden `taxType` (`default`, `eu`, `noteu`, `custom`, `ss`).
- Positionslisten über `GET /Invoice/{id}/getPositions` (Antwort `{"objects": [...]}`) und `GET /InvoicePos?invoice[id]=..&invoice[objectName]=Invoice`.

### 1.11 Weitere Rechnungsfaktoren

- `POST /Invoice/Factory/createInvoiceFromOrder`: Body `{order: {id, objectName: "Order"}, type: "percentage"|"net"|"gross", amount, partialType: "RE"|"TR"|"AR"}` (Enum laut Schema, Tag-Text nennt `ER` für Schlussrechnung, Widerspruch). Antwort 200 mit Rechnungsobjekt (SPEC). In 2.0: Schlussrechnung nicht möglich, wenn AR/TR existieren. Wirkung auf den Auftragsstatus siehe 3.3.
- `POST /Invoice/Factory/createInvoiceReminder`: Mahnung (MA) aus Rechnung, Query `invoice[id]`, `invoice[objectName]`. Kein weiteres Verhalten belegt.
- `propertyIsEInvoice`: E-Rechnung (nur System 2.0, https://tech.sevdesk.com/api_news/posts/2024_11_15-einvoice_changes/ ). Erfordert Mandanten- und Kontaktdaten (IBAN, BIC, E-Mail, Steuernummer, `buyerReference`). Für DoppelDesk ohne PDF/XML-Inhalt nicht nötig.
- Render/PDF-Endpunkte (`render`, `getPdf`, `getXml`, `changeParameter`, `sendByWithRender`): ab 07.04.2026 liefern `render`/`changeParameter`/`sendByWithRender` ein Feld `pdf` (Base64) statt `thumbs` und `pages` (https://tech.sevdesk.com/api_news/posts/2026_02_breaking_changes_q1_2026/ ). Für Mock: statisches Minimal-PDF.

### 1.12 Listenfilter Rechnung

Quelle: SPEC, Tag Invoice "How to filter". Nur Auszug: `partiallyPaid`, `orderByDebit`, `orderByDueTime`, `orderByDueDate`, `showAll`, `invoiceNumber`, `delinquent`, `notdelinquent`, `tags[x][id]`, `costCentre[id]`, `status`, `createBefore/After`, `updateBefore/After`, `contact[id]`, `customerIntenalNote` (Schreibweise wie Spec), `day`, `startDate`, `endDate`, `onlyDunned`, `showWkr=all`, `showMa=all`, `origin[id]`, `invoiceType`, `paymentMethod[id]`, `headerStartsWith`, `headerOrNumber`, `orderByInvoiceNumber`, `invoiceNumberGreater/Smaller`, `sendType`, `fulltextSearch`.
- Ohne `showAll`/`showWkr`/`showMa` zeigt die Standardliste vermutlich keine WKR- und MA-Rechnungen. Das legt der Filter-Satz nahe ("Retrieve all recurring invoices", "showMa=all"). Ob SR (und AR/TR) standardmäßig sichtbar sind: unbelegt. LIVE: `invoiceType=SR` liefert nur SR.
- `startDate`/`endDate` filtern nach `invoiceDate`, Timestamp erforderlich, `Y-m-d` wird ignoriert (LIVE).

---

## 2. Gutschrift (CreditNote)

### 2.1 Zweck und Kategorien

Quelle: SPEC, Tag CreditNote. "A credit note is essentially a special type of invoice which is not written by the service provider but rather by the beneficiary." Jede Gutschrift braucht eine Buchungskategorie `bookingCategory`:

| Wert | Bedeutung |
|---|---|
| PROVISION | Provision |
| ROYALTY_ASSIGNED | zugeordnete Lizenzgebühr |
| ROYALTY_UNASSIGNED | nicht zugeordnete Lizenzgebühr |
| UNDERACHIEVEMENT | Minderleistung. `refSrcInvoice` (oder `refSrcVoucher`) mit der ID ist dann Pflicht |
| ACCOUNTING_TYPE | Buchung auf Sonderkonto (`accountingType`). In Update 2.0 nicht unterstützt |

PROVISION, ROYALTY_* sind für System 2.0 seit 24.03.2025 wieder verfügbar (https://tech.sevdesk.com/api_news/posts/2025_03_24-new-credit-note-types-available/ ).
Ein Feld `creditNoteType` gibt es in der Spec nicht. Das Pendant ist `bookingCategory`. Die Spec verlangt in `Model_creditNote.required` zusätzlich `invoiceType` (vermutlich Spec-Fehler, siehe Abschnitt 9).

### 2.2 Status

Quelle: SPEC Tag CreditNote: 100 Entwurf, 200 offen/zugestellt, 750 teilbezahlt, 1000 bezahlt. Schema-Enum nennt zusätzlich 300 und 500 (ohne Bedeutung, vermutlich aus Order kopiert, unbelegt). Anlage nur mit Status 100. Status ändern über `sendBy`, `sendViaEmail`, `bookAmount`, `resetToDraft`, `resetToOpen` (NEWS wie bei Rechnungen). `changeStatus` entfernt.

### 2.3 Anlage und Quellen

- `POST /CreditNote/Factory/saveCreditNote` (Antwort 201 `{creditNote, creditNotePos}`). Body `creditNote`, `creditNotePosSave`, `creditNotePosDelete`, `discountSave`, `discountDelete`, `takeDefaultAddress`, `forCashRegister` (Reihenfolge der letzten fünf wichtig, "discount" für Gutschriften deprecated). `forCashRegister: true` für Buchung auf Kasse.
- Mindestens eine Position (`creditNotePosSave`), seit Release 4.159 (24.07.2023, https://tech.sevdesk.com/api_news/posts/upcoming-changes-24.07.2023/ ).
- `POST /CreditNote/Factory/createFromInvoice`, Body `{invoice: {id, objectName: "Invoice"}}`, Antwort 201 `{objects: {creditNote, creditNotePos: [...], discount: [...]}}`. Erzeugt einen Entwurf (100) mit `origin` auf die Rechnung und übernimmt deren Positionen (LIVE). Quellrechnung muss mindestens eine Position haben. Wirkung auf die Quellrechnung (Status, `origin`-Rückverweis): unbelegt (Annahme: keine). `bookingCategory` des Ergebnisses: Annahme `UNDERACHIEVEMENT` mit `refSrcInvoice` gleich Quelle (die Spec empfiehlt den Endpunkt genau dafür).
- Update-2.0-Regeln (SPEC): Kein Anlegen für AR/TR-Rechnungen und nicht für Vouchers. `createFromVoucher` bleibt nur für 1.0-Konten (Hinweis: "Not supported with sevdesk-Update 2.0"). `deliveryDate`/`deliveryDateUntil` muss konsistent zur Rechnung sein: hat die Rechnung `deliveryDateUntil`, braucht die Gutschrift eines und umgekehrt, und es darf nicht vor dem der Rechnung liegen.
- LIVE: `CreditNotePos` hat positive Beträge. Gutschriftsummen werden im Kopf positiv geführt (unbelegt, folgt aus positiven Positionen).
- Nummernformat `GU-1000` (Spec-Beispiel). Nächste Nummer: `SevSequence/Factory/getByType?objectType=CreditNote&type=CN`. LIVE: Zähler fällt nach Löschen eines nummerierten Entwurfs zurück.
- `DELETE /CreditNote/{id}`: nur Entwürfe (LIVE). Fehlermeldung bei Nicht-Entwurf: unbelegt. `GET` unbekannte ID: 404 `No Model_CreditNote with the id <id> was found` (LIVE).
- Änderungen über `saveCreditNote` mit `creditNote.id` und `mapAll` wie bei Rechnungen (LIVE). `PUT /CreditNote/{id}` existiert (`Model_creditNoteUpdate`).
- `origin`-Filter: `origin[id]`, `origin[objectName]=Invoice` (LIVE).

### 2.4 Zahlung, `sendBy`, `enshrine`, Reset

- `PUT /CreditNote/{id}/bookAmount`: Body und Typen identisch zur Rechnung (SPEC "just change Invoice into CreditNote"). `date` ist integer (Timestamp). Antwort wie Invoice-Log (`creditNote`-Schlüssel, hier plausibel, `ammountPayed`). Teilzahlung 750 und Voll 1000 analog (unbelegt). `CF` ist bei Gutschriften in 2.0 nicht mehr zulässig. Richtung der Transaktion (Ausgang statt Eingang): unbelegt.
- `sendBy`: Body `{sendType, sendDraft}` wie Rechnung. Hebt 100 auf 200.
- `enshrine`: nur Status 200 oder höher, unumkehrbar, Änderung danach 422.
- `resetToOpen`/`resetToDraft`: wie Rechnung (Status 200 bzw. 100, entkoppelt Transaktionen, nicht bei `enshrined`).
- `payDate`, `paidAmount` Feldverhalten wie bei Rechnung (Annahme).

---

## 3. Auftrag (Order): Angebot, Auftragsbestätigung, Lieferschein

### 3.1 Typen (`orderType`)

Quelle: SPEC, Tag Order. AN Angebot (Estimate/Proposal), AB Auftragsbestätigung, LI Lieferschein. Alle teilen dieselben Attribute. Nummernbeispiel `Offer-1000` (nur Spec-Beispiel). Weitere Felder: `version` (Pflicht, beginnt bei 0, für mehrere Entwürfe zum selben Auftrag), `origin` + `typeOrigin` (z. B. `Order` oder `Invoice`), `paymentTerms`, `deliveryTerms`, `sendType` (siehe unten).

### 3.2 Status

| Code | Bedeutung |
|---|---|
| 100 | Entwurf |
| 200 | versendet (delivered) |
| 300 | abgelehnt / storniert (rejected / cancelled) |
| 500 | angenommen |
| 750 | teilweise abgerechnet (Rechnung über einen Teil des Auftrags existiert) |
| 1000 | abgerechnet (eine oder mehrere Rechnungen decken den ganzen Auftrag) |

Quelle: SPEC Tag Order, Tabelle "Order status". Schema-Enum Integer `100,200,300,500,750,1000`. Anlage mit beliebigem Status laut Beschreibung ("you will need to provide the status code when creating an order"). Wer Status 200 direkt setzt statt `sendBy`/`sendViaEmail`, muss `sendType` angeben.

### 3.3 Regeln

- `POST /Order/Factory/saveOrder` (Antwort 201 `{order, orderPos}`; Body `order`, `orderPosSave`, `orderPosDelete`). Mindestens eine Position (24.07.2023, siehe 2.3). Negative Gesamtsumme bei AN/AB/LI ist unzulässig (Validation Exception, ab Release 4.167, 14.11.2023, https://tech.sevdesk.com/api_news/posts/2023_09_11-forbid-orders-with-negative-totals-sum/ ).
- `PUT /Order/{id}/sendBy`: Body `{sendType, sendDraft}` wie Rechnung (`sendDraft` ändert den Status nicht). `sendViaEmail` setzt "automatically mark the order as sent". Erwarteter Wechsel 100 auf 200 (Annahme analog Rechnung, nicht ausdrücklich beschrieben).
- Auftrag zu Rechnung (`createInvoiceFromOrder`): `partialType` TR und AR sollten den Auftrag auf 750 setzen, RE (Schlussrechnung) auf 1000. Automatische Statusübergänge sind nur indirekt belegt (Statusnamen "Partially Calculated" und "Calculated"), Mechanik unbelegt.
- Weitere Aktionen: `createPackingListFromOrder`, `createContractNoteFromOrder` (Query `order[id]`, `order[objectName]`), `getRelatedObjects`, `getDiscounts`, `getPositions`.
- Löschen: `DELETE /Order/{id}` und `DELETE /OrderPos/{id}` existieren. Beschränkung auf Entwürfe: unbelegt.
- Order hat kein Festschreiben (kein `enshrine`-Endpunkt in der Spec).
- Summen, Rabatte, `showNet` wie bei Rechnungen. Das `showNet`-Beispiel ist hier numerisch (`1`), bei Rechnungen `"1"` (Spec-Beispiel-Inkonsistenz).

---

## 4. Beleg (Voucher)

### 4.1 Typen und Status

Quelle: SPEC Tag Voucher.
- `voucherType`: `VOU` normal, `RV` wiederkehrend (`recurringInterval` ISO-Dauer wie `P0Y1M`, `recurringStartDate`, `recurringNextVoucher`, ...).
- `creditDebit`: `C` Ausgabe (Credit, "You bought something"), `D` Einnahme (Debit).
- Status laut Text: 50 Entwurf, 100 unbezahlt/fällig, 150 "Transferred" (Zahlung angelegt, wartet auf Import der Banktransaktion), 750 teilbezahlt, 1000 bezahlt. Schema-Enum nennt nur 50, 100, 1000 (Inkonsistenz).
- Anlage nur mit 50 oder 100 (SPEC saveVoucher: "The only valid status values for this endpoint are 50 (draft) and 100 (open)"). Direkt als bezahlt anlegen geht in 2.0 nicht mehr.
- Nur Entwürfe sind per Factory änderbar ("You can only update draft vouchers"). Absenken: `resetToOpen` (aus bezahlt) und `resetToDraft` (aus offen).

### 4.2 Endpunkte und Regeln

- `POST /Voucher/Factory/saveVoucher` (Antwort 201 `{voucher, voucherPos, filename}`, Fehler auch 422). Body `voucher`, `voucherPosSave`, `voucherPosDelete`, `filename` (vorher via `POST /Voucher/Factory/uploadTempFile` hochgeladen, Rückgabe interner Dateiname/Hash).
- Pflicht Kopf (`Model_Voucher.required`): `creditDebit`, `taxType`, `taxRule`, `status`, `voucherType`, `mapAll`, `objectName`. Lieferant: entweder `supplier` (Kontakt) oder `supplierName`. Beschreibung/Belegnummer im Feld `description`. Es gibt kein `voucherNumber`.
- Pflicht Position (`Model_VoucherPos.required`): `accountDatev` (2.0) oder `accountingType` (1.0), `voucher`, `taxRate`, `sumGross`, `sumNet`, `net`, `mapAll`, `objectName`.
- Summen: `net` entscheidet, ob `sumNet` (net true) oder `sumGross` (net false) maßgeblich ist, das andere Feld ist read-only. Fehlen beide, gilt `sum`. "All positions must be either net or gross." `sumTax` kommt aus der Steuerrate. Rundungsregeln unbelegt.
- 2.0-Validierung (SPEC): nur bestimmte Steuersätze und Buchungskonten (ReceiptGuidance), Anlagevermögen-Konto nur mit Asset, Steuerfehler HTTP 422.
- `PUT /Voucher/{id}`: nur Entwürfe, einfache Felder, Status nicht änderbar. `DELETE /Voucher/{id}` fehlt in der Spec.
- `PUT /Voucher/{id}/bookAmount`: Body wie Rechnung, `date` hier als `string/date-time` (Spec-Inkonsistenz). Antwort `{id, objectName, create, voucher: {id, objectName}, fromStatus, toStatus, amountPayed, bookingDate, sevClient}` (hier `amountPayed` mit einem m). Nur für registrierte Belege (Status 100). Skonto bei negativen Positionen unzulässig, nicht jeder Differenzgrund bei jeder Positionskombination zulässig, `CF` entfällt.
- `PUT /Voucher/{id}/enshrine`: ab Status 100.
- `PUT /Voucher/{id}/resetToOpen`: setzt auf 100 zurück, entkoppelt Zahlungen, setzt Abschreibungen zurück, nicht bei `enshrined`, kann nicht von Entwurf anheben. `resetToDraft`: setzt 50, entkoppelt Zahlungen, nicht bei `enshrined`.
- Verschärfte Validierung für `saveVoucher` seit Release 4.157 (27.06.2023, Header `X-Version: 1.1` zum Testen), Details nicht veröffentlicht (https://tech.sevdesk.com/api_news/posts/increased-validation/ ).

---

## 5. Zahlungskonten und Transaktionen (Kontext für `bookAmount`)

Quelle: SPEC Tags CheckAccount, CheckAccountTransaction.
- `CheckAccount.type`: `online` (Bank/PayPal/CSV-Import), `offline` (Clearing), `register` (Kasse). `status`: 0 archiviert, 100 aktiv. `defaultAccount`, `baseAccount` ("1" für das mitgelieferte Basiskonto).
- Anlage von Konten: `POST /CheckAccount/Factory/fileImportAccount` und `.../clearingAccount`. `POST /CheckAccount` ist deprecated (Entfernung 17.09.2024, https://tech.sevdesk.com/api_news/posts/2024_07_03-change_check_account_creation/ ).
- `POST /CheckAccountTransaction`: nur für Online-Konten, bevorzugt CSV-Import. Pflicht: `valueDate`, `checkAccount`, `amount`, `status`, `payeePayerName`.
- Transaktion `enshrine`: ab Status 200 (verknüpft). Verknüpfte Belege sind danach unveränderlich.

---

## 6. Antwortformate

Hinweis: Die folgenden Formate stammen aus SPEC-Beispielen. Es sind keine verifizierten Live-Antworten, die Spec-Beispiele sind untereinander inkonsistent.

- Hülle: `{"objects": ...}`. Listen: Array. Einzelabruf `GET /Invoice/{id}`: `{"objects": [ {...} ]}` (Array mit einem Element laut SPEC-Schema, die Live-Beobachtungen führen das als Annahme).
- `total`: bei `countAll=true` als String, z. B. `"total": "157"` (SPEC Pagination). Ohne `countAll` kein `total`.
- Pagination: `limit` ganzzahlig 1 bis 1000, sonst HTTP 400 `Invalid ’limit’ parameter. Please provide an integer value between 1 and 1000.` (NEWS, gültig seit 30.05.2025, https://tech.sevdesk.com/api_news/posts/2025_03_11-api_pagination_limits/ ). Typografische Apostrophe um `limit` stehen so im Blogtext, exakte Zeichen unbelegt. Kein Default dokumentiert.
- Auth: Header `Authorization: <token>` (32 Zeichen Hex). Token als URL-Parameter seit 29.04.2025 entfernt (https://tech.sevdesk.com/api_news/posts/2025_02_06-authentication-method-removed/ ). 401 bei falschem oder fehlendem Token (SPEC). Fehlertext unbelegt.
- Request-Body: JSON oder `x-www-form-urlencoded` (SPEC). Header `X-Version` für Versionierung (Standard `default`). Antwort-Header `Deprecation`.
- Zahlen und IDs: In Spec-Beispielen meist Strings: `"id": "1"`, `"status": "100"`, `"sumNet": "100"`, `"sumTax": "19"`, `"sumGross": "119"`, `"taxRate": "0"`, `"discount": "0"`, `"timeToPay": "10"`, `"showNet": "1"`, `"smallSettlement": "0"`, `"propertyExchangeRate": "0.8912"`, `"balance": "12.34"`. Ausnahmen: `"paidAmount": 0` (Zahl), Order-`status`/`version` teils numerisch. Dezimalformat in den Beispielen ohne Nachkommastellen aufgefüllt (`"100"`, `"119"` statt `"119.00"`), Nachkommastellen nur wenn nötig. Drittdoku nennt `119.00`, ist aber nicht belegt. Welche Felder live Zahl oder String sind: unbelegt (laut Live-Beobachtungen aus Fixtures, die im Repo fehlen).
- Request-Typen: Zahlen werden als JSON-Zahl gesendet (`"price": 100`, `"taxRate": 19`, `"quantity": 2`). Ein Server-Verhalten für Strings in Requests ist unbelegt.
- Datumsformate Eingabe: Timestamp oder `dd.mm.yyyy` (SPEC: "Needs to be provided as timestamp or dd.mm.yyyy"). Ein Format `Y-m-d` wird bei Filtern stillschweigend ignoriert (LIVE). Ob die Factory `Y-m-d` im Body annimmt: unbelegt.
- Datumsformate Ausgabe: LIVE: ISO 8601 mit Zeitzone (`2026-10-01T00:00:00+02:00`) für `invoiceDate`, `creditNoteDate`, `create`, `update`. SPEC-Beispiele mischen ISO (`2024-04-08T00:00:00+02:00`) und `01.01.2020` (Order, Voucher, Positionen). Annahme: durchgängig ISO 8601 mit Offset (Europe/Berlin).
- Verknüpfungen: `{"id": "1", "objectName": "Contact"}` (ID als String in Antworten, als Integer oder String in Requests). Umbruch im Adressfeld `\n`.
- Beispiel-Rechnungsobjekt (Auszug aus SPEC, GET `/Invoice/{id}`): `id`, `objectName: "Invoice"`, `invoiceNumber: "RE-1000"`, `contact`, `create`, `update`, `sevClient`, `invoiceDate`, `header`, `headText`, `footText`, `timeToPay`, `discountTime`, `discount`, `addressCountry`, `payDate`, `createUser`, `deliveryDate`, `status`, `smallSettlement`, `contactPerson`, `taxRate`, `taxRule`, `taxText`, `dunningLevel`, `taxType`, `paymentMethod`, `costCentre`, `sendDate`, `origin`, `invoiceType`, `accountIntervall`, `accountNextInvoice`, `reminderTotal`, `reminderDebit`, `reminderDeadline`, `reminderCharge`, `taxSet`, `address`, `currency`, `sumNet`, `sumTax`, `sumGross`, `sumDiscounts`, `sumNetForeignCurrency`, `sumTaxForeignCurrency`, `sumGrossForeignCurrency`, `sumDiscountsForeignCurrency`, `sumNetAccounting`, `sumTaxAccounting`, `sumGrossAccounting`, `paidAmount`, `customerInternalNote`, `showNet`, `enshrined`, `sendType`, `deliveryDateUntil`, `datevConnectOnline`, `sendPaymentReceivedNotificationDate`. Nullable Felder sind in der Antwort vorhanden (mit `null`, Spec markiert `nullable`). Null-Füllung bei fehlenden Feldern: unbelegt, aber konsistent mit LIVE (`payDate: null` bei SR).
- HTTP-Status Erfolg (SPEC): Factory-POSTs und `cancelInvoice` 201, `createInvoiceFromOrder` 200, PUT-Aktionen 200, GET 200. Listenendpunkte und `getPositions` liefern `objects` als Array.

### Fehlerformate

- Allgemein (DRITT, Forenpost mit Original-Antworten, https://community.n8n.io/t/create-an-invoice-with-sevdesk/46146 ; Stand 2023):
  `{"objects": null, "error": {"message": "invoice expected array with 'id' and 'objectName'. array given", "code": null, "data": null, "exceptionUUID": "<uuid>"}}` mit HTTP 400.
  Und HTTP 500 mit demselben Hüllenformat und einer PHP-Fehlermeldung (`App\InvoiceValidation\BuhaTypeRestrictions::__construct(): Argument #1 ($invoiceType) must be of type string, null given, ...`). Letzteres ist ein interner Fehler und kein Muster zum Nachbauen.
- Die Meldung `<kopf> expected array with 'id' and 'objectName'` (LIVE, Factory ohne `objectName`/`mapAll`) und das Präfix `invoice` im Forenbeispiel stammen vom Schlüsselnamen des fehlerhaften Elements. Also: `<Schlüssel> expected array with 'id' and 'objectName'. <Typ> given`. Die Wortlaut-Endung `. array given` (Typ des Werts) ist nur aus einem Beispiel belegt.
- 404: `{"objects": null, "error": {"message": "No Model_<Typ> with the id <id> was found"}}` (LIVE). Die Felder `code`, `data`, `exceptionUUID` fehlen im Beleg, in 400/500 sind sie vorhanden. Annahme: auch bei 404 vorhanden (`code: null`, `data: null`, `exceptionUUID` UUID).
- 422-Validierungsfehler: Body unbelegt (Annahme: derselbe Aufbau mit fachlicher Meldung).
- 401: Body unbelegt.
- Feature-Sperre: `Feature with the code '<code>' is not available for the user id <id>` (LIVE). HTTP-Status unbelegt (500 laut Beobachtung einer Integration).

---

## 7. Wichtige Statusmaschinen für den Mock

Vorschlag auf Basis der belegten Fakten (jede Zeile mit Quelle oder als Annahme markiert).

Rechnung (RE):

```
Anlage 100
100 → 200: sendBy oder sendViaEmail (sendDraft=false)
200 → 1000: bookAmount voll
200 → 750: bookAmount Teilbetrag, danach 750 → 1000 bei Restzahlung
200/750/1000 → 200: resetToOpen (nicht wenn enshrined)
200 → 100: resetToDraft (nicht wenn enshrined)
200/750/1000: enshrine setzt enshrined, Status unverändert
200 → cancelInvoice: Original unbelegt (Annahme 1000), neue SR 1000
100: DELETE löscht (LIVE)
```

Gutschrift: gleich ohne WKR, `createFromInvoice` und `saveCreditNote` legen immer 100 an. Beleg: 50, 100, 150 (unbelegt wie erreichbar), 750, 1000. Auftrag: 100, 200, 300, 500, 750, 1000.

---

## 8. Offen / zu klären (nach Priorität für die Fachlogik)

1. Numerischer Status von Original und SR nach `cancelInvoice`, Stornierbarkeit von Entwürfen und Teilzahlungs-Rechnungen (kein öffentlicher Beleg).
2. Rundung und Reihenfolge von Positionsrabatt, Kopfrabatt und Skonto, exakte `showNet`-Semantik (Konto-Einstellung vs. Kopf).
3. Status und `payDate` nach `bookAmount` mit `N`, `CB`, `O`, `OF`, `MTC` und mit Betrag über oder unter der Summe.
4. Aufbau der automatisch erzeugten CheckAccountTransaction bei Offline-Konten.
5. Feldtypen (String oder Zahl) und Dezimalformat der Live-Antworten (keine Fixtures im Repo).
6. `objects`-Wrapper bei Factory-Antworten (`saveInvoice`, `saveCreditNote`, `saveOrder`, `saveVoucher`, `cancelInvoice`, `sendBy`, `bookAmount`).
7. SR-Nummernformat und Zeitpunkt der Nummernvergabe je Nummernkreis.
8. Bedeutung und Wirkung von `mapAll` über die LIVE-belegte Wirkung hinaus.
9. Standard-Sichtbarkeit von SR/AR/TR/MA/WKR in `GET /Invoice`.

---

## 9. Ungereimtheiten und Spec-Fehler (gefunden bei der Recherche)

1. Factory-Antworten ohne `objects` in der Spec (`saveInvoice`, `saveCreditNote`, `saveOrder`, `saveVoucher`), `createFromInvoice` mit `objects`. Wahrscheinlich Spec-Fehler.
2. `cancelInvoice`, `sendBy`, `createInvoiceFromOrder`: Schema ohne `objects`-Hülle.
3. `bookAmount`: `ammountPayed` (Invoice/CreditNote) gegen `amountPayed` (Voucher), Schlüssel `creditNote` im Invoice-Log, `date` integer gegen `string/date-time` (Voucher).
4. `Model_creditNote`: `required` enthält `invoiceType`, Status-Enum enthält 300 und 500 ohne Erklärung.
5. `Model_Voucher.status`-Enum nur 50/100/1000, Text nennt zusätzlich 150 und 750.
6. `InvoicePosResponse.quantity` Beispiel `true` (boolean) statt Zahl. Positionsschema ohne `sumNet`/`sumGross`, LIVE hat sie.
7. `createInvoiceFromOrder.partialType`: Enum `RE,TR,AR`, Text nennt `ER` für die Schlussrechnung. Auch der Text von `info.description` nennt `partialType: 'ER'`.
8. `SevSequence/Factory/getByType` im Text, nicht in `paths`. `DELETE /Invoice/{id}` und `DELETE /Voucher/{id}` fehlen in `paths`. Eine rein Spec-getriebene Auto-Registrierung (Kernidee von DoppelDesk) deckt diese Pfade nicht ab, sie brauchen eigene Routen.
9. `createFromVoucher` steht noch in der Spec, ist aber nur für 1.0-Konten (DoppelDesk-Default: System 2.0, Entscheidung offen).
10. Filter `customerIntenalNote` mit Tippfehler (Spec und Live-Name), Filter `creditNoteNumberNumberSmaller` (Doppelung im Tag-Text der Gutschrift).
11. Spec-Beispiele mischen ISO-Datum und `dd.mm.yyyy`, Number-Beispiele mischen String und Zahl (`showNet`, `paidAmount`).
12. `Model_Order` Pflichtfeld `header`, aber Nummernformat `Offer-1000`: ob `AN` live `AN-1000` heißt, ist unbelegt.
