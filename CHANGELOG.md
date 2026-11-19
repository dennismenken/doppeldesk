# Änderungsprotokoll

Alle bemerkenswerten Änderungen an diesem Projekt stehen in dieser Datei.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), die Versionsnummern
folgen der [Semantischen Versionierung](https://semver.org/lang/de/). Die Datei wird von Hand
gepflegt, und jede Veröffentlichung bekommt einen Eintrag.

## [Unveröffentlicht]

### Behoben

- `src/seed/data/static-countries.json` fehlte im Repository, weil das Muster `data/` in
  `.gitignore` in jeder Tiefe griff. Start und Reset mit dem Seed `basic` scheiterten deshalb
  auf einem frischen Klon und im Image mit `ENOENT`. Das Muster gilt jetzt nur im
  Wurzelverzeichnis (`/data/`).

### Hinzugefügt

- `pnpm smoke` startet den Server mit jedem Seed und prüft Länderliste, Anlegen, Token-Abweisung
  und Reset. Die CI führt den Test aus und prüft zusätzlich das gebaute Image (Healthcheck und
  API).

### Geändert

- Der Query-Parameter `token` authentifiziert nicht mehr, wie bei sevDesk seit dem 29.04.2025.
  Ohne `Authorization`-Header folgt 401.
- Störfälle greifen direkt nach der Authentifizierung, vor dem Parsen des Bodys, und gewinnen
  damit über Body-Parserfehler. Das Anfrageprotokoll zeigt für so beantwortete Anfragen
  `body: null`.
- Störfall-Pfade und der Filter `path` des Anfrageprotokolls werden normalisiert: ein fehlender
  führender Slash wird ergänzt und ein führender Basispfad entfernt.
- `GET` und `POST /__doppeldesk/faults` zeigen nur die typrelevanten Felder je Störfalltyp.
- Das Anfrageprotokoll hat das Feld `clockTime` (Mandantenuhr, Europe/Berlin), `time` ist der
  Beginn der Anfrage statt des Zeitpunkts nach der Antwort.
- `POST /{Modell}` und `PUT /{Modell}/{id}` mit Spec-Operation ignorieren unbekannte Felder
  (Contact, ContactAddress, CommunicationWay, Part, Tag, CheckAccount und weitere).
- Die Factories `saveInvoice`, `saveVoucher`, `saveCreditNote` und `saveOrder` ignorieren
  unbekannte Eigenschaften in Kopf, Positionen und Rabatten (`discountSave`) ebenso. Gespeichert
  und zurückgegeben wird nur, was das Modell kennt.
- `cancelInvoice` berechnet den Status des Quellauftrags neu, wenn die Rechnung aus einem
  Auftrag stammt (ohne weitere Rechnung wieder 500).
- Seed `none` ist ein frisch registrierter Account mit Referenzdaten und Basiskonto (ID 1),
  `basic` ergänzt Bankkonto und Kasse. Die Stammdaten der Kommunikationsweg-Schlüssel stehen nur
  noch in `domain/contact/communicationWayKeys.ts`.
- Nach dem Löschen eines Rechnungsentwurfs wird der Status des Quellauftrags aus den
  verbleibenden Rechnungen neu berechnet. Beim Anlegen zählen alle bestehenden Rechnungen.
- Das Zurücksetzen eines Belegs (`resetToOpen`, `resetToDraft`) löst nur dessen eigene Buchungen.
  Eine Transaktion mit weiteren Buchungen bleibt gebucht.
- Beträge direkt angelegter oder geänderter Transaktionen werden auf 2 Stellen gerundet.
- `POST` und `PUT /Part` lehnen einen Steuersatz außer 0, 7 und 19 ab (422).
- Belege speichern kein `mapAll` mehr.
- `bookAmount` prüft den Betrag gegen den offenen Betrag je Buchungstyp (422 bei Abweichung).
- `resetToDraft` leert `sendType` und `sendDate` bei Rechnungen und Gutschriften.
- Stornorechnungen und stornierte Originale lehnen `resetToOpen`, `resetToDraft` und
  `createFromInvoice` ab.
- Doppelte Rechnungs-, Gutschrift- und Auftragsnummern ergeben 422, die automatische Vergabe
  überspringt manuell vergebene Nummern.
- `saveVoucher` verlangt einen Lieferanten und mindestens eine Position, ein unbekannter
  Lieferant ergibt 404.
- Artikel prüfen Einheit und Kategorie, `price` und `priceNet` werden gemeinsam gesetzt.
- `DELETE /CheckAccount/{id}` ergibt 409, solange Transaktionen existieren.
- Request-Bodys werden gegen das Request-Schema der Spec geprüft: Werte, die sich nicht als der
  deklarierte Typ lesen lassen, ergeben 400 `Invalid value given for '<feld>'`. Generische
  `POST`-Routen verlangen die Pflichtfelder des Request-Schemas.
- `saveInvoice` lehnt `invoiceType` und `status` außerhalb der Spec-Enums ab (422).
- `DELETE /Contact/{id}` ergibt 409, solange Belege oder andere Objekte auf den Kontakt verweisen.
- Kontakte, Kontaktadressen und Kommunikationswege prüfen Kategorie, Land und Schlüssel (404).
- Gebuchte Transaktionen lassen sich nicht löschen (409) und in Betrag, Konto, Datum und Status
  nicht ändern (422).
- `PUT /CheckAccount/{id}` mit `defaultAccount` 1 nimmt allen anderen Konten den Standard.
- `createInvoiceFromOrder` prüft `type` und `amount` (400) sowie positive Beträge innerhalb des
  Auftragsrests (422).
- Neu: `GET /SevSequence` und `GET /SevSequence/Factory/getByType`.
- Eigene IDs sind wie Referenz-IDs immer Strings (Spec-Korrektur `ids-as-strings`).
- Felder mit Format `date` erscheinen als `YYYY-MM-DD`.
- `POST /__doppeldesk/reset` lehnt einen Body ab, der kein JSON-Objekt ist, ebenso `seed` im
  Query-String. `POST /__doppeldesk/clock` lehnt ein `frozen` ab, das kein Boolean ist, und
  Zeitpunkte vor April 1893 oder nach 9999.
- Pfadmuster von Störfällen und Anfrageprotokoll lehnen Query-Strings ab (400).
- Ein Präfixmuster mit `/*` (`/Invoice/*`) endet an der Segmentgrenze und trifft `/InvoicePos`
  nicht mehr; `/Invoice*` bleibt ein reines Zeichenpräfix.
- Störfälle vom Typ `status` und `feature-lock` lehnen 1xx und 304 ab (400).
- `GET /__doppeldesk/requests` lehnt mehrfach angegebene Filter ab (400).
- `PUT /__doppeldesk/state` lehnt doppelte Dokument-IDs, negative Nummernkreise und negative
  `lastId` ab und schreibt den Snapshot eines anderen Mandanten auf die eigene `sevClientId` um.
- `enshrine` antwortet bei Gutschriften, Belegen und Transaktionen wie bei Rechnungen mit
  `{"objects": null}` und lehnt ein zweites Festschreiben ab (422).
- `DELETE /Part/{id}` ergibt 409, solange Positionen auf den Artikel verweisen; Änderungen
  dürfen Pflichtfelder von Artikeln und Aufträgen nicht leeren.
- Positionen von Aufträgen, die keine Entwürfe sind, lassen sich auch per `PUT /OrderPos/{id}`
  und `saveOrder` nicht mehr ändern (409).
- Je Kontakt höchstens ein Buchhaltungskontakt und je Feld-Einstellung ein Kontaktfeld, Namen
  der Feld-Einstellungen sind eindeutig (400).
- Die Auftrags-Factories `createPackingListFromOrder` und `createContractNoteFromOrder` sowie
  `createInvoiceReminder` prüfen den `objectName` der Quellreferenz.
- Referenzfelder mit festem Modell lehnen einen fremden `objectName` ab (400) und speichern den
  Modellnamen. Rechnungs-, Gutschrift- und Auftragsköpfe prüfen Bearbeiter, Land und
  Steuerregel (404), Belege die Steuerregel.
- `saveInvoice` und `saveCreditNote` ignorieren `origin` beim Ändern, die Belegnummer lässt sich
  nur im Entwurf ändern (422).
- Positionsrabatte außerhalb von 0 bis 100 Prozent und Kopfrabatte, die die Rechnung negativ
  machen, ergeben 422.
- `POST /__doppeldesk/reset` lehnt Bodys ab, die nicht als JSON gesendet werden oder andere
  Schlüssel als `seed` haben; Pfadmuster mit `*` in der Mitte ergeben 400.
- Positionslisten (`/InvoicePos`, `/CreditNotePos`, `/OrderPos`) sind nach Beleg gruppiert.

### Behoben

- Anfragen, die der Node-HTTP-Parser vor Fastify abweist (rohe Nicht-ASCII-Zeichen in der URL,
  ungültige Request-Zeile, Header-Overflow, Request-Timeout), ergeben das sevDesk-Fehlerformat
  (400, 431, 408) statt der Standardantwort von Node.
- Leere oder `null`-Datumswerte in `saveInvoice` werden nicht mehr als `""` gespeichert.
- `limit`, `offset` und `countAll` wirken auch bei `ReceiptGuidance` und `getRelatedObjects`.
- Ein belegter Port beendet den Start mit einer einzeiligen Meldung statt eines Stacktraces.
- Gutschriften aus Rechnungen übernehmen den Rechnungskopf nicht mehr, Gutschriften aus Belegen
  und Mahnungen haben zu den Positionen passende Steuerangaben, `smallSettlement` ist bei
  Rechnungen immer ein Boolean.
- Eingebettete Objekte (`embed`) haben dieselbe Form wie beim direkten Abruf.
- Der Tag-Filter wirkt auch bei Gutschriften, Aufträgen und Belegen.
- `GET /CreditNote` wertet die Filter der Spec aus (`customerIntenalNote`, `day`,
  `headerStartsWith`, `headerOrNumber`, `onlyEnshrined`, `creditNoteNumberGreater`/`Smaller`,
  `startAmount`/`endAmount`, `partiallyPaid`, `delinquent`, `notdelinquent`, Sortierung).
- Felder außerhalb des Antwortschemas werden nach dem Schema ihres Modells geformt
  (`balance` der `clearingAccount`-Antwort ist ein String wie bei `GET /CheckAccount/{id}`).
- Beispielantworten ohne Fachlogik tragen die ID `"0"` und den Modellnamen statt leerer Strings.
- Fehlt die Quellreferenz der Auftrags-Factories, lautet die Meldung `null given`.
- `fileImportAccount` und `clearingAccount` vergeben ohne `accountingNumber` eine freie Nummer.
- Die Uhr der Kontroll-API und importierte Snapshots lehnen ungültige Zeitpunkte ab.
- `GET /__doppeldesk/requests` lehnt eine nicht unterstützte `method` ab.
- Der Query-Parameter `token` erscheint im Server-Log geschwärzt.
- Eine nicht ladbare Spec oder eine beschädigte `state.json` ergeben beim Start eine klare
  Meldung statt eines Stacktraces.
- Mandanten mit nicht mehr konfiguriertem Token gehen in `state.json` nicht mehr verloren.
- `sumDiscount` und `sumDiscounts` zeigen bei Positionen ohne Rabatt keine Rundungsdifferenz
  mehr (-0.01).
- Fehlerhafte URL-Kodierung ergibt das sevDesk-Fehlerformat statt der Fastify-Fehlerform.
- Beim Beenden enden wartende `timeout`-Störfälle sofort, und der Stand wird vor dem Abarbeiten
  offener Anfragen geschrieben.
- Ein nicht beschreibbares Datenverzeichnis bei `DOPPELDESK_PERSIST=file` bricht den Start ab.
- Eine Spec ohne Operationen wird abgelehnt (im Modus `auto` greift der Ersatz).

## [0.1.0] - 2026-11-18

### Hinzugefügt

- Erste Fassung. Fake-Server für die sevDesk-API, der beim Start die OpenAPI-Spezifikation lädt
  (Download mit Rückfall auf die mitgelieferte Kopie) und jede Operation unter `/api/v1`
  bereitstellt.
- Schemaloser, mandantengetrennter Dokumentenspeicher, Antwortformung nach den Schemata der
  Spezifikation, generische Handler für Liste, Lesen, Anlegen, Ändern und Löschen.
- Fachlogik für Rechnungen, Gutschriften, Aufträge, Kontakte, Belege, Buchhaltung und Stammdaten.
- Seeds `none`, `basic` und `demo`, Persistenz im Speicher oder als Datei, mehrere Mandanten über
  API-Tokens.
- Kontroll-API unter `/__doppeldesk` mit Zurücksetzen, Uhr, Anfrageprotokoll, Störfällen,
  Export und Import, Gesundheitsprüfung und Routenliste.
- Docker-Image `ghcr.io/dennismenken/doppeldesk`, `compose.yaml`, wöchentlicher Spec-Watch.
- Dokumentation: Architektur und Liste der Annahmen.
