# Architektur

DoppelDesk ist ein zustandsbehafteter Fake-Server für die sevDesk-API. Er liest die offizielle OpenAPI-Spezifikation beim Start ein und stellt jede Operation daraus unter `/api/v1` bereit. Fachliches Verhalten kommt aus handgeschriebenen Domain-Modulen, alles andere aus generischen Handlern.

## Modulübersicht

| Pfad | Aufgabe |
|---|---|
| `src/main.ts` | Einstieg: Konfiguration laden, Server bauen, lauschen, bei SIGINT/SIGTERM sauber beenden |
| `src/server.ts` | Verdrahtung: Fastify, Spec, Mandanten, Persistenz, Routen, Kontroll-API |
| `src/config.ts` | Umgebungsvariablen mit Defaults und Validierung |
| `src/spec/` | Laden der Spec (`loader.ts`), Korrekturen bekannter Spec-Fehler (`patches.ts`), `$ref`-Auflösung und Operationstabelle (`specIndex.ts`), Typen |
| `src/serialize/` | Schemagetriebene Formung der Antworten (`serializer.ts`, dort auch `schemaPropertyNames`: alle Eigenschaftsnamen eines Schemas inklusive `$ref`, `allOf`, `oneOf`/`anyOf` und Items), Hülle (`envelope.ts`), deterministische Beispielwerte (`sample.ts`) |
| `src/store/` | Schemaloser Dokumentenspeicher je Modell (`collection.ts`, `documentStore.ts`), Nummernkreise, Datei-Persistenz |
| `src/tenant/` | Mandant je API-Token (`tenant.ts`, `registry.ts`), Anfrageprotokoll, Störfälle, Snapshot-Import |
| `src/http/` | Body- und Query-Parsing, Authentifizierung, API-Routen, Störfall-Antworten, Fehlerformat auch für Client-Fehler des HTTP-Parsers (`clientErrorHandler`); `requestState.ts` bindet Mandant und Uhrzeit an die Anfrage (`bindTenant`) |
| `src/routes/` | Routentypen, Zusammenführung von Spec und Domain-Routen (`registry.ts`), generische Handler (`generic.ts`), Prüfung der Request-Werte gegen das Request-Schema (`requestBody.ts`), Filter unbekannter Felder bei Anlegen und Ändern (`knownFields.ts`) |
| `src/domain/` | Domain-Module (`invoice`, `creditNote`, `order`, `contact`, `masterData`, `accounting`) und die gemeinsame Fachlogik in `shared/` |
| `src/seed/` | Seed-Stufen `none` (Referenzdaten und Basiskonto), `basic` (`none` plus Bankkonto und Kasse) und `demo` (`basic` plus Beispielbestand), Daten in `src/seed/data/*.json` |
| `src/control/` | Kontroll-API unter `/__doppeldesk` |
| `src/lib/` | Zeit (Europe/Berlin), Fehlerklasse `ApiError`, Pfad-Hilfen, Objekt-Hilfen, Lesen von Zahlen und Booleans (`coerce.ts`) |

## Ablauf einer Anfrage

1. Fastify parst die Query mit `qs` (Klammernotation, `contact[id]=1` wird zu `{contact: {id: "1"}}`) und den Body: JSON, `application/x-www-form-urlencoded` über `qs`, alles andere als roher Buffer (Multipart-Uploads brechen nicht ab).
2. Der `onRequest`-Hook prüft für Pfade unter dem Basispfad den Token aus `Authorization: <token>` (auch `Bearer <token>`). Der Query-Parameter `token` authentifiziert wie bei sevDesk seit April 2025 nicht mehr; er wird aber entfernt, bevor Handler oder Anfrageprotokoll die Query sehen. Ohne gültigen Token folgt HTTP 401 `Authentication required`.
3. Im selben `onRequest`-Hook, direkt nach der Authentifizierung und vor dem Parsen des Bodys, wertet DoppelDesk die aktiven Störfälle des Mandanten aus (`bindTenant` bindet dazu Mandant und Uhrzeit an die Anfrage). Trifft einer zu, antwortet DoppelDesk mit dem Störfall. Ein passender Störfall gewinnt damit über Body-Parserfehler (unlesbares JSON, falscher Content-Type, zu großer Body); ein ungültiger Token ergibt weiter 401 vor allen Störfällen. Die Spec-Route kommt über die Fastify-Routenkonfiguration (`config.route`), der NotFound-Handler wertet keine Störfälle aus.
4. Hat die Route eine Spec-Operation, prüft `src/routes/requestBody.ts` die Werte des Bodys gegen deren Request-Schema (siehe „Prüfung der Request-Werte“). Bei `POST /{Modell}` und `PUT /{Modell}/{id}` mit Spec-Operation sieht der Handler in `context.input` danach nur Eigenschaften, die das Modell kennt (Request-Body-Schema und Antwortschema, dazu Server-Felder und `mapAll`); unbekannte Felder werden still verworfen. `context.body` bleibt unverändert.
5. Der Handler bekommt einen `RouteContext` (Mandant, Pfadparameter, Query, Body, Header ohne Zugangsdaten, Spec-Operation) und liefert `{status?, objects, total?}` oder wirft einen `ApiError`.
6. Der Kern formt `objects` nach dem Antwortschema und verpackt sie als `{"objects": ...}`. `total` erscheint nur, wenn der Handler es setzt (Listen mit `countAll=true`).
7. Der `onResponse`-Hook schreibt den Eintrag ins Anfrageprotokoll des Mandanten. Token und Header werden nie gespeichert. Der Eintrag enthält `time` (Wandzeit in UTC, Beginn der Anfrage) und `clockTime` (Mandantenuhr beim Eintreffen der Anfrage, ISO 8601 Europe/Berlin, bei eingefrorener Uhr deren Zeitpunkt). Eine Anfrage, die ein Störfall beantwortet, hat im Protokoll `body: null`, weil der Body vor der Störfall-Antwort nicht gelesen wird. HEAD-Anfragen auf GET-Routen verbrauchen GET-Störfälle, weil die Methode von der Route kommt.

Fehler haben überall die Form `{"objects": null, "error": {"message": "...", "code": null, "data": null, "exceptionUUID": "..."}}`, auch Fehler, die der Router vor jeder Route auslöst (fehlerhafte URL-Kodierung wie `%E0%A4%A`: 400, über die Fastify-Option `frameworkErrors`). Auch Anfragen, die der Node-HTTP-Parser vor Fastify abweist (rohe Nicht-ASCII-Zeichen in der URL, ungültige Request-Zeile, Header-Overflow 431, Request-Timeout 408), beantwortet die Fastify-Option `clientErrorHandler` (`src/http/errorHandler.ts`) in dieser Form und schließt danach die Verbindung. Rohe UTF-8-Bytes in der URL (`curl --globoff ...?name=äöü`) lassen sich nicht dekodieren, Node weist sie ab (`HPE_INVALID_URL`, auch mit `insecureHTTPParser`): Antwort 400 `Invalid character in the request URL. Percent-encode non-ASCII characters as UTF-8 (e.g. %C3%A4)`. Der Handler kennt den Pfad nicht und gilt daher für alle Pfade, nicht nur unter dem Basispfad. Prozent-kodiertes UTF-8 funktioniert normal. Die `exceptionUUID` wird aus der Meldung abgeleitet, damit Antworten deterministisch bleiben. Für fehlende Objekte lautet die Meldung `No Model_<Typ> with the id <id> was found`.

Die Domain-Module folgen einer gemeinsamen Fehlerpolitik (`src/domain/shared/validation.ts`):

- **400:** Die Anfrage ist fehlerhaft: Factory-Hülle ohne `objectName` oder `mapAll` (`<Schlüssel> expected array with 'id' and 'objectName'. <Typ> given`), unbrauchbare Referenzen, unlesbare Werte, fehlende oder ungültige Parameter von Aktionen wie `sendBy` und `bookAmount`.
- **404:** Eine Referenz zeigt auf ein fehlendes Objekt (`No Model_<Typ> with the id <id> was found`), etwa Kontakt, Kategorie, Land oder Kommunikationsweg-Schlüssel bei Kontakten und ihren Teilen.
- **409:** Löschen eines Objekts, auf das noch andere verweisen: ein Beleg, der kein Entwurf ist, ein Zahlungskonto mit Transaktionen, ein Kontakt mit Belegen, ein Artikel in Positionen, eine Transaktion, auf die ein Beleg gebucht ist. Außerdem Änderungen an Positionen eines Auftrags, der kein Entwurf ist. Den Verweis findet `src/domain/shared/references.ts` über alle Collections.
- **422:** Eine formal korrekte Anfrage verletzt eine fachliche Regel: Pflichtfelder eines Belegs in einer Factory, Statuswechsel, festgeschriebene Belege, Steuerregel und Steuersatz (auch bei Artikeln: ein Satz außer 0, 7 und 19).

## Routing

Jede Route hat einen Schlüssel aus Methode und Pfad, in dem die Parameternamen gelöscht sind, zum Beispiel `GET /Invoice/{}`. `src/routes/registry.ts` führt zusammen:

- **generic:** Spec-Operation ohne Domain-Route, Handler nach Pfadform.
- **domain:** Domain-Route mit demselben Schlüssel wie eine Spec-Operation; sie ersetzt den generischen Handler.
- **extra:** Domain-Route, die in der Spec fehlt (etwa `GET /StaticCountry`, `DELETE /Invoice/{id}` oder `DELETE /Voucher/{id}`).

Jeder Schlüssel wird genau einmal in Fastify registriert. Intern nutzt Fastify positionale Parameternamen, der Handler sieht trotzdem die Namen aus seiner eigenen Vorlage. `GET /__doppeldesk/routes` listet alle Routen mit ihrer Art.

Generische Handler nach Pfadform, der erste Pfadteil ist der Name der Collection:

| Pfadform | Verhalten |
|---|---|
| `GET /{Model}` | Liste mit `limit` (1 bis 1000, Default 100), `offset` (negativ oder unlesbar zählt als 0), `countAll`, Gleichheitsfiltern und `embed` |
| `POST /{Model}` | Anlegen mit `id`, `objectName`, `create`, `update`, `sevClient`, unbekannte Felder werden ignoriert; fehlt ein Pflichtfeld des Request-Schemas, folgt 400 `Missing required parameter(s): ...` (ohne `objectName`, `mapAll` und Server-Felder) |
| `GET /{Model}/{id}` | Array mit einem Element, sonst 404 |
| `PUT /{Model}/{id}` | flaches Zusammenführen mit dem gespeicherten Dokument, unbekannte Felder werden ignoriert |
| `DELETE /{Model}/{id}` | `{"objects": [null]}` |
| alles andere | mit `{id}`: 404, wenn das Objekt fehlt; beschreibt das Antwortschema das Modell, kommt das gespeicherte Objekt, sonst ein deterministischer Beispielwert aus dem Schema (Objekte mit `id` und `objectName` mit ID `"0"` und Modellnamen) |

## Serialisierung

Der Speicher ist schemalos. Erst die Antwort wird nach dem Schema geformt. Bekannte Fehler der Spec korrigiert `src/spec/patches.ts` direkt nach dem Laden, damit generische und Domain-Routen gleich formen. Welche Korrekturen gegriffen haben, zeigt `GET /__doppeldesk/health`:

- `Model_InvoicePosResponse.quantity` ist in der Spec ein Boolean und wird als String ausgegeben.
- Positionsantworten (Rechnung, Gutschrift, Auftrag) bekommen `sumNet`, `sumTax` und `sumGross`.
- IDs sind immer Strings, in Referenzen (`{id, objectName}`) wie als eigene ID eines Objekts (etwa `Model_PartResponse`, `Model_ContactAddressResponse`), auch wo die Spec `integer` deklariert.

Regeln der Formung:

- Das Schema von `objects` kommt aus der Spec. Hat das Antwortschema eine Eigenschaft `objects`, gilt deren Schema, sonst das ganze Antwortschema (die Spec deklariert manche Antworten ohne Hülle).
- Ist das Schema ein Array und der Wert ein Einzelobjekt, wird es in ein Array gepackt. Ist der Wert ein Array und das Schema ein Einzelobjekt, wird jedes Element geformt.
- Typen werden angeglichen: Zahl zu String, Boolean zu `"1"`/`"0"` bei String-Feldern, numerische Strings zu Zahlen, `"1"`/`"0"`/`"true"`/`"false"` zu Boolean.
- Datumsfelder (Format `date-time` oder ein ISO-Beispiel im Schema) erscheinen als ISO 8601 mit Berliner Offset, etwa `2026-10-01T00:00:00+02:00`. Felder mit Format `date` (etwa `Contact.birthday`) erscheinen als `YYYY-MM-DD`, gleich in welchem lesbaren Format sie gesendet wurden.
- Fehlende Schemafelder werden mit `null` gefüllt, zusätzliche gespeicherte Felder bleiben erhalten.
- Eingebettete Objekte (`embed=contact`) werden wie das Modell selbst geformt: Deklariert das Schema an der Stelle nur eine Referenz `{id, objectName}`, der Wert trägt aber weitere Felder, gilt das Schema von `GET /{objectName}/{id}`, ersatzweise `Model_<objectName>Response` oder `Model_<objectName>`.

## Prüfung der Request-Werte

Vor dem Handler prüft `src/routes/requestBody.ts` jeden JSON- oder Formular-Body gegen das Request-Schema der Spec-Operation. Ein Wert, der sich nicht als der deklarierte Typ lesen lässt, ergibt 400 `Invalid value given for '<feld>'` (Feldnamen in Klammernotation, etwa `invoicePosSave[0][price]`):

- Text: kein Objekt und kein Array. Mit Format `date` oder `date-time` muss der Wert ein lesbares Datum sein (Unix-Sekunden, `Y-m-d`, `d.m.Y`, ISO 8601, Jahre 0001 bis 9999).
- Zahl: eine Zahl, ein Dezimal-String (Punkt oder Komma) oder ein Boolean.
- Boolean: `true`/`false`, `1`/`0` und deren String-Formen.

Fehlende Werte, `null` und `""` gehen durch (Pflichtfelder prüfen die Handler bzw. generisch `POST /{Model}`), ebenso schreibgeschützte Felder und die Server-Felder `id`, `objectName`, `create`, `update`, `sevClient`. Hat ein Wert eine andere Form als das Schema (etwa eine nackte ID, wo eine Referenz deklariert ist), entscheidet der Handler. Enums werden nicht allgemein geprüft, weil die Spec-Enums unvollständig sind (z. B. Steuerregeln); Domain-Module prüfen die Enums, auf die sie sich verlassen (etwa `invoiceType` und `status` in `saveInvoice`).

Liest ein Handler ein Feld bewusst anders als sein Spec-Typ, nennt die Route es in `unvalidatedFields` (Punktnotation ohne Index): `date` bei `bookAmount` (Spec `integer`, akzeptiert wird jedes lesbare Datum) und `invoice.deliveryDateUntil` bei `saveInvoice` (Spec `integer`, gelesen wie die anderen Datumsfelder).

## Eine Domain-Route hinzufügen

Ein Domain-Modul exportiert ein `DomainModule` und ist in `src/domain/index.ts` eingetragen. `models` nennt die Collections, die das Modul verantwortet (sichtbar in `GET /__doppeldesk/routes`):

```ts
import { pathParam } from "../../routes/context.ts";
import type { DomainModule } from "../../routes/types.ts";
import { sendBy } from "../shared/sending.ts";
import { INVOICE_SENDABLE } from "./constants.ts";

export const invoiceModule: DomainModule = {
  name: "invoice",
  models: ["Invoice", "InvoicePos", "InvoiceLog", "Discounts"],
  routes: [
    {
      method: "PUT",
      path: "/Invoice/{invoiceId}/sendBy",
      handler: (context) => ({
        objects: sendBy(context.tenant, INVOICE_SENDABLE, pathParam(context, "invoiceId"), context.input),
      }),
    },
  ],
};
```

Ohne `responseSchema` gilt das Antwortschema der Spec-Operation. Routen außerhalb der Spec können einen Schemanamen angeben (`responseSchema: "Model_InvoiceResponse"`), sonst bleibt ihre Antwort ungeformt. Die generischen Handler aus `src/routes/generic.ts` lassen sich wiederverwenden, etwa `listModel(context, "Invoice", {filters})`.

Domain-Routen mit der Form `POST /{Modell}` oder `PUT /{Modell}/{id}` und Spec-Operation (z. B. Contact, Part) bekommen von dem Wrapper `withKnownFields` im Registry (`src/routes/knownFields.ts`) bereits gefilterte `context.input`. Handler auf anderen Pfadformen (Aktionen, Factories) erhalten den Body ungefiltert. Eine Factory mit Beleg-Teilen deklariert sie in der Route als `factoryParts` (`{field, responseField?, extraFields?}`, etwa `invoice`, `invoicePosSave`, `discountSave`); der Wrapper `withKnownFactoryParts` entfernt dann in diesen Teilen alle Eigenschaften, die weder das Request-Schema des Teils noch der passende Antwortteil, die Server-Felder oder `extraFields` (vom Domain-Modul gelesene, in der Spec nicht deklarierte Felder) kennen. So arbeiten `saveInvoice`, `saveVoucher`, `saveCreditNote` und `saveOrder`. Services und Seeds rufen die Domain-Funktionen direkt auf und umgehen den Filter. Der Filter wirkt nur auf die oberste Ebene der Felder.

## Gemeinsame Fachlogik

`src/domain/shared/` enthält alles, was mehrere Module brauchen. Ein Modul beschreibt seine Besonderheiten als kleine Konfiguration, die Abläufe selbst gibt es nur einmal:

| Datei | Inhalt |
|---|---|
| `validation.ts` | Fehlerpolitik, Factory-Hülle (`factoryPart`, `expectedRefError`), Listenparameter (`listOf`, `deletedIds`), Referenzen (`requireRef`, `requireRefTo` und `normalizeRefs` mit festem Modell je Feld), `missingParameters`, `invalidParameter`, `validationError` |
| `documents.ts` | Anlegen, Ändern und Patchen mit Stempeln (`create`, `update`, `sevClient`), Löschen mit Abhängigen (Positionen, `Discounts`, `TagRelation`) |
| `list.ts`, `filters.ts`, `tags.ts` | Pagination (auch für Listen außerhalb des Stores: `paginate`), Gleichheitsfilter, `embed`, Datumsfilter (Unix-only), Teilstring- und Nummernfilter, Sortierung nach Belegnummer, Tag-Filter |
| `positions.ts` | Positionen eines Belegs (`PositionModel`), Sortierung im Beleg und über Belege hinweg (`documentPositionOrder`), nächste Positionsnummer |
| `discounts.ts` | Positionsrabatt zwischen 0 und 100 Prozent |
| `money.ts`, `taxRules.ts` | Positions- und Kopfsummen, Rundung, Prüfung Steuerregel gegen Steuersatz |
| `numbering.ts` | Nummernkreise mit Präfix und Startwert, Rückgabe einer Nummer, eindeutige Belegnummern (`assignNumber`, `issueFreeNumber`, `peekFreeNumber`); `GET /SevSequence` zeigt die Kreise |
| `payments.ts`, `checkAccounts.ts` | `bookAmount` und Entkoppeln von Zahlungen für alle zahlbaren Belege (`PayableModel`: Rechnung, Gutschrift, Beleg), automatische Transaktionen, Kontostand. Zurücksetzen entkoppelt nur den eigenen Beleg, eine Transaktion mit weiteren Buchungen bleibt gebucht |
| `sending.ts` | `sendBy`, `sendViaEmail` und der Versand beim PDF-Abruf (`SendableModel`: Rechnung, Gutschrift, Auftrag) |
| `rendering.ts`, `pdf.ts` | deterministische Platzhalter-PDFs, Antworten von `getPdf`, `render` und `changeParameter` |
| `contacts.ts` | Kontaktname, Standardadresse (`takeDefaultAddress`), E-Mail des Bearbeiters |
| `refs.ts` | Referenzen `{id, objectName}` lesen und bauen |
| `contact/communicationWayKeys.ts` (außerhalb von `shared/`) | einzige Quelle der `CommunicationWayKey`-Stammdaten: `COMMUNICATION_WAY_KEYS` (`readonly PlainObject[]` mit `id`, `name`, `translationCode`, ohne Stempel). Die Seeds stempeln `objectName`, `create`, `update` und `sevClient` selbst. |
| `references.ts` | Verweise auf ein Objekt in allen Collections finden (Löschschutz, Kaskaden), referenzierte Objekte prüfen (404), geprüfte Kopfreferenzen von Belegen (`DOCUMENT_HEAD_REFERENCES`) |

Ein Modul verwendet die gemeinsamen Abläufe so:

```ts
export const INVOICE_PAYABLE: PayableModel = {
  model: "Invoice",
  logModel: "InvoiceLog",
  logRef: "creditNote",
  logAmountField: "ammountPayed",
  bookingTypes: BOOKING_TYPES,
  bookableStatuses: [200, 750],
  paidStatus: 1000,
  partiallyPaidStatus: 750,
  direction: () => 1,
  purpose: (invoice) => (typeof invoice.invoiceNumber === "string" ? invoice.invoiceNumber : null),
  payee: contactPayee("contact"),
};

bookAmount(tenant, INVOICE_PAYABLE, id, input);
```

Anfrage-Steuerfelder wie `mapAll` werden auf keinem Beleg gespeichert (`clientFields` filtert sie, der frühere Default `mapAll: true` in `saveVoucher` ist entfernt). Neu angelegte Belege tragen kein `mapAll`; die Antwort zeigt es bei Belegen nur als schemagefülltes `null`.

Seeds und andere Module nutzen dieselben Dienste wie die Routen (`saveInvoice`, `bookInvoiceAmount`, `bookVoucherAmount`, `markSent` usw.), damit der Demo-Datenbestand genau so aussieht, wie ihn die API erzeugen würde.

## Mandanten, Zeit und Persistenz

- Jeder Token ist ein eigener Mandant mit Dokumenten, Nummernkreisen, Uhr, Störfällen und Anfrageprotokoll.
- IDs sind numerische Strings, fortlaufend je Collection ab 1.
- Die Uhr läuft standardmäßig in Echtzeit. Über die Kontroll-API lässt sie sich einfrieren oder auf einen Zeitpunkt stellen und weiterlaufen lassen. Alle Daten gelten in Europe/Berlin.
- Mit `DOPPELDESK_PERSIST=file` liegen alle Mandanten in `<DATA_DIR>/state.json`. Geschrieben wird verzögert nach Änderungen und beim Beenden. Die Uhr gehört zum Snapshot und wird mitgespeichert: Eine eingefrorene oder verschobene Uhr gilt nach einem Neustart weiter. Störfälle und Anfrageprotokoll werden nicht gespeichert.
- Beim Beenden (`server.close()`) enden zuerst wartende `timeout`-Störfälle (Verbindung ohne Antwort geschlossen), dann wird der Stand geschrieben, dann arbeitet Fastify offene Anfragen ab, danach wird noch einmal geschrieben, falls sich beim Abarbeiten etwas geändert hat. Ein harter Abbruch nach einer Frist (etwa `docker compose stop`) verliert so nichts, was vor dem Signal geändert wurde.
- Mit `DOPPELDESK_PERSIST=file` legt der Start das Datenverzeichnis an und probiert den Schreibweg (Temporärdatei) aus. Schlägt das fehl, bricht der Start ab, statt ohne Persistenz weiterzulaufen.
- Gespeicherte Mandanten, deren Token nicht mehr in `DOPPELDESK_TOKENS` steht, ruhen: Sie werden nicht bedient, bleiben aber in `state.json` erhalten (Warnung beim Start). Wird der Token wieder eingetragen, ist der Zustand wieder da.
- Ist der Port belegt oder lässt sich die Adresse nicht binden, bricht der Start mit einer einzeiligen Meldung (`Startup error: ...`) ab. Der Stand wird dabei nicht geschrieben, damit eine zweite Instanz mit demselben Datenverzeichnis den Stand der laufenden nicht überschreibt.
- Ist `state.json` unlesbar oder beschädigt, bricht der Start mit einer Meldung samt Dateipfad ab. Dasselbe gilt für eine nicht ladbare Spec aus `DOPPELDESK_SPEC`. Eine Spec ohne jede Operation gilt als nicht ladbar; im Modus `auto` greift dann der Cache bzw. die mitgelieferte Kopie, und eine solche Spec wird nicht in den Cache geschrieben.
- Der Seed wird angewendet, wenn ein Mandant neu entsteht oder zurückgesetzt wird, nicht beim Laden aus der Datei.

## Kontroll-API

Alle Endpunkte liegen unter `/__doppeldesk` und antworten mit JSON. Mandantenbezogene Endpunkte wählen den Mandanten über den API-Token im Header `Authorization`. Ist `DOPPELDESK_CONTROL_TOKEN` gesetzt, verlangen alle Endpunkte außer `/health` den Header `X-DoppelDesk-Control-Token`.

| Methode und Pfad | Zweck |
|---|---|
| `GET /health` | Status, Spec-Quelle, Anzahl der Operationen, angewendete Spec-Korrekturen, Persistenz, Seed (ohne Authentifizierung) |
| `GET /routes` | alle Routen mit Art `generic`, `domain` oder `extra` sowie die Domain-Module mit ihren Collections |
| `POST /reset` | Mandant leeren und Seed anwenden, Body `{"seed": "none" \| "basic" \| "demo"}` optional (ohne Body oder ohne `seed` gilt `DOPPELDESK_SEED`); ein Body, der nicht als JSON (`Content-Type: application/json`) gesendet wird oder kein JSON-Objekt ist, ein anderer Schlüssel als `seed` und `seed` im Query-String ergeben 400; ein leerer Body zählt als kein Body; leert auch Uhr, Störfälle und Protokoll |
| `GET /state`, `PUT /state` | Snapshot des Mandanten exportieren bzw. importieren. Der Import prüft den Snapshot (doppelte Dokument-IDs in einer Collection, negative oder nicht ganzzahlige Nummernkreise und `lastId`, ungültige Uhr ergeben 400). Stammt der Snapshot von einem anderen Mandanten (`sevClientId` weicht ab), werden das `SevClient`-Dokument und alle Referenzen `{id, objectName: "SevClient"}` auf die `sevClientId` des importierenden Mandanten umgeschrieben. |
| `GET /clock`, `POST /clock` | Uhr lesen bzw. setzen: `{"now": ISO \| Unix-Sekunden \| null, "frozen": true \| false}`; `null` gibt die Echtzeit zurück, `frozen: false` lässt die Uhr ab dem Zeitpunkt weiterlaufen, ein `frozen`, das kein Boolean ist, ergibt 400. Zeitpunkte vor April 1893 (bis dahin galt in Berlin die Ortszeit +00:53:28, die ISO 8601 nicht verlustfrei darstellt) oder nach dem Jahr 9999 ergeben 400, ebenso ungültige Uhren in `PUT /state`. |
| `GET /requests?path=&method=&limit=` | Anfrageprotokoll mit `time` (UTC) und `clockTime` (Mandantenuhr, Europe/Berlin), `path` ist ein Pfadmuster wie bei Störfällen (konkreter Pfad exakt, Vorlage, Präfix mit `/*` oder `*`, normalisiert wie dort); eine nicht unterstützte `method` ergibt 400, ebenso ein mehrfach oder mit Klammern angegebener Filter (`path=a&path=b`) |
| `DELETE /requests` | Protokoll leeren |
| `GET /faults`, `POST /faults`, `DELETE /faults`, `DELETE /faults/{id}` | Störfälle verwalten |

Ein Störfall hat `type` (`status`, `timeout`, `invalid-json`, `feature-lock`), `path` und optional `method` und `times`. `path` ist ein konkreter Pfad (`/Invoice/5/cancelInvoice`, nur genau dieser), eine Vorlage (`/Invoice/{invoiceId}/cancelInvoice`) oder ein Präfix: `/Invoice/*` trifft `/Invoice` und alles darunter (`/Invoice/5`, `/Invoice/5/bookAmount`), aber nicht `/InvoicePos`; ein `*` ohne vorangehenden `/` ist ein reines Zeichenpräfix (`/Invoice*` trifft auch `/InvoicePos`). Pfade werden normalisiert: ein fehlender führender Slash wird ergänzt und ein führender Basispfad entfernt, also `Invoice/1/cancelInvoice`, `/Invoice/1/cancelInvoice` und `/api/v1/Invoice/1/cancelInvoice` sind gleich (dasselbe gilt für den Filter `path` von `GET /requests`). Muster vergleichen nur den Pfad, ein `?` oder `#` im Muster ergibt 400, ebenso ein `*`, das nicht am Ende steht (für ein einzelnes Segment dient eine Vorlage). Je Typ:

- `status`: `status` (Pflicht, 200 bis 599 außer 304, weil die Antwort einen JSON-Fehlertext trägt; 1xx sind Zwischenantworten, auf die keine endgültige Antwort folgen würde) und optional `message`.
- `timeout`: wartet `delayMs` (Default 30000) und antwortet dann 504. Mit `hang: true` wird die Verbindung danach ohne Antwort geschlossen. Beim Herunterfahren endet das Warten sofort, die Verbindung wird ohne Antwort geschlossen.
- `invalid-json`: HTTP 200 mit abgeschnittenem JSON.
- `feature-lock`: `code` (Pflicht), optional `status` (Default 500, Wertebereich wie bei `status`) und `userId` (Default: erster `SevUser` des Mandanten). Meldung `Feature with the code '<code>' is not available for the user id <id>`.

`GET` und `POST /faults` liefern nur die typrelevanten Felder: immer `id`, `method`, `path`, `type` und `remaining`; dazu `status` mit `status` und `message`, `timeout` mit `delayMs` und `hang`, `invalid-json` nichts weiter, `feature-lock` mit `status` (wirksam, Standard 500, Konstante `DEFAULT_FAULT_STATUS` in `tenant/faults.ts`), `code` und `userId` (`null` = erster `SevUser` des Mandanten). Intern bleiben die Defaults erhalten, sie erscheinen nur nicht in der Ausgabe.

## Umgebungsvariablen

| Variable | Default | Bedeutung |
|---|---|---|
| `DOPPELDESK_PORT` | `8080` | Port |
| `DOPPELDESK_HOST` | `0.0.0.0` | Bind-Adresse |
| `DOPPELDESK_BASE_PATH` | `/api/v1` | Basispfad der API |
| `DOPPELDESK_SPEC` | `auto` | `auto` lädt `https://api.sevdesk.de/openapi.yaml` (Timeout 5 s) und legt eine Kopie in `<DATA_DIR>/spec-cache.yaml` ab, sonst Cache, sonst mitgelieferte Spec. `bundled`, Dateipfad oder http(s)-URL wählen die Quelle fest. Für reproduzierbare Läufe empfiehlt sich `bundled`. |
| `DOPPELDESK_TOKENS` | `doppeldesk` | kommagetrennte Tokens, je Token ein Mandant; `*` akzeptiert jeden nicht leeren Token |
| `DOPPELDESK_CONTROL_TOKEN` | leer | schützt die Kontroll-API |
| `DOPPELDESK_PERSIST` | `memory` | `memory` oder `file` |
| `DOPPELDESK_DATA_DIR` | `./data` | Ablage für `state.json` und den Spec-Cache |
| `DOPPELDESK_SEED` | `basic` | `none` (Referenzdaten und Basiskonto), `basic` oder `demo` |
| `DOPPELDESK_LOG_LEVEL` | `info` | Log-Level; bei `debug` und `trace` loggt Fastify jede Anfrage, der Wert des Query-Parameters `token` erscheint dabei als `[redacted]` |
| `DOPPELDESK_REQUEST_LOG_SIZE` | `1000` | Einträge im Anfrageprotokoll je Mandant |

Weicht die geladene Spec von der mitgelieferten ab, protokolliert DoppelDesk die hinzugekommenen und entfallenen Operationen.

## Annahmen

Alle Annahmen mit Quelle und Code-Stelle stehen in [annahmen.md](annahmen.md).
