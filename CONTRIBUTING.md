# Mitwirken

Danke für das Interesse. Dieses Dokument sagt, wie die Entwicklungsumgebung aufgesetzt wird, wie
Verhalten für einen Endpunkt entsteht und welche Regeln für Code und Commits gelten.

Wer eine Sicherheitslücke gefunden hat, liest zuerst [SECURITY.md](SECURITY.md).

---

## 1. Entwicklungsaufbau

- **Node.js 26.** Der Quelltext ist TypeScript und läuft ohne Build-Schritt direkt unter Node
  (`node src/main.ts`).
- **pnpm 12**, festgehalten im Feld `packageManager` der `package.json`. Das Lockfile ist
  eingecheckt und wird mitgeändert.

```bash
pnpm install
pnpm dev          # Start mit Neuladen
pnpm check        # tsc und Biome, muss grün sein
pnpm lint:fix     # Biome-Korrekturen und Formatierung
```

Abhängigkeiten werden ausschließlich über `pnpm add <paket>@latest` bzw. `pnpm add -D ...`
hinzugefügt, nie von Hand in der `package.json`. Vorhandene Node-Bordmittel haben Vorrang vor
neuen Abhängigkeiten.

---

## 2. Code-Konventionen

- Die `tsconfig.json` ist streng (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `erasableSyntaxOnly`). Deshalb: keine Enums, keine Namespaces, keine
  Konstruktor-Parameterfelder.
- Relative Importe enden auf `.ts`; reine Typimporte verwenden `import type`.
- Kein explizites `any`; `unknown` und Eingrenzung benutzen.
- Kleine, fokussierte Module. Kein toter Code, keine Workarounds und kein fest verdrahtetes
  Verhalten für einzelne Anwendungen. DoppelDesk ist für alle da.
- Kommentare im Quelltext sind englisch und erklären das Warum.
- Fehlermeldungen der API ahmen sevDesk nach und sind englisch.

---

## 3. Verhalten für einen Endpunkt hinzufügen

Jede Operation der Spezifikation ist bereits ein generischer Endpunkt. Eigenes Verhalten ist nur
nötig, wenn sevDesk dort Fachlogik hat.

1. Verhalten an der echten API oder in der Dokumentation belegen. **Was nicht belegt ist, wird
   als Annahme gekennzeichnet** und in [docs/annahmen.md](docs/annahmen.md) mit Quelle und
   Code-Stelle eingetragen.
2. Eine Domain-Route in dem passenden Modul unter `src/domain/` anlegen, oder ein neues Modul
   in `src/domain/index.ts` eintragen. Gemeinsame Abläufe stehen in `src/domain/shared/` und
   werden wiederverwendet, nicht kopiert.
3. Die Antwort nach dem Schema der Spezifikation formen lassen; Ausnahmen für Routen, die in der
   Spezifikation fehlen, über `responseSchema`.
4. `pnpm check` ausführen, die Route gegen einen laufenden Server aufrufen.

Das Vorgehen mit Beispielen beschreibt [docs/architektur.md](docs/architektur.md).

---

## 4. Sprache, Form und Commits

- **Dokumentation ist deutsch**, mit echten Umlauten (ä, ö, ü, ß). Ersatzschreibweisen wie `ae`,
  `oe`, `ue` sind nicht zulässig.
- **Keine Emojis**, an keiner Stelle.
- Gedankenstriche als echtes Zeichen oder weglassen, niemals zwei Bindestriche.
- Nichts erfinden: Angaben, die nicht belegt sind, werden als Annahme gekennzeichnet.
- Commits im Conventional-Commit-Stil, auf Englisch, etwa
  `fix(invoice): reject cancelling paid invoices`.

Ein Pull Request beschreibt, **was** sich ändert und **warum**, und sagt ausdrücklich, welche
Aussagen belegt und welche Annahmen sind. Vor dem Einreichen muss `pnpm check` grün sein.

---

## 5. Spezifikation

Die Datei `spec/sevdesk-openapi.yaml` wird nicht von Hand bearbeitet. Eine neue Fassung kommt
über `pnpm spec:update --write`. Korrekturen bekannter Fehler der Spezifikation gehören nach
`src/spec/patches.ts`.
