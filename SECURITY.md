# Sicherheit

## Einordnung

DoppelDesk ist ein **lokales Testwerkzeug**. Es enthält keine echten Daten, spricht nie mit
sevDesk, und die Zugangsdaten sind frei wählbare Test-Tokens. Es ist nicht dafür gedacht, im
öffentlichen Netz zu laufen. Wer es dennoch erreichbar macht, setzt `DOPPELDESK_CONTROL_TOKEN`
und schützt den Zugang selbst, etwa durch einen Reverse Proxy.

Trotzdem gibt es Fehler, die wir ernst nehmen, zum Beispiel eine Umgehung des Kontroll-Tokens,
das Ausliefern von Zugangsdaten aus dem Anfrageprotokoll oder das Lesen und Schreiben von Dateien
außerhalb von `DOPPELDESK_DATA_DIR`.

## Eine Lücke melden

Nutzen Sie die vertrauliche Sicherheitsmeldung von GitHub:

1. Öffnen Sie `https://github.com/dennismenken/doppeldesk/security/advisories/new`.
2. Beschreiben Sie den Fund, die betroffene Fassung und eine möglichst kleine Abfolge, die ihn
   zeigt.

Ist dieser Weg nicht erreichbar, öffnen Sie ein Issue **ohne** technische Einzelheiten, mit der
Bitte um einen privaten Kanal.

## Was nicht in eine Meldung gehört

- Keine echten sevDesk-Zugangsdaten und keine echten Geschäftsdaten. Für Beispiele genügen
  erfundene Daten.

## Zuständigkeit

Fehler im Verhalten von DoppelDesk gegenüber sevDesk (falsche Antwort, fehlende Regel) sind
keine Sicherheitslücken. Dafür genügt ein normales Issue. Lücken in sevDesk selbst gehören zum
Anbieter, siehe [NOTICE.md](NOTICE.md).

## Unterstützte Fassungen

Sicherheitskorrekturen erscheinen für die jeweils neueste veröffentlichte Fassung.
