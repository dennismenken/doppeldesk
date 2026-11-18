# DoppelDesk

Ein zustandsbehafteter Fake-API-Server für die sevDesk-API.

> **Inoffizielles Projekt.** Keine Verbindung zur sevDesk GmbH, keine Unterstützung von dort.
> Die Marke gehört ihrem Rechteinhaber, siehe [NOTICE.md](NOTICE.md).
>
> **DoppelDesk ist ein Testwerkzeug und kein Ersatz für sevDesk.** Das Verhalten ist ein
> Nachbau aus der öffentlichen OpenAPI-Beschreibung und aus beobachtetem Verhalten. Was davon
> nicht belegt ist, steht in [docs/annahmen.md](docs/annahmen.md). Der Server enthält keine echten
> Daten und gehört nicht ins öffentliche Netz.

DoppelDesk lädt beim Start die offizielle OpenAPI-Beschreibung der sevDesk-API und stellt
**jede Operation daraus** unter `/api/v1` bereit. Ein Client, der sonst gegen
`https://my.sevdesk.de/api/v1` spricht, zeigt stattdessen auf DoppelDesk und braucht weder ein
Testkonto noch Zugangsdaten.

---

## 1. Wozu

Wer eine Anwendung gegen sevDesk entwickelt, stößt beim Testen auf typische Hürden:

- Testkonten laufen aus, und einzelne Funktionen sind je Tarif gesperrt.
- Rechnungen, Gutschriften und Belege lassen sich im echten Konto nach der Festschreibung nicht
  mehr beliebig löschen oder zurücksetzen.
- Fehlerfälle (Zeitüberschreitung, gesperrte Funktion, ungültige Antwort) lassen sich an der
  echten API nicht gezielt auslösen.
- CI und End-to-End-Tests brauchen einen deterministischen, schnell zurücksetzbaren Zustand.

DoppelDesk beantwortet die Anfragen aus einem eigenen Speicher, der sich per Aufruf leeren,
befüllen, exportieren und importieren lässt.

---

## 2. Was DoppelDesk kann

- **Alle Operationen der Spezifikation sind automatisch Endpunkte.** Beim Start wird
  `https://api.sevdesk.de/openapi.yaml` geladen, mit Rückfall auf die mitgelieferte Kopie
  `spec/sevdesk-openapi.yaml`. Ein neuer sevDesk-Endpunkt existiert damit sofort, auch bevor
  jemand Verhalten dafür schreibt.
- **Zustandsbehafteter Dokumentenspeicher.** Schemalos, je Modell eine Collection (Name gleich
  sevDesk-`objectName`, etwa `Invoice`, `Contact`, `InvoicePos`), je Mandant getrennt. Die
  Antwortschemata der Spezifikation formen die Ausgabe: Typangleichung, `null` für fehlende
  Felder, Datumsformat mit Berliner Offset.
- **Generisches Verhalten** für Liste, Lesen, Anlegen, Ändern und Löschen jedes Modells nach
  Pfadform. Unbekannte Aktions-Endpunkte antworten deterministisch aus dem Antwortschema.
- **Fachlogik per Hand** dort, wo sevDesk echte Geschäftsregeln hat:

  | Bereich | Inhalt |
  | --- | --- |
  | Rechnungen | `saveInvoice`, Status, Nummernkreis, Summen und Steuerregeln, Festschreiben, Versand, Zahlung buchen, Stornieren, Mahnung, Rechnung aus Auftrag, PDF- und XML-Platzhalter |
  | Gutschriften | `saveCreditNote`, Erzeugen aus Rechnung oder Beleg, Zahlung, Versand, Positionen |
  | Aufträge | `saveOrder`, Angebot, Auftragsbestätigung, Lieferschein, Positionen, Versand |
  | Kontakte | Kundennummern, Adressen, Kommunikationswege, Tags, benutzerdefinierte Felder, Filter |
  | Belege | `saveVoucher`, Upload, Zahlung buchen, Positionen |
  | Buchhaltung | Zahlungskonten, Transaktionen, automatische Buchung bei Zahlung, Exporte |
  | Stammdaten | Mandant (`SevClient`), Benutzer, Länder, Kategorien, Artikel, Referenzdaten |

  Die genauen Routen zeigt `GET /__doppeldesk/routes`.
- **Seeds:** `none`, `basic` (Referenzdaten) oder `demo` (Beispielbestand mit Kontakten,
  Rechnungen, Gutschriften, Aufträgen, Belegen und Bankdaten).
- **Persistenz:** wahlweise nur im Speicher oder als Datei.
- **Mehrere Mandanten:** jeder API-Token ist ein eigener Mandant.
- **Kontroll-API** unter `/__doppeldesk`: Zurücksetzen, Seed, Uhr, Anfrageprotokoll,
  Störfälle, Export und Import, Gesundheitsprüfung, Routenliste.
- **Störfälle:** gezielte Fehlerantworten, Zeitüberschreitungen, kaputtes JSON und gesperrte
  Funktionen (`feature-lock`).
- **Steuerbare Uhr:** einfrieren oder auf einen Zeitpunkt stellen.
- **Spec-Beobachtung:** ein wöchentlicher Workflow meldet Änderungen der veröffentlichten
  Spezifikation als Issue.

---

## 3. Schnellstart

### Docker

```bash
docker run --rm -p 8080:8080 ghcr.io/dennismenken/doppeldesk:latest
```

### Docker Compose

```bash
docker compose up
```

Die mitgelieferte `compose.yaml` setzt alle Variablen sichtbar auf ihre Vorgaben und legt ein
Volume `doppeldesk-data` an.

### Lokal mit pnpm

Voraussetzung ist **Node.js 26** (der Quelltext läuft ohne Build-Schritt als TypeScript) und
**pnpm 12**.

```bash
pnpm install
pnpm start
```

Prüfung, ob der Server läuft:

```bash
curl http://localhost:8080/__doppeldesk/health
```

---

## 4. Konfiguration

Alle Einstellungen kommen aus Umgebungsvariablen. Ungültige Werte brechen den Start mit einer
Meldung ab.

| Variable | Vorgabe | Bedeutung |
| --- | --- | --- |
| `DOPPELDESK_PORT` | `8080` | Port |
| `DOPPELDESK_HOST` | `0.0.0.0` | Bind-Adresse |
| `DOPPELDESK_BASE_PATH` | `/api/v1` | Basispfad der API (darf nicht `/` und nicht `/__doppeldesk` sein) |
| `DOPPELDESK_SPEC` | `auto` | `auto` lädt die Spezifikation von sevDesk (Zeitlimit 5 s), legt eine Kopie in `<DATA_DIR>/spec-cache.yaml` ab und fällt sonst auf den Cache und dann auf die mitgelieferte Kopie zurück. `bundled`, ein Dateipfad oder eine http(s)-URL legen die Quelle fest. Für reproduzierbare Läufe `bundled`. Eine Spezifikation ohne jede Operation gilt als unbrauchbar. |
| `DOPPELDESK_TOKENS` | `doppeldesk` | kommagetrennte Tokens, je Token ein Mandant; `*` akzeptiert jeden nicht leeren Token |
| `DOPPELDESK_CONTROL_TOKEN` | leer | schützt die Kontroll-API (Header `X-DoppelDesk-Control-Token`); leer heißt ungeschützt |
| `DOPPELDESK_PERSIST` | `memory` | `memory` oder `file` |
| `DOPPELDESK_DATA_DIR` | `./data` | Ablage für `state.json` und den Spec-Cache (im Container `/data`) |
| `DOPPELDESK_SEED` | `basic` | `none`, `basic` oder `demo` |
| `DOPPELDESK_LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` oder `silent` |
| `DOPPELDESK_REQUEST_LOG_SIZE` | `1000` | Einträge im Anfrageprotokoll je Mandant |

Mit `DOPPELDESK_PERSIST=file` liegen alle Mandanten in `<DATA_DIR>/state.json`. Geschrieben wird
verzögert nach Änderungen und beim Beenden. Beim Beenden (SIGTERM, SIGINT) enden wartende
`timeout`-Störfälle sofort, und der Stand wird vor dem Abarbeiten offener Anfragen geschrieben.
Lässt sich das Datenverzeichnis beim Start nicht anlegen oder beschreiben, bricht der Start mit
einer Fehlermeldung ab, ebenso bei einem belegten Port. Die Uhr gehört zum gespeicherten Stand: Eine eingefrorene
oder verschobene Uhr gilt nach einem Neustart weiter, bis `POST /__doppeldesk/clock` mit `{"now": null}`
oder `POST /__doppeldesk/reset` die Echtzeit zurückgibt. Störfälle und Anfrageprotokoll werden nicht gespeichert. Der Seed wird angewendet, wenn ein Mandant neu entsteht oder zurückgesetzt wird,
nicht beim Laden aus der Datei. Mandanten, deren Token nicht mehr konfiguriert ist, bleiben in der
Datei erhalten und werden erst wieder bedient, wenn der Token zurückkommt.

---

## 5. Aus einem Client benutzen

Basis-URL ist `http://localhost:8080/api/v1`. Der Token steht wie bei sevDesk im Header
`Authorization`, ohne Präfix (`Bearer <token>` wird ebenfalls akzeptiert). Der Vorgabe-Token
heißt `doppeldesk`.

```bash
BASE=http://localhost:8080/api/v1
AUTH='Authorization: doppeldesk'
JSON='Content-Type: application/json'
```

**Kontakt anlegen**

```bash
curl -X POST "$BASE/Contact" -H "$AUTH" -H "$JSON" \
  -d '{"name":"Beispiel GmbH","category":{"id":3,"objectName":"Category"}}'
```

**Rechnung über die Factory anlegen** (die Rechnung ist danach ein Entwurf mit Status 100 und
bekommt eine Nummer wie `RE-1001`)

```bash
curl -X POST "$BASE/Invoice/Factory/saveInvoice" -H "$AUTH" -H "$JSON" -d '{
  "invoice": {
    "objectName": "Invoice", "mapAll": true,
    "contact": {"id": 1, "objectName": "Contact"},
    "contactPerson": {"id": 1, "objectName": "SevUser"},
    "invoiceDate": "2026-11-18", "discount": 0, "status": 100,
    "addressCountry": {"id": 1, "objectName": "StaticCountry"},
    "taxRate": 19, "taxRule": {"id": 1, "objectName": "TaxRule"},
    "taxText": "Umsatzsteuer 19%", "invoiceType": "RE", "currency": "EUR",
    "showNet": true
  },
  "invoicePosSave": [{
    "objectName": "InvoicePos", "mapAll": true, "name": "Beratung",
    "quantity": 2, "price": 100, "taxRate": 19,
    "unity": {"id": 1, "objectName": "Unity"}
  }]
}'
```

**Rechnung versenden** (macht aus dem Entwurf eine offene Rechnung, Status 200)

```bash
curl -X PUT "$BASE/Invoice/1/sendBy" -H "$AUTH" -H "$JSON" \
  -d '{"sendType":"VPR","sendDraft":false}'
```

**Zahlung buchen**

```bash
curl -X PUT "$BASE/Invoice/1/bookAmount" -H "$AUTH" -H "$JSON" \
  -d '{"amount":100,"date":1790000000,"type":"N","checkAccount":{"id":1,"objectName":"CheckAccount"}}'
```

**Stornieren.** Nur offene Rechnungen lassen sich stornieren; eine bereits (teilweise) bezahlte
Rechnung wird mit 422 und der Meldung `Only open invoices can be cancelled, create a credit note
for paid invoices` abgelehnt. Rechnung 1 ist nach der Zahlung oben teilweise bezahlt (Status 750),
der folgende Aufruf zeigt also genau diese Ablehnung. Ohne die Zahlung, also direkt nach dem
Versand, wäre die Stornierung erfolgreich.

```bash
curl -X POST "$BASE/Invoice/1/cancelInvoice" -H "$AUTH" -H "$JSON" -d '{}'
```

Antworten haben wie bei sevDesk die Hülle `{"objects": ...}`, Fehler die Form
`{"objects": null, "error": {"message": "...", "code": null, "data": null, "exceptionUUID": "..."}}`.
Ein nicht vorhandenes Objekt ergibt 404 mit `No Model_<Typ> with the id <id> was found`, ein
fehlender Token 401.

---

## 6. Kontroll-API

Alle Endpunkte liegen unter `/__doppeldesk`. Mandantenbezogene Endpunkte wählen den Mandanten
über denselben `Authorization`-Header wie die API. Ist `DOPPELDESK_CONTROL_TOKEN` gesetzt,
verlangen alle Endpunkte außer `/health` zusätzlich den Header `X-DoppelDesk-Control-Token`.

| Methode und Pfad | Zweck |
| --- | --- |
| `GET /health` | Status, Spec-Quelle, Zahl der Operationen, angewendete Spec-Korrekturen, Persistenz, Seed (ohne Authentifizierung) |
| `GET /routes` | alle Routen mit Art `generic`, `domain` oder `extra` und die Domain-Module |
| `POST /reset` | Mandant leeren und Seed anwenden, Body `{"seed":"none"\|"basic"\|"demo"}` optional (ohne Body gilt `DOPPELDESK_SEED`); ein Body, der nicht als JSON-Objekt gesendet wird, ein anderer Schlüssel als `seed` oder `seed` im Query-String ergibt 400; leert auch Uhr, Störfälle und Protokoll |
| `GET /state`, `PUT /state` | Snapshot des Mandanten exportieren bzw. importieren; ein Snapshot eines anderen Mandanten wird auf dessen `sevClientId` umgeschrieben |
| `GET /clock`, `POST /clock` | Uhr lesen bzw. setzen; `now` muss zwischen April 1893 und dem Jahr 9999 liegen, `frozen` ein Boolean sein |
| `GET /requests`, `DELETE /requests` | Anfrageprotokoll lesen (Filter `path` als Pfadmuster wie bei den Störfällen, `method`, `limit`) bzw. leeren |
| `GET /faults`, `POST /faults`, `DELETE /faults`, `DELETE /faults/{id}` | Störfälle verwalten |

Beispiele:

```bash
CTRL=http://localhost:8080/__doppeldesk

# Zurücksetzen auf einen leeren Mandanten
curl -X POST "$CTRL/reset" -H "$AUTH" -H "$JSON" -d '{"seed":"none"}'

# Demo-Bestand laden
curl -X POST "$CTRL/reset" -H "$AUTH" -H "$JSON" -d '{"seed":"demo"}'

# Uhr einfrieren; mit "frozen": false läuft sie ab dem Zeitpunkt weiter, null gibt die Echtzeit zurück
curl -X POST "$CTRL/clock" -H "$AUTH" -H "$JSON" -d '{"now":"2026-12-31T12:00:00+01:00"}'

# Anfrageprotokoll der letzten fünf Rechnungsanfragen (Präfix mit *)
curl "$CTRL/requests?path=/Invoice/*&limit=5" -H "$AUTH"

# Alle bookAmount-Aufrufe, gleich für welche Rechnung (Vorlage; -g schaltet das Globbing von curl ab)
curl -g "$CTRL/requests?path=/Invoice/{invoiceId}/bookAmount&method=PUT" -H "$AUTH"

# Stand sichern und wieder einspielen
curl "$CTRL/state" -H "$AUTH" > state.json
curl -X PUT "$CTRL/state" -H "$AUTH" -H "$JSON" -d @state.json
```

### Störfälle

Ein Störfall hat `type`, `path` und optional `method` und `times` (Anzahl der Treffer, danach
erlischt er). `path` ist ein Pfadmuster: ein konkreter Pfad (`/Invoice/5/cancelInvoice`, nur
genau dieser Pfad), eine Vorlage (`/Invoice/{invoiceId}/cancelInvoice`, Parameternamen beliebig)
oder ein Präfix: `/Invoice/*` trifft `/Invoice` und alles darunter, aber nicht `/InvoicePos`;
`/Invoice*` ist ein reines Zeichenpräfix und trifft auch `/InvoicePos`. Muster vergleichen nur den Pfad; ein Query-String oder
Fragment (`?`, `#`) im Muster ergibt 400, ebenso ein `*`, das nicht am Ende steht (für ein einzelnes
Segment dient eine Vorlage). Dieselben Muster gelten für den Filter `path` des
Anfrageprotokolls.

| Typ | Wirkung |
| --- | --- |
| `status` | antwortet mit `status` (Pflicht, 200 bis 599 außer 304) und optional `message` |
| `timeout` | wartet `delayMs` (Vorgabe 30000) und antwortet dann 504; mit `hang: true` wird die Verbindung ohne Antwort geschlossen. Beim Herunterfahren endet das Warten sofort, die Verbindung wird ohne Antwort geschlossen |
| `invalid-json` | HTTP 200 mit abgeschnittenem JSON |
| `feature-lock` | Meldung `Feature with the code '<code>' is not available for the user id <id>`; `code` ist Pflicht, `status` Vorgabe 500 |

```bash
# Der nächste POST unter /Invoice schlägt einmalig mit 503 fehl
curl -X POST "$CTRL/faults" -H "$AUTH" -H "$JSON" \
  -d '{"type":"status","path":"/Invoice/*","method":"POST","status":503,"times":1}'
```

---

## 7. Wie das Verhalten aufgebaut ist

Jede Route hat einen Schlüssel aus Methode und Pfad. Pro Schlüssel gibt es genau einen Handler:

1. **Domain-Route.** Handgeschrieben, wo sevDesk Fachlogik hat. Sie ersetzt den generischen
   Handler mit demselben Schlüssel.
2. **Generischer Handler.** Für alle übrigen Operationen der Spezifikation, gewählt nach
   Pfadform (`GET /{Model}`, `POST /{Model}`, `GET|PUT|DELETE /{Model}/{id}`). Alles andere
   liefert das gespeicherte Objekt oder einen deterministischen Beispielwert aus dem
   Antwortschema.

Gespeichert wird schemalos. Erst die Antwort wird nach dem Schema der Spezifikation geformt.
Vorher prüft DoppelDesk die Werte jedes Request-Bodys gegen das Request-Schema der Operation:
Ein Wert, der sich nicht als der deklarierte Typ lesen lässt (ein Objekt in einem Textfeld,
`abc` in einem Zahlenfeld, `maybe` in einem Boolean-Feld, ein unlesbares Datum), ergibt 400
`Invalid value given for '<feld>'`. Generische `POST`-Routen verlangen zusätzlich die
Pflichtfelder des Request-Schemas. Bekannte Fehler der Spezifikation korrigiert
`src/spec/patches.ts` direkt nach dem Laden.

Wie eine neue Domain-Route entsteht, steht in [docs/architektur.md](docs/architektur.md),
Abschnitt „Eine Domain-Route hinzufügen“.

---

## 8. Spezifikation aktualisieren

```bash
pnpm spec:update            # Vergleich mit der veröffentlichten Spezifikation, Bericht als Markdown
pnpm spec:update --write    # mitgelieferte Kopie überschreiben
pnpm spec:update --fail-on-diff
```

Der Workflow `Spec Watch` läuft wöchentlich und öffnet oder aktualisiert bei Abweichungen ein
Issue. Das Verhalten ändert sich nie automatisch: Eine neue Operation erscheint als
generischer Endpunkt, Fachlogik dafür muss jemand schreiben. Weicht die geladene Spezifikation
von der mitgelieferten ab, protokolliert DoppelDesk beim Start die hinzugekommenen und
entfallenen Operationen.

---

## 9. Bekannte Abweichungen und Annahmen

DoppelDesk ist ein Nachbau. Vieles am Verhalten von sevDesk ist nicht öffentlich belegt, etwa
Meldungstexte, einzelne Statuscodes, Nummernformate außer `RE-` und `GU-` und Randfälle der
Filter. [docs/annahmen.md](docs/annahmen.md) führt jede Annahme mit Quelle und Code-Stelle.
Wer ein Verhalten an einem echten Konto gemessen hat, das dort als Annahme steht, ist
eingeladen, es zu melden.

Zusätzlich gilt:

- PDF-, XML- und Rendering-Antworten sind deterministische Platzhalter, keine echten Dokumente.
- Es werden keine E-Mails versendet; `sendViaEmail` und `sendBy` ändern nur den Zustand.
- Es gibt keine Anbindung an Banken, DATEV oder E-Rechnungsnetze.

---

## 10. Entwicklung

Voraussetzungen: Node.js 26, pnpm 12 (festgelegt über `packageManager`).

```bash
pnpm install
pnpm dev          # Start mit Neuladen bei Änderungen
pnpm check        # tsc (Typprüfung) und Biome (Lint und Format)
pnpm lint:fix     # Biome-Korrekturen und Formatierung anwenden
```

Der Quelltext ist TypeScript und läuft unter Node 26 direkt über das native Entfernen der
Typen, es gibt keinen Build-Schritt. Relative Importe enden deshalb auf `.ts`, Enums,
Namespaces und Konstruktor-Parameterfelder sind nicht erlaubt. Typprüfung übernimmt `tsc`,
Lint und Format übernimmt Biome.

Den Aufbau beschreibt [docs/architektur.md](docs/architektur.md).

---

## 11. Mitwirken

Beiträge sind willkommen. Ablauf, Konventionen und Regeln für neue Domain-Routen stehen in
[CONTRIBUTING.md](CONTRIBUTING.md). Sicherheitsrelevantes bitte nach
[SECURITY.md](SECURITY.md) melden. Änderungen stehen im [CHANGELOG.md](CHANGELOG.md).

---

## 12. Lizenz

MIT, Copyright (c) 2026 Dennis Menken. Siehe [LICENSE](LICENSE). Hinweise zu Marken und zur
mitgelieferten Spezifikation stehen in [NOTICE.md](NOTICE.md).
