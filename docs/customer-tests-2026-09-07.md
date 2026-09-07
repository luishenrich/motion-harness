# Kundentests 2026-09-07: drei frische Agenten, drei Aufträge, nur mit dem Werkzeug

Drei Agenten ohne jeden Kontext (nur README, llms.txt, Skills, `mh help` und das Werkzeug) haben
je einen Film gebaut, wie es ein Kunde täte, und Tagebuch über jede Reibung geführt. Danach hat je ein
zweiter Agent den fertigen Film als Motion Designer beurteilt. Alle Dateien unter /tmp/mh-customer-*.

## Die drei Aufträge und was herauskam

| Kunde | Auftrag | Ergebnis | Zeit | Eigene Noten (Start, Präzision, Vertrauen, Tempo, Film) | Urteil des Prüfers |
|---|---|---|---|---|---|
| Ledgerline, B2B-Marketing (opus) | 30 s Launch-Spot, LinkedIn und Reels, navy und gold, mit Klängen | 7 Szenen, beide Formate, 5 Cues, Lieferordner mit Loudness-Kopien | etwa 15 min bis zum ersten Film, dann Feinschliff | 5, 9, 7, 10, 8 | Konzept 8, Handwerk 6, Vertical 7; nicht posten: der Film endet auf einem leeren Frame, ein Trenner streicht im Hochformat durch "Funds clear" |
| Lehrer, Erklärvideo (opus) | 45 s Zinseszins, TikTok zuerst, Chart, Zähler, Regel 72, Logo | 10 Szenen, beide Formate, 10 Cues, SRT, EK-Logo als SVG | etwa 60 min | 5, 7, 5, 9, 8 | Lehre 8, Handwerk 7, Format 6; posten ja mit Musikbett; wide ist ein umgerahmtes Hochformat |
| Formkraft, Konferenz (sonnet, auch über MCP) | 20 s Instagram-Story und Website-Version, Bauhaus-Plakat, Countdown, Bauchbinde | 7 Szenen, beide Formate, 9 Cues, zwei Edits über den MCP-Server | etwa 45 min | 8, 6, 5, 9, 8 | Konzept 8, Handwerk 6, Format 6; Story nicht posten: die Deadline-Zeile liegt in der Instagram-UI-Zone, der Countdown endet auf 0 |

Die Filme: /tmp/mh-customer-ledgerline/deliverables/, /tmp/mh-customer-teacher/deliverables/,
/tmp/mh-customer-formkraft/out/. Die Tagebücher: DIARY.md in jedem Projekt.

## Was die drei übereinstimmend sagten

- Der Kern stimmt: Film als Daten, Edit per Adresse, danach das genannte Bild anschauen. "Das beste
  Editing-Loop, das ich benutzt habe" (Ledgerline). Tempo überall 9 bis 10.
- Der erste Bildschirm verspielt das: `mh new --mograph` lieferte einen Film, der seine eigene
  Prüfung nicht bestand (194 und 233 Fehler, ein Typecheck-Fehler in node_modules, einmal ein
  Absturz in der Reparaturrunde, der den ganzen Entwurf verwarf).
- Das Modell schrieb Grössen als Brüche (`"w": 0.5` für einen Button, `0.7` für eine Linie), also
  Bruchteile eines Pixels; jede Prüfung meldete grün, nur der Kontaktbogen zeigte die Lücke.
- Musik: alle drei wollten ein Bett. 30 oder 45 Sekunden Stille mit Klängen "liest sich wie ein
  kaputter Upload". Das war die grösste Lücke.
- `mh set` sagte "saved", der Film widersprach: ein Template-Rest (`formats.vertical`, `anchor: left`)
  oder ein Kind, das wie eine Eigenschaft heisst (`role`), gewann still.
- `render --out-dir` legte den Film dort ab, wo `mh audio` und `mh deliver` nicht schauen; einmal
  sogar im Repo des Werkzeugs, weil der Pfad gegen die Shell aufgelöst wurde.
- Vertikale Sicherheitszone: nichts prüfte sie, bis ein Kunde die Regel selbst schrieb.

## Was seither behoben ist (main, gepusht)

- Typecheck ignoriert Fehler in node_modules; Befunde werden pro Bild gefaltet und nennen
  `mh layout <szene>`; das Gerüst legt vor der ersten Prüfung alle Szenen aus; ein Brief, der Klang
  verlangt, bekommt eine Standard-Tongestaltung samt Dateien.
- Brüche werden zu Pixeln (`0.7` wird 1344 u breit), Grössen unter zwei Pixeln warnen, und ein
  geprobtes Element ohne sichtbare Grösse ist ein Fehler im gerenderten Lint.
- Die Reparaturrunde kann den Entwurf nicht mehr zerstören.
- `mh set` sagt, wenn ein Format-Override oder ein Anker das eben Gesetzte noch überstimmt; Kinder
  gewinnen vor Eigenschaftsnamen; `mh get audio` geht; Marks über mehrere Wörter überleben den
  Wort-Stagger; der `lines`-Ausweg stellt den Umbruch-Lint wirklich ruhig.
- `render --out-dir` liegt im Projekt und hält eine Master-Kopie dort, wo die anderen Befehle schauen.
- Jedes Hochformat hat eine Sicherheitszone als Voreinstellung (oben 12 %, unten 17 %, seitlich 4 %).
- `mh sounds --bed calm|warm|pulse` synthetisiert ein Musikbett als Platzhalter-Cue (Loop, Lizenzzeile
  sagt "ersetzen"); `mh sounds --design` gibt einer stummen Datei die Standard-Tongestaltung.
- Neue Lints: der Film endet auf einem leeren Frame (letzte Szene blendet aus), er beginnt auf
  einem leeren Frame (Thumbnail), zwei Gründe, die niemand unterscheiden kann (1,07:1), alle Szenen
  auf einem Grund. Der Normalisierer nimmt der letzten Szene die Ausblende.
- Ein Zähler gilt als ruhig, wenn er fertig gezählt hat (die Sheets nannten das Settled zu früh).
- Linien-Charts drucken den Wert am letzten Punkt (`showValues: "last"`); `mh overview` legt eine
  ruhige Einstellung pro Szene auf einen Bogen; Tokenzahl pro Modellaufruf; MCP-Client-Beispiel.

## Was offen bleibt

- Das Musikbett ist synthetisch und ungehört; ein echtes Bett braucht eine lizenzierte Datei.
- Ein Trenner, der durch Text läuft, und ein wide-Layout, das nur ein umgerahmtes Hochformat ist,
  sieht kein Lint; das bleibt Sache der Kontaktbögen und der Prüfagenten.
- Countdown mit echtem Datum, Werte an jedem Chart-Punkt per Adresse, ein Vorschauplayer ohne
  Browser: gewünscht, nicht gebaut.
