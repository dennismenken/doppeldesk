# sevDesk: Stammdaten und API-Konventionen

Wissensbasis für DoppelDesk. Stand der Recherche: 2026-11-18. Jede Aussage nennt ihre Quelle. Was nirgends belegt ist, steht als **unbelegt**, Annahmen als **Annahme**.

## Quellenkürzel

| Kürzel | Quelle | Art |
|---|---|---|
| SPEC | `spec/sevdesk-openapi.yaml` (OpenAPI 3.0.0, API-Version 2.0.0), darin `info.description`, Tag-Beschreibungen und Schemas | offiziell |
| ANF | Beobachtungen einer nutzenden Integration am Live-System (Oktober 2026), Quelldokument nicht öffentlich | live verifiziert durch eine Consumer-App |
| NEWS-PAG | https://tech.sevdesk.com/api_news/posts/2025_03_11-api_pagination_limits/ | offiziell |
| NEWS-AUTH | https://tech.sevdesk.com/api_news/posts/2025_02_06-authentication-method-removed/ | offiziell |
| NEWS-LIST | https://tech.sevdesk.com/api_news/ (Übersicht der Posts) | offiziell |
| GO-RS | https://github.com/robin-samuel/sevdesk (Dateien `static_countries_data.go`, `categories_data.go`, `tax_rules.go`, `communication_way_keys_data.go`, `errors.go`, `check_accounts.go`, `parts.go`, `bookkeeping.go`, `transport.go`) | inoffizieller Go-Client, Snapshot gegen ein echtes Konto |
| GO-MTN | https://pkg.go.dev/git.mtnmedia.group/mtn-media-group/mtn_go_sevdesk/basics | inoffizieller Go-Client, Strukturen von SevUser, Unity, StaticCountry, Category |
| CTX | https://github.com/chr1st1ank/context-switch/issues/65 | Drittprojekt, Hinweis zu Unity |

Hinweis zur Gewichtung: Alles aus GO-RS, GO-MTN und CTX stammt aus Drittquellen, nicht von sevDesk. Es ist plausibel und konsistent, aber nicht offiziell.

## 0. Wichtigster Befund: Lücken der OpenAPI

Die SPEC enthält **keine Endpunkte** für `StaticCountry`, `Unity`, `SevUser`, `Category`, `TaxRule`, `TaxSet` und `SevClient` (nur `PUT /SevClient/{SevClientId}/updateExportConfig`). Verifiziert per Pfadliste der SPEC. Vorhanden sind `CommunicationWayKey` (GET), `CheckAccount`, `Part`, `Contact`, `ContactAddress`, `CommunicationWay`, `Tools/bookkeepingSystemVersion` und `ReceiptGuidance/*`.

Die SPEC verweist aber selbst auf die fehlenden Endpunkte: `GET /StaticCountry` (Beschreibung von `ContactAddress.country`), `GET /Category?objectType=ContactAddress` bzw. `Part`, und die Schemas verwenden `Unity`, `SevUser`, `TaxRule`, `TaxSet` als `objectName`. ANF nutzt live `GET StaticCountry?limit=300`, `GET SevUser`, `GET Category`, `GET SevSequence`. Die Consumer-App ruft diese Endpunkte also real auf. DoppelDesk muss sie deshalb zusätzlich zu den Spec-Operationen bereitstellen (Konsequenz, nicht Teil der Spec).

Zusätzlich deklariert die SPEC `limit`, `offset`, `countAll`, `embed` nicht an den einzelnen Pfaden, nur im Fließtext von `info.description`. ANF bestätigt: `limit`, `offset`, `countAll` wirken an allen Listen.

## 1. Authentifizierung

- **Header:** `Authorization: <token>` ohne `Bearer`-Präfix. SPEC `info.description` ("Authorization:yourApiToken"), `securitySchemes.api_key` (`type: apiKey`, `in: header`, `name: Authorization`). ANF bestätigt: "ohne `Bearer`".
- **Tokenform:** hexadezimaler String mit 32 Zeichen, ein Token je Administrator, unbegrenzt gültig. SPEC. Beispiel der SPEC: `b7794de0085f5cd00560f160f290af38` (nur Beispiel).
- **Token als Query-Parameter:** wurde von sevDesk **abgeschaltet**. Ankündigung vom 2025-02-06, Umstellung bis 2025-04-29 verpflichtend, danach entfernt (NEWS-AUTH). Der Header ist die einzige Methode. DoppelDesk sollte den Query-Parameter nicht akzeptieren (Empfehlung, abgeleitet aus NEWS-AUTH).
- **Fehlender oder falscher Token:** HTTP 401 ("Authentication required", SPEC bei jeder Operation). ANF: fehlender oder unbekannter Token ergibt 401. Genauer Body: **unbelegt**.
- **Weitere Header:** `Accept` (json oder xml), `Content-type` (json oder `x-www-form-urlencoded`), `User-Agent` (sevDesk bittet um aussagekräftigen Wert), `X-Version` (Ressourcen-Versionierung: `default`, `1.0` bis `1.9`). SPEC. Antwort-Header `Deprecation`. SPEC. Die Request-Bodies dürfen laut SPEC auch URL-codiert sein ("it also accepts url-encoded data"). Das ist für DoppelDesk relevant (qs ist im Stack).
- **Mandant:** In DoppelDesk ein Mandant je Token (Projektentscheidung, nicht sevDesk).

## 2. Antwortform, Paginierung, embed, depth

### 2.1 Hülle

- Listen: `{"objects": [ ... ]}`. Mit `countAll=true` zusätzlich `"total"`. SPEC (Abschnitt Pagination, Beispiel `"total": "157"`). Das Beispiel zeigt `total` als **String**. Ob live Zahl oder String kommt: **unbelegt**.
- Einzelobjekt: `{"objects": {...}}` laut SPEC-Beispielen. ANF vermutet bei `GET /{Typ}/{id}` ein Array mit einem Element und markiert das als **Annahme**, vor Umsetzung gegen Live-Beispiele prüfen. Hinweis: Die Go-Library `decodeObject` in GO-RS behandelt beide Formen (Array und Objekt), was dafür spricht, dass beides vorkommt (Schlussfolgerung aus `transport.go`, nicht bestätigt).
- Fehler siehe 2.5.

### 2.2 Paginierung

| Parameter | Regel | Quelle |
|---|---|---|
| `limit` | Integer 1 bis 1000 | SPEC, NEWS-PAG |
| `offset` | Integer, Anzahl zu überspringender Datensätze | SPEC |
| `countAll` | Boolean, Default `false`; bei `true` enthält die Antwort `total` | SPEC |

- Ungültiges `limit` (nicht ganzzahlig, kleiner 1, größer 1000): HTTP 400 mit der Nachricht `Invalid 'limit' parameter. Please provide an integer value between 1 and 1000.` NEWS-PAG, gültig ab 2025-05-30. Die Anführungszeichen im Originaltext der Quelle sind typografisch (’limit’), die genaue ASCII-Form ist **unbelegt**.
- **Default-Limit ohne Angabe:** **unbelegt**. NEWS-PAG sagt nur, Aufrufe ohne `limit` seien nicht betroffen. SPEC nennt in einem Beispiel "up to a limit of 100" (nur Beispiel der Anfrage). Empfehlung: ohne `limit` alle Datensätze liefern ist riskant, eine feste Obergrenze wäre eine **Annahme**.
- `total` nur mit `countAll=true`. ANF live belegt.
- `ReceiptGuidance`-Endpunkte ignorieren `limit` und `offset` (Kommentar in `iter.go` von GO-RS, Drittquelle).

### 2.3 embed

- Query-Parameter `embed`, Wert ist der Name des verschachtelten Feldes, mehrere kommagetrennt. SPEC. Beispiel der SPEC: `embed=category` bei Contact ersetzt `{"id","objectName"}` durch das vollständige Category-Objekt.
- Ohne `embed` stehen verschachtelte Objekte nur als `{"id": "...", "objectName": "..."}`. SPEC.
- Verhalten bei unbekanntem Embed-Namen: **unbelegt**.
- Pfad-Notation für tiefere Ebenen (z. B. `contact.category`): **unbelegt**.

### 2.4 depth (nur Contact)

- `depth=1` liefert Organisationen **und** Personen. Ohne `depth` nur Organisationen. SPEC (Contact-Filtertabelle), ANF live bestätigt ("`depth=1` liefert auch Personen, ohne `depth` nur Organisationen").
- Die SPEC deklariert `depth` und `customerNumber` als einzige Query-Parameter an `GET /Contact`, beide als string.

### 2.5 Fehlerformat und HTTP-Codes

- **Form:** `{"error": {"message": "...", "exceptionUUID": "..."}}`. SPEC `components.schemas.validationError` (Beschreibung von `exceptionUUID`: "An identifier of this exact problem that can be given to the support team"). GO-RS parst genau diese Felder (`transport.go`).
- **404 live:** `{"objects": null, "error": {"message": "No Model_<Typ> with the id <id> was found"}}`. ANF 6.5, live belegt. Beispiel: `No Model_CheckAccount with the id <id> was found`. Bei Verwendung von `Model_<Typ>` ist `<Typ>` der Modellname (Beispiele in ANF: `Model_CheckAccount`, `Model_CreditNote`).
- **400 live:** Validierungsfehler mit `error.message`, z. B. `<kopf> expected array with 'id' and 'objectName'` (Factory ohne `objectName`/`mapAll`). ANF 6.1.
- **Codes laut SPEC (info.description):**

| Code | Bedeutung |
|---|---|
| 200 | OK |
| 201 | Created, typisch bei POST |
| 400 | Bad request, syntaktisch falsch |
| 401 | Authentifizierung fehlgeschlagen |
| 403 | keine Berechtigung |
| 404 | Ressource unbekannt |
| 500 | interner Fehler; "sometimes this error will appear if we missed to catch an error which is normally a 400" |

- **422:** In den Operationen der SPEC genannt, z. B. bei `CheckAccount/Factory/*` ("Invalid value given") und `ReceiptGuidance/forAccountNumber`. Außerdem die Standardantwort bei unpassender Kombination aus Buchungskonto, Steuerregel und Steuersatz in Update 2.0 (SPEC Abschnitt Tax Rules: "validation error (HTTP status code 422)").
- **429, 409:** Nur in GO-RS als Sentinel-Fehler belegt (`ErrRateLimit` = 429, `ErrConflict` = 409 "z. B. Löschen eines Nicht-Entwurfs"). Ob und wann sevDesk diese Codes real sendet: **unbelegt**. Rate-Limit-Zahlen: **unbelegt**.
- **Feature-Sperre:** `Feature with the code '<code>' is not available for the user id <id>`, HTTP-Status unklar (eine Integration meldete 500). ANF 6.5.

### 2.6 Typen in Antworten

- Die SPEC-Antwortschemas (`Model_*Response`) deklarieren fast alle Felder als `string`, auch Zahlen und Booleans, z. B. `Model_ContactResponse.status`, `defaultTimeToPay`, `exemptVat`. Die Request-Schemas (`Model_Contact`) typisieren dagegen korrekt (`integer`, `boolean`, `number`). Ausnahmen in der Antwort: `Model_ContactAddressResponse.id` ist `integer`, `Model_Part.id` ist `integer`.
- ANF: IDs und Zahlen kommen als Strings, "wo sevDesk das tut". Die exakte Typisierung je Feld soll aus Live-Beispielen kommen (offen). Für DoppelDesk gilt daher: Response-Schema der SPEC bestimmt die Ausgabetypen, bekannte live belegte Abweichungen kommen als Ausnahmeliste dazu.
- Datumsfelder: ISO 8601 mit Zeitzone, z. B. `2026-10-01T00:00:00+02:00` (ANF, live belegt). `birthday` ist laut SPEC-Schema `date` (Format `YYYY-MM-DD`).

## 3. Contact

### 3.1 Typ und Kategorie

- Es gibt **kein Typ-Feld**. Person oder Organisation ergibt sich aus den Namensfeldern: Ist `surename` ODER `familyname` gesetzt, ist es eine **Person**. Ist `name` gesetzt, ist es eine **Organisation**. SPEC (Tag Contact).
- Eine Person kann über `parent` zu einer Organisation gehören, nicht umgekehrt. SPEC.
- `surename` ist der **Vorname** (Schreibweise bewusst so, die SPEC kommentiert: "yes, we know"), `familyname` der Nachname, `name2` Zweitname/Namenszusatz, `titel` nicht-akademischer Titel (Position), `academicTitle` akademischer Titel. SPEC.
- **Kategorie-IDs** (`category`, Pflichtfeld bei POST laut `Model_Contact.required`):

| ID | Bedeutung (deutsch in sevDesk) | Quelle |
|---|---|---|
| 2 | Lieferant (Supplier) | SPEC, GO-RS |
| 3 | Kunde (Customer) | SPEC, GO-RS |
| 4 | Partner | SPEC, GO-RS |
| 28 | Interessent (Prospect Customer) | SPEC, GO-RS |
| 355842 | Zahlungsdienstleister | nur GO-RS (Drittquelle, Snapshot eines Kontos). In der SPEC fehlt sie. Ob die ID für alle Konten gilt: **unbelegt** |

- Weitere Kategorien (`GET /Category?objectType=...`), laut GO-RS Snapshot ("IDs are permanent", Drittaussage):
  - ContactAddress: 43 Arbeit, 44 Privat, 45 leer, 47 Rechnungsanschrift, 48 Lieferanschrift, 49 Abholanschrift.
  - Part: 1 Standard, 97430 Dienstleistung.
- Category-Felder laut GO-MTN: `id`, `objectName`, `create`, `update`, `name`, `objectType` (z. B. `Contact`), `type` (z. B. `C` oder `S`), `code` (z. B. `K`), `color`, `priority`, `postingAccount`, `translationCode` (z. B. `CATEGORY_CUSTOMER`), `additionalInformation`, `sevClient`. Konkrete `type`/`code`-Werte pro Kategorie: **unbelegt** (nur je ein Beispielwert).

### 3.2 Felder (Request `Model_Contact`, Response `Model_ContactResponse`)

Feld, Typ im Request, Bedeutung. Alle außer `category` optional und nullable.

| Feld | Typ | Hinweis |
|---|---|---|
| `name` | string | Organisationsname |
| `status` | integer | 100 Lead, 500 Pending, 1000 Aktiv (SPEC). Default bei Anlage: **unbelegt** |
| `customerNumber` | string | siehe 3.3 |
| `parent` | object `{id, objectName: Contact}` | muss Organisation sein |
| `surename`, `familyname`, `name2`, `titel`, `academicTitle`, `gender` | string | nur Personen. `gender`: Freitext, SPEC nennt "m, w, or your own definition" |
| `birthday` | date | nur Personen |
| `category` | object `{id, objectName: Category}` | Pflicht |
| `description` | string | darf etwas HTML enthalten |
| `vatNumber`, `taxNumber`, `taxOffice` | string | `taxOffice` nur für griechische Kunden |
| `bankAccount` (IBAN), `bankNumber` | string | |
| `defaultCashbackTime` (Tage), `defaultCashbackPercent`, `defaultTimeToPay` (Tage) | integer, number, integer | |
| `exemptVat` | boolean | in der SPEC-Tabelle als `excemptVat` getippt, das Schema heißt `exemptVat` |
| `defaultDiscountAmount`, `defaultDiscountPercentage` | number, boolean | Prozent (true) oder absolut (false) |
| `buyerReference`, `governmentAgency` | string, boolean | für E-Rechnung |
| Response zusätzlich | | `id`, `objectName` (`Contact`), `create`, `update`, `sevClient` (Referenz, automatisch) und `additionalInformation` (veraltet) |

- Request/Response-Unterschied: `Model_Contact` kennt `additionalInformation` nicht, die Response schon.

### 3.3 Kundennummer

- Optionales Feld. SPEC rät von manueller Vergabe ab und verweist auf zwei Hilfsendpunkte:
  - `GET /Contact/Factory/getNextCustomerNumber` liefert `{"objects": "<string>"}` (nächste freie Nummer).
  - `GET /Contact/Mapper/checkCustomerNumberAvailability?customerNumber=KD-1000` liefert `{"objects": true|false}`.
- Die SPEC-Beispielnummer `KD-1000` zeigt ein Präfix-Format. Das **tatsächliche** Default-Format der Kundennummer (nur Zahl oder mit Präfix, Startwert) ist **unbelegt**. Der Zähler gehört in sevDesk zu einer Nummernkreis-Konfiguration (`SevSequence`, ANF nennt `GET /SevSequence` als optional). Aufbau von `SevSequence`: **unbelegt**.
- Vorschlag (**Annahme**, nicht belegt): Format konfigurierbar, Default `KD-1000` mit fortlaufender Erhöhung, damit die SPEC-Beispiele stimmig bleiben.
- Filter `customerNumber` an `GET /Contact`: ANF live: exakter Abgleich. `orderByCustomerNumber=ASC|DESC` sortiert (SPEC).
- Ob doppelte Kundennummern bei POST abgewiesen werden: **unbelegt**.

### 3.4 Filter an GET /Contact (SPEC Filtertabelle)

`depth`, `category[id]`+`category[objectName]=Category`, `city`, `tags[x][id]`+`tags[x][objectName]=Tag`, `customerNumber`, `parent[id]`+`parent[objectName]=Contact`, `name`, `zip`, `country[id]`+`country[objectName]=StaticCountry`, `createBefore`, `createAfter`, `updateBefore`, `updateAfter` (Timestamps), `orderByCustomerNumber`.

- `name`: laut SPEC Abgleich gegen `name`, `surename` oder `familyname`. ANF live: Teilstring ohne Beachtung der Groß- und Kleinschreibung (ANF gilt vor SPEC, die nur "as a name" sagt).
- Contact, ContactAddress und CommunicationWay haben laut SPEC je GET, PUT und DELETE auf `/{Typ}/{id}`.
- Weitere Contact-Endpunkte: `GET /Contact/Factory/findContactsByCustomFieldValue`, `GET /Contact/{contactId}/getTabsItemCount`. Verhalten: **unbelegt** in dieser Wissensbasis.

### 3.5 Beispielobjekte (synthetisch)

Organisation (Antwortform, Typen wie live vermutet, siehe 2.6):

```json
{
  "id": "4001",
  "objectName": "Contact",
  "create": "2026-03-02T09:15:00+01:00",
  "update": "2026-03-02T09:15:00+01:00",
  "name": "Beispiel Maschinenbau GmbH",
  "status": "1000",
  "customerNumber": "KD-1001",
  "parent": null,
  "surename": null,
  "familyname": null,
  "titel": null,
  "category": {"id": "3", "objectName": "Category"},
  "description": null,
  "academicTitle": null,
  "gender": null,
  "sevClient": {"id": "1", "objectName": "SevClient"},
  "name2": null,
  "birthday": null,
  "vatNumber": "DE000000000",
  "bankAccount": null,
  "bankNumber": null,
  "defaultCashbackTime": null,
  "defaultCashbackPercent": "0",
  "defaultTimeToPay": "14",
  "taxNumber": null,
  "taxOffice": null,
  "exemptVat": "0",
  "defaultDiscountAmount": "0",
  "defaultDiscountPercentage": "0",
  "buyerReference": null,
  "governmentAgency": "0",
  "additionalInformation": null
}
```

Person (zu Organisation 4001 gehörig):

```json
{
  "id": "4002",
  "objectName": "Contact",
  "name": null,
  "surename": "Erika",
  "familyname": "Musterfrau",
  "name2": null,
  "titel": "Einkauf",
  "academicTitle": null,
  "gender": "w",
  "category": {"id": "3", "objectName": "Category"},
  "parent": {"id": "4001", "objectName": "Contact"},
  "customerNumber": "KD-1002",
  "status": "1000"
}
```

Wertformen der Nullfelder (`null` versus `"0"` versus Leerstring) in echten Antworten: **unbelegt**. Die Beispiele sind erfunden und zeigen nur Struktur.

## 4. ContactAddress und CommunicationWay

### 4.1 ContactAddress (`/ContactAddress`, `/ContactAddress/{id}`)

- Pflicht (`required`): `contact`, `country`, `category` (Request `Model_ContactAddress`). Die Response-Variante verlangt `contact` und `country`.
- Felder: `id`, `objectName` (`ContactAddress`), `create`, `update`, `contact {id, objectName: Contact}`, `street`, `zip` (Beschreibung "Zib code", Tippfehler der SPEC), `city`, `country {id, objectName: StaticCountry}`, `category {id, objectName: Category}` (Adresskategorien siehe 3.1), `name`, `name2`, `name3`, `name4`, `sevClient`.
- `name2` ist im Schema weder `nullable` noch in `required`. Ob es bei POST fehlen darf: **unbelegt**.
- ANF-Nutzung: `POST ContactAddress` mit `country` → StaticCountry.
- Eine Adresse als Standard markieren (`main`): kein Feld dafür in der SPEC. Die Rechnungsadresse wird bei Rechnungen über `takeDefaultAddress` gewählt (nur Verweis aus Drittquelle: Voraussetzung ist mindestens eine Adresse). **unbelegt**.

Beispiel:

```json
{
  "id": "5001",
  "objectName": "ContactAddress",
  "create": "2026-03-02T09:15:00+01:00",
  "update": "2026-03-02T09:15:00+01:00",
  "contact": {"id": "4001", "objectName": "Contact"},
  "street": "Beispielstraße 1",
  "zip": "10115",
  "city": "Berlin",
  "country": {"id": "1", "objectName": "StaticCountry"},
  "category": {"id": "47", "objectName": "Category"},
  "name": null,
  "sevClient": {"id": "1", "objectName": "SevClient"},
  "name2": null,
  "name3": null,
  "name4": null
}
```

### 4.2 CommunicationWay (`/CommunicationWay`, `/CommunicationWay/{id}`)

- Pflicht bei POST: `type`, `value`, `key`. Dazu `contact` (in der Spec nicht in `required`, fachlich nötig; ANF: "E-Mail oder Telefon zum Kontakt").
- `type`: Enum `EMAIL`, `PHONE`, `WEB`, `MOBILE`. `value`: die Adresse bzw. Nummer. `key {id, objectName: CommunicationWayKey}`. `main` boolean (Request) bzw. string (Antwort): Hauptkontaktweg. `sevClient`.
- Filter an `GET /CommunicationWay`: `contact[id]`, `contact[objectName]`, `type`, `main`.
- Wirkung von `main` (z. B. automatisch genau ein Hauptweg je Kontakt und Typ): **unbelegt**.

Beispiel:

```json
{
  "id": "6001",
  "objectName": "CommunicationWay",
  "create": "2026-03-02T09:16:00+01:00",
  "update": "2026-03-02T09:16:00+01:00",
  "contact": {"id": "4001", "objectName": "Contact"},
  "type": "EMAIL",
  "value": "kontakt@beispiel.example",
  "key": {"id": "2", "objectName": "CommunicationWayKey"},
  "main": "1",
  "sevClient": {"id": "1", "objectName": "SevClient"}
}
```

### 4.3 CommunicationWayKey (`GET /CommunicationWayKey`)

IDs und Namen laut SPEC (Tag CommunicationWay, Beschreibung des Endpunkts). GO-RS stimmt überein.

| id | name (Enum der SPEC) | translationCode (Beispiel der SPEC nur für id 2) |
|---|---|---|
| 1 | Privat | |
| 2 | Arbeit | `COMM_WAY_KEY_WORK` |
| 3 | Fax | |
| 4 | Mobil | |
| 5 | " " (Leerzeichen, "Empty") | |
| 6 | Autobox | |
| 7 | Newsletter | |
| 8 | Rechnungsadresse | |

- Antwortfelder: `id` (string), `objectName`, `create`, `upadate` (**Tippfehler der SPEC**, vermutlich `update`; ob die Live-API so antwortet: **unbelegt**), `name`, `translationCode`.
- Weitere translationCodes: **unbelegt** (Muster nur geraten).

## 5. StaticCountry

- Endpunkt `GET /StaticCountry` (nicht in der SPEC definiert, siehe Abschnitt 0). ANF: `GET StaticCountry?limit=300` als Länderliste.
- Struktur laut GO-MTN: `id`, `objectName` (`StaticCountry`), `code` (ISO 3166-1 alpha-2, **kleingeschrieben**, z. B. `de`), `name` (deutsch), `nameEn`, `locale` (z. B. `de_DE`), `priority`, `translationCode` (z. B. `COUNTRY_DE`), `additionalInformation`. Ein PHP-Client bestätigt die Felder `id`, `code`, `locale`, `name`, `name_en`, `priority`, `translation_code`, `additional_information` (https://github.com/itsmindcom/sevdesk-php-client/blob/main/docs/Model/ModelStaticCountryResponse.md). Dort ist nur `id` Pflicht.
- Bekannte IDs (Snapshot GO-RS `static_countries_data.go`, Drittquelle). Die SPEC nennt keine IDs:

| ISO | Land (de) | id |
|---|---|---|
| DE | Deutschland | 1 |
| CH | Schweiz | 2 |
| AT | Österreich | 3 |
| BE | Belgien | 6 |
| GB | Großbritannien | 9 |
| FR | Frankreich | 11 |
| IT | Italien | 14 |
| LU | Luxemburg | 17 |
| NL | Niederlande | 18 |
| PL | Polen | 21 |
| ES | Spanien | 29 |
| US | USA | 1353 |

- Es gibt mehrere Datensätze für denselben Code (z. B. England, Vereinigtes Königreich und Großbritannien unter `gb`). GO-RS nimmt je Code die niedrigste ID. Die vollständige Liste hat laut Datei grob 250 Einträge (Dateigröße 30 KB, Anzahl nicht gezählt, **unbelegt**).
- Ob die IDs über alle Konten identisch sind, ist durch den Namen "Static" naheliegend, aber **unbelegt**. Vollständige Liste für den Seed: vor Umsetzung gegen ein echtes Konto ziehen oder aus GO-RS `static_countries_data.go` ableiten (Lizenz der Datei vor Übernahme prüfen, **unbelegt**).

Beispiel:

```json
{
  "id": "1",
  "objectName": "StaticCountry",
  "code": "de",
  "name": "Deutschland",
  "nameEn": "Germany",
  "locale": "de_DE",
  "priority": "0",
  "translationCode": "COUNTRY_DE",
  "additionalInformation": null
}
```

(`priority` und Typen als Annahme; GO-MTN: "usually unset".)

## 6. SevUser

- Endpunkt `GET /SevUser` (nicht in SPEC). ANF: `e2e/bin/up` liest die erste Benutzer-ID als `contactPerson` für Rechnungen. `contactPerson` ist Pflicht bei `saveInvoice` (ANF 6.1).
- Felder laut GO-MTN (`User`, Drittquelle): `id`, `objectName` (`SevUser`), `create`, `update`, `username`, `firstName`, `lastName`, `fullname`, `email`, `gender`, `role`, `memberCode`, `languageCode` (z. B. `de`), `status` (z. B. 100), `clientOwner` (Boolean, Konto-Inhaber), `startDate`, `endDate`, `lastLogin`, `lastLoginIp`, `lastPasswordChange`, `forcePasswordChange`, `twoFactorAuth` (0 = aus), `welcomeScreenSeen`, `defaultReceiveMailCopy`, `hideMapsDirections`, `smtpHost`, `smtpPort`, `smtpSsl`, `smtpUser`, `smtpName`, `smtpMail`, `additionalInformation`, `sevClient`.
- Für den Seed genügt ein Benutzer mit `clientOwner` gesetzt. Werte von `role` und `memberCode`: **unbelegt**. Echte Antwortbeispiele lagen nicht vor.
- In Spec-Schemas steht SevUser nur als Referenz `{id, objectName: SevUser}` (`contactPerson`, `createUser`, `sevUser`).

Beispiel (synthetisch, Typen geraten):

```json
{
  "id": "7001",
  "objectName": "SevUser",
  "create": "2026-01-01T08:00:00+01:00",
  "update": "2026-01-01T08:00:00+01:00",
  "username": "demo@doppeldesk.example",
  "firstName": "Dana",
  "lastName": "Demo",
  "fullname": "Dana Demo",
  "email": "demo@doppeldesk.example",
  "languageCode": "de",
  "status": "100",
  "clientOwner": "1",
  "twoFactorAuth": "0",
  "sevClient": {"id": "1", "objectName": "SevClient"}
}
```

## 7. Unity (Einheiten)

- Endpunkt `GET /Unity` (plus POST, PUT, DELETE laut PHP-Clients, nicht in SPEC). Verwendung in der SPEC: `unity {id, objectName: Unity}` ist **Pflicht** in `Model_Part` und in allen Positionen (InvoicePos, OrderPos, CreditNotePos).
- Felder laut GO-MTN: `id`, `objectName` (`Unity`), `create`, `update`, `name` (z. B. `Stk`), `translationCode` (z. B. `UNITY_PIECE`), `uneceTradeUnitCode` (UN/ECE-Code für E-Rechnung, z. B. `H87`), `unitySystem`, `additionalInformation`, `sevClient`.
- **IDs:** Die SPEC nennt keine. Drittquellen sind **widersprüchlich**: eine Quelle nennt `1` = Stück, `2` = Stunde (npm-Paket `@honeyfield/sevdesk-mcp`, nur über Suchzusammenfassung gesehen, Seite nicht abrufbar), CTX nennt für `UNITY_HOUR` "typically id: 9" und rät, per `GET /Unity?limit=1000` über `translationCode` aufzulösen (weitere Codes `UNITY_DAYS`, `UNITY_MINUTE`). Ein Beispiel aus n8n-Community-Thread und PHP-Clients verwendet `"unity": {"id": 1, ...}` für Rechnungspositionen. **Verlässliche ID-Liste: unbelegt.**
- Empfehlung für den Seed: Einheiten mit stabiler `translationCode`, IDs frei, aber `1` für Stück (am besten belegt). Als **Annahme** kennzeichnen. Wird die Spec-Position mit unbekannter `unity.id` angelegt, ist das Verhalten **unbelegt**.

Seed-Vorschlag (Annahme, Namen und Codes aus Drittquellen, nur `UNITY_PIECE`/`H87` und `UNITY_HOUR` belegt):

| id | name | translationCode | uneceTradeUnitCode |
|---|---|---|---|
| 1 | Stk | `UNITY_PIECE` | `H87` |
| 9 | Std | `UNITY_HOUR` | `HUR` (Annahme, UN/ECE-Standardcode) |

Weitere Einheiten (Tage, Minuten, Pauschal, Monat usw.): nur `UNITY_DAYS` und `UNITY_MINUTE` als Codes belegt (CTX), IDs **unbelegt**.

## 8. TaxRule und TaxSet

- Die SPEC beschreibt die neue Steuerlogik ("sevdesk-Update 2.0", seit 2024). Ein Konto ist auf Version `1.0` oder `2.0`. Dokumente in 2.0 tragen `taxRule {id, objectName: TaxRule}` statt `taxType`/`taxSet`. Dokumente aus 1.0 behalten `taxType`/`taxSet {id, objectName: TaxSet}`. `taxType: custom` samt `taxSet` wird in 2.0 nicht mehr unterstützt. SPEC.
- Mapping alter Werte: `taxType: default` wird zu Regel 1 (Einnahmen) bzw. 9 (Ausgaben), `eu` zu 3, `noteu` zu 17, `ss` zu 11 (Einnahmen) bzw. 10 (Ausgaben). SPEC (Tabellen "Old property").
- Es gibt kein `GET /TaxRule` in der SPEC (eine Drittquelle erwähnt es, **unbelegt**). Die Regeln werden über `GET /ReceiptGuidance/forAllAccounts|forRevenue|forExpense|forAccountNumber|forTaxRule` lesbar (SPEC). Antwort `ReceiptGuideDto`: `accountDatevId`, `accountNumber`, `accountName`, `description`, `allowedTaxRules[] {name, description, id, taxRates[]}`, `allowedReceiptTypes[]`. `taxRates` sind Texte wie `ZERO`, `SEVEN`, `NINETEEN`.

| id | Name (SPEC, Deutsch) | erlaubte Sätze in Positionen | interner Code (GO-RS, Drittquelle) | Seite |
|---|---|---|---|---|
| 1 | Umsatzsteuerpflichtige Umsätze | 0, 7, 19 | `USTPFL_UMS_EINN` (auch SPEC-Beispiel) | Einnahmen |
| 2 | Ausfuhren | 0 | `AUSFUHREN` | Einnahmen |
| 3 | Innergemeinschaftliche Lieferungen | 0, 7, 19 | `INNERGEM_LIEF` | Einnahmen |
| 4 | Steuerfreie Umsätze §4 UStG | 0 | `STFREIE_UMS_P4` | Einnahmen |
| 5 | Reverse Charge gem. §13b UStG (Feld 60) | 0 | `REV_CHARGE_13B_1` | Einnahmen |
| 8 | Innergemeinschaftliche Erwerbe | 0, 7, 19 laut SPEC (GO-RS: Satz 0) | `INNERGEM_ERWERB` | Ausgaben |
| 9 | Vorsteuerabziehbare Aufwendungen | 0, 7, 19 | `VORST_ABZUGSF_AUFW` | Ausgaben |
| 10 | Nicht vorsteuerabziehbare Aufwendungen | 0 | unbekannt | Ausgaben (auch Kleinunternehmer) |
| 11 | Steuer nicht erhoben nach §19 UStG | 0 | unbekannt | Einnahmen, Kleinunternehmer |
| 12 | Reverse Charge §13b Abs. 2 mit Vorsteuerabzug | 0 | `REV_CHARGE_13B_MIT_VORST_ABZUG_0` | Ausgaben |
| 13 | Reverse Charge §13b ohne Vorsteuerabzug | 0 | `REV_CHARGE_13B_OHNE_VORST_ABZUG_0` | Ausgaben |
| 14 | Reverse Charge §13b Abs. 1 EU Umsätze | 0 | `REV_CHARGE_13B_EU_0` | Ausgaben |
| 15 | nicht steuerbare Steuerbewegungen | 0 | `NICHT_STEUERBAR_TAX` | nur Drittquelle, nicht in SPEC |
| 16 | nicht steuerbare Aufwendungen | 0 | `NICHT_STEUERBAR_EXPENSE` | nur Drittquelle, nicht in SPEC |
| 17 | Nicht im Inland steuerbare Leistung (z. B. Schweiz) | 0 | `NICHT_IM_INLAND_STEUERBAR` | Einnahmen |
| 18 | One Stop Shop (Waren) | je nach Zielland | unbekannt | Einnahmen |
| 19 | One Stop Shop (elektronische Leistung) | je nach Zielland | unbekannt | Einnahmen |
| 20 | One Stop Shop (sonstige Leistung) | je nach Zielland | unbekannt | Einnahmen |
| 21 | Reverse Charge gem. §18b UStG (Feld 21) | 0 | `REV_CHARGE_13B_1_USTG` | Einnahmen |
| 22 | nicht steuerbare Einnahmen | 0 | `NICHT_STEUERBAR_REVENUE` | nur Drittquelle, nicht in SPEC |

Hinweise:
- Spalten "Name", "Sätze" und "id" stammen für 1 bis 14, 17 bis 21 aus der SPEC (info.description). Die Namen 15, 16, 22 und alle internen Codes stammen aus GO-RS (verifiziert dort per `/ReceiptGuidance/forAllAccounts` am 2026-07-29). Inwieweit der Code-Name zur `name`-Ausgabe von `allowedTaxRules[].name` passt: laut `ReceiptGuideDto`-Beispiel `USTPFL_UMS_EINN`, die übrigen: Drittquelle.
- Einschränkungen (SPEC): Regel 5, 17, 18, 19, 20, 21 sind nicht für Voraus-, Teil- und Schlussrechnungen (`AR`, `TR`, `ER`) nutzbar. Regel 21 und 17 nicht in Vouchers. Regeln 18 bis 20 nicht als E-Rechnung und nicht mit eigenem Erlöskonto. Voraus- und Teilrechnungen nur mit Regel 1 oder 11.
- Regel 21 ("§18b") erschien am 2025-05-13 (NEWS-LIST). Regel 17 am 2024-12-17, OSS (18 bis 20) am 2025-03-06 (NEWS-LIST).
- Fehlerfall: Passt Steuersatz einer Position nicht zur Regel, antwortet sevDesk mit **422** (SPEC).
- Die Steuersätze 0, 7, 19 sind belegt. Weitere OSS-Länder-Sätze: **unbelegt**.
- `TaxSet` (nur System 1.0): Objekt `{id, objectName: TaxSet}`, keine Felder oder IDs in SPEC. **unbelegt**. Empfehlung: nur akzeptieren, nicht inhaltlich modellieren.

## 9. Part (Artikel)

- Endpunkte (SPEC): `GET/POST /Part`, `GET/PUT /Part/{partId}`, `GET /Part/{partId}/getStock`. Filter an `GET /Part`: `partNumber`, `name`. Ein `DELETE /Part/{id}` fehlt in der SPEC (live: **unbelegt**).
- Schema `Model_Part`: Pflicht `taxRate`, `unity`, `stock`, `name`, `partNumber`. Felder: `id`, `objectName` (`Part`), `create`, `update`, `name`, `partNumber`, `text`, `category {id, objectName: Category}` (Standard 1, Dienstleistung 97430, GO-RS), `stock` (number), `stockEnabled` (boolean), `unity`, `price` (veraltet: Netto, wird künftig Brutto, SPEC), `priceNet`, `priceGross`, `sevClient`, `pricePurchase`, `taxRate`, `status` (50 inaktiv, 100 aktiv), `internalComment`. GO-RS kennt zusätzlich `pricePartner`, `priceCustomer`, `secondUnityFactor`, `image`; in der SPEC fehlen sie (**unbelegt**).
- `getStock`: `{"objects": <integer>}`, Fehler 400 "Part was not found". SPEC.
- Bestandsführung: `stockEnabled` schaltet die Führung. Ob Rechnungen den Bestand verringern, ob negative Bestände zulässig sind, ob `stock` bei PUT direkt gesetzt oder nur über Bewegungen geändert wird: **unbelegt**. Empfehlung: `stock` ist schlicht ein gespeichertes Feld, `getStock` gibt es zurück (Annahme).
- Die SPEC nutzt für die GET-Antwort `Model_Part` mit numerischen `id` (anders als bei anderen Typen mit Response-Schema).
- Wirkung von `price` versus `priceNet`/`priceGross` (Berechnung aus `taxRate`): **unbelegt**.

Beispiel (Dienstleistung):

```json
{
  "id": 8001,
  "objectName": "Part",
  "create": "2026-01-10T10:00:00+01:00",
  "update": "2026-01-10T10:00:00+01:00",
  "name": "Beratung Stunde",
  "partNumber": "DL-0001",
  "text": "Beratungsleistung nach Aufwand",
  "category": {"id": "97430", "objectName": "Category"},
  "stock": 0,
  "stockEnabled": false,
  "unity": {"id": 9, "objectName": "Unity"},
  "price": 100,
  "priceNet": 100,
  "priceGross": 119,
  "sevClient": {"id": "1", "objectName": "SevClient"},
  "pricePurchase": null,
  "taxRate": 19,
  "status": 100,
  "internalComment": null
}
```

Beispiel (Artikel mit Lager):

```json
{
  "id": 8002,
  "objectName": "Part",
  "name": "Schraube M8",
  "partNumber": "ART-0100",
  "category": {"id": "1", "objectName": "Category"},
  "stock": 250,
  "stockEnabled": true,
  "unity": {"id": 1, "objectName": "Unity"},
  "priceNet": 0.12,
  "taxRate": 19,
  "status": 100
}
```

## 10. CheckAccount

- Endpunkte (SPEC): `GET /CheckAccount`, `GET|PUT|DELETE /CheckAccount/{id}`, `GET /CheckAccount/{id}/getBalanceAtDate`, `POST /CheckAccount/Factory/fileImportAccount`, `POST /CheckAccount/Factory/clearingAccount` (201, 400, 401, 422, 500).
- **Typen** (SPEC Tag CheckAccount, Feld `type`):
  - `online`: Bankkonten inklusive PayPal und CSV/MT940-Importkonten. Bank- und PayPal-Konten nur über die Oberfläche anlegbar, Dateiimport-Konten über den Endpunkt `fileImportAccount`.
  - `offline`: Verrechnungskonto ("Clearing Account"), über `clearingAccount` anlegbar.
  - `register`: Kasse, verhält sich wie `offline`.
  - Zahlungen per API lassen sich laut SPEC über ein Dateiimport-Konto erfassen ("If you want to create payment entries via API, use a file import account"). ANF nutzt ein Offline-Konto für `bookAmount`.
- Felder `Model_CheckAccountResponse`: `id`, `objectName` (`CheckAccount`), `create`, `update`, `sevClient`, `name`, `iban`, `type`, `importType` (`CSV`, `MT940` oder null), `currency`, `defaultAccount` ("0" oder "1"), `baseAccount` ("1" für das mitgelieferte Basiskonto), `priority`, `status` ("0" archiviert, "100" aktiv), `balance` (nur PayPal/finAPI), `bankServer`, `autoMapTransactions`, `autoSyncTransactions`, `lastSync`, `accountingNumber` (Buchungskonto, z. B. 1800 in SKR04 und 1200 in SKR03, muss unter den Konten eindeutig sein), `bic`.
- Update `Model_CheckAccountUpdate`: `name`, `defaultAccount`, `autoMapTransactions`, `accountingNumber`, `iban`, `bic`.
- Anlage-Request-Schemas `createClearingAccount`/`createFileImportAccount`: Details nicht ausgewertet. GO-RS (Drittquelle): `name` Pflicht, `accountingNumber` optional, bei Dateiimport zusätzlich `importType` Pflicht und `iban` optional.
- 404 bei unbekannter ID: `No Model_CheckAccount with the id <id> was found` (ANF, live).
- Weitere in SPEC: `CheckAccountTransaction`, `PrivateTransactionRule` (hier nicht behandelt, siehe andere Wissensdateien).
- `getBalanceAtDate`: Berechnung und Antwortform: **unbelegt** in dieser Datei.

Beispiel (Offline-Konto, wie es eine Integration nutzt):

```json
{
  "id": "9001",
  "objectName": "CheckAccount",
  "create": "2026-01-01T08:00:00+01:00",
  "update": "2026-01-01T08:00:00+01:00",
  "sevClient": {"id": "1", "objectName": "SevClient"},
  "name": "Verrechnungskonto",
  "iban": null,
  "type": "offline",
  "importType": null,
  "currency": "EUR",
  "defaultAccount": "1",
  "baseAccount": "1",
  "priority": "0",
  "status": "100",
  "balance": null,
  "bankServer": null,
  "autoMapTransactions": "1",
  "autoSyncTransactions": "0",
  "lastSync": null,
  "accountingNumber": "1200",
  "bic": null
}
```

Ob das Basiskonto eines frischen sevDesk-Kontos Typ `offline` hat, wie es heißt und welche ID es trägt: **unbelegt**.

## 11. SevClient

- Kein `GET /SevClient` in der SPEC. Einziger Pfad: `PUT /SevClient/{SevClientId}/updateExportConfig` (Tag Export) mit Body `accountantNumber` (number), `accountantClientNumber` (number), `accountingYearBegin` (number, Timestamp), alle Pflicht. Antwort `{"objects": null}` im Schema.
- Jede mandantenbezogene Ressource trägt `sevClient {id, objectName: SevClient}` ("Will be filled automatically", schreibgeschützt). Im Mock: je Token eine feste SevClient-ID. 
- Aus der SPEC (E-Rechnung, Tag Invoice) ableitbare SevClient-Felder: `addressStreet`, `addressZip`, `addressCity`, `bankIban`, `bankBic`, `contactEmail`, `contactPhone`, `taxNumber`, `vatNumber`. Außerdem `defaultCurrency` (SPEC, Abschnitt Invoicing: "currency deviating from the clients defaultCurrency"). Weitere Felder: **unbelegt**.
- Kleinunternehmer-Einstellung: beeinflusst laut SPEC die erlaubten Steuerregeln (Abschnitt Tax Rules, ReceiptGuidance). Name des Feldes im Client-Objekt: **unbelegt**.

Seed-Vorschlag (Annahme, nur Felder aus der SPEC-Liste, Werte erfunden):

```json
{
  "id": "1",
  "objectName": "SevClient",
  "name": "Demo Unternehmen GmbH",
  "addressStreet": "Musterweg 5",
  "addressZip": "10115",
  "addressCity": "Berlin",
  "bankIban": "DE00000000000000000000",
  "bankBic": "DEMODEFFXXX",
  "contactEmail": "kontakt@demo-unternehmen.example",
  "contactPhone": "+49 30 0000000",
  "taxNumber": "00/000/00000",
  "vatNumber": "DE000000000",
  "defaultCurrency": "EUR"
}
```

(`name` ist als Feld nicht belegt.)

## 12. Basics: bookkeepingSystemVersion

- `GET /Tools/bookkeepingSystemVersion` liefert `{"objects": {"version": "1.0" | "2.0"}}`, Beispiel der SPEC: `"2.0"`. Fehler: 401.
- 2.0 ist seit 2024 das neue System, ein Konto wird auf die neue Version umgestellt ("Started in 2024 ... The old version will be available for some customers until the end of 2024"). Neu angelegte Belege in 2.0 tragen `taxRule`, ältere behalten `taxType` (SPEC, GO-RS).
- Empfehlung: DoppelDesk meldet fest `2.0` (konfigurierbar, **Annahme**). Das Verhalten von System 1.0 (taxType, accountingType, Statuswechsel) nachzubilden ist nicht sinnvoll, die SPEC nennt es als "this documentation holds the most current version".
- Relevante 2.0-Regeln (SPEC): Belege entstehen nur im Status Entwurf (100 bei Rechnung/Gutschrift, 50 bei Voucher). `enshrined` nur über den `enshrine`-Endpunkt setzbar. `changeStatus` ist entfernt.

## 13. Weitere API-Konventionen

- **Referenzen:** verschachtelte Objekte als `{"id": <id>, "objectName": "<Typ>"}`. IDs in Requests akzeptieren Zahl oder String (**Annahme**; Beispiele der SPEC verwenden Zahl bei `unity.id` und String bei `category.id`).
- **Query-Syntax für Objektfilter:** `contact[id]=1&contact[objectName]=Contact` (qs-Notation, im Stack vorhanden).
- **Aktualisierungen:** `PUT /{Typ}/{id}` mit Teilobjekt. Ob Felder, die fehlen, unverändert bleiben: **unbelegt**; die Spec-Update-Schemas (`Model_ContactUpdate`) lassen alle Felder optional.
- **Datum/Zeit:** Timestamps im Request als Unix-Sekunden, in der Antwort ISO 8601 mit Offset (ANF). Zeitzone Europe/Berlin (ANF).
- **API-News mit Auswirkung auf Mock:**
  - 2025-03-11: Pagination-Limits (siehe 2.2).
  - 2025-02-06: Token-Query-Parameter entfernt (siehe 1).
  - 2026-02-19: ab 2026-04-07 liefern `render`, `changeParameter` und `sendByWithRender` das PDF vollständig als Base64 in `objects.pdf` statt `thumbs`/`pages`. Betroffen: 12 Endpunkte an CreditNote, Invoice, Letter, Order.
  - 2025-03-20: neue DATEV-Export-Endpunkte (Details nicht gelesen).

## 14. Umsetzungsfolgen für DoppelDesk

1. Zusätzliche Referenz-Endpunkte außerhalb der SPEC bereitstellen: `StaticCountry`, `Category`, `Unity`, `SevUser`, `SevClient`, `SevSequence`, ggf. `TaxRule`. Sie nutzen das schemalose Dokumentenmodell und werden vom Seed gefüllt.
2. Seed-Stufen: `none` enthält Länder (mindestens DE, AT, CH plus die Liste aus Abschnitt 5), Kategorien (Abschnitt 3.1), CommunicationWayKeys (4.3), Einheiten (7), einen SevUser, einen SevClient und das mitgelieferte Basiskonto (Offline-CheckAccount). `basic` ergänzt Bankkonto und Kasse. `demo` ergänzt Kontakte mit Adressen und Kommunikationswegen, Artikel und Rechnungen.
3. Paginierung zentral: `limit` 1 bis 1000 prüfen, sonst 400 mit der Meldung aus 2.2. `countAll` liefert `total`.
4. Fehlerformat zentral: `{"objects": null, "error": {"message", "exceptionUUID"}}`.
5. Kundennummer: Nummernkreis-Mechanik mit `getNextCustomerNumber` und `checkCustomerNumberAvailability`, Format als konfigurierbare Annahme.
6. Offene Punkte (vor Umsetzung gegen ein Testkonto klären): Default-Limit, Typen in Antworten, Form von `total`, Unity-IDs, Kategorie 355842 allgemein gültig, Voll-Liste StaticCountry, Felder von SevClient und SevUser, Bestandsführung von Part.
