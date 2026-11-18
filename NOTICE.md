# Kennzeichnung und Markenhinweis

## Dieses Projekt ist inoffiziell

DoppelDesk ist ein **inoffizielles, unabhängiges Community-Projekt**. Es steht in keiner
geschäftlichen oder rechtlichen Verbindung zum Anbieter von sevDesk und wird von dort weder
herausgegeben noch beauftragt, unterstützt, geprüft oder anderweitig gebilligt.

Der Anbieter haftet nicht für dieses Programm. Fehler dieses Programms sind hier zu melden, Fehler
der echten sevDesk-Anwendung oder ihrer Schnittstelle beim Anbieter.

## Markenhinweis

**„sevDesk“ ist eine Marke ihres jeweiligen Rechteinhabers.** Der Name wird in diesem Projekt
ausschließlich beschreibend benutzt, nämlich um zu sagen, welche Schnittstelle nachgebildet wird.
Damit ist keine Aussage über Herkunft, Zugehörigkeit oder eine Empfehlung verbunden. Namensrechte
des Rechteinhabers bleiben unberührt. Der Projektname „DoppelDesk“ ist eine eigene Wortschöpfung.

## Mitgelieferte Spezifikation

Die Datei `spec/sevdesk-openapi.yaml` ist das öffentlich veröffentlichte OpenAPI-Dokument der
sevDesk-API (`https://api.sevdesk.de/openapi.yaml`). Sie liegt **unverändert** bei, damit
DoppelDesk auch ohne Netzzugang starten kann und mit der Schnittstelle zusammenarbeitet
(Interoperabilität). Die MIT-Lizenz dieses Projekts erstreckt sich nicht auf diese Datei; Rechte
daran liegen beim jeweiligen Rechteinhaber. Korrekturen bekannter Fehler daran erfolgen erst nach
dem Laden im Code (`src/spec/patches.ts`), nicht in der Datei.

## Herkunft des Quelltextes

Der Quelltext ist eigenständig geschrieben. Grundlage sind die öffentliche Spezifikation und
beobachtetes Verhalten der Schnittstelle. Was nicht belegt ist, steht als Annahme in
[docs/annahmen.md](docs/annahmen.md).

## Lizenz

MIT-Lizenz, siehe [LICENSE](LICENSE). Die Lizenz erstreckt sich auf den Quelltext dieses Projekts
und nicht auf Marken, Namen oder Inhalte Dritter.

## Keine steuerliche Beratung

DoppelDesk ist ein Testwerkzeug. Es prüft keine fachliche oder steuerliche Richtigkeit und ersetzt
weder sevDesk noch eine steuerliche Beratung.
