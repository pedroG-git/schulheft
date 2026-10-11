// Hilfe-Seite (Tastenzeichen passend zum System: ⌘ auf dem Mac, Strg sonst)
import { keys } from './platform.js';

export const helpHtml = keys(`<div class="page-pad help">
<div class="view-head"><div><h1>Hilfe</h1><p class="sub">So funktioniert dein Schulheft.</p></div></div>

<section class="help-grid">
<div class="help-card"><h3>So sind deine Notizen geordnet</h3>
<ul>
<li><b>Fach → Einheit → Stunde</b>. Die Einheit ist ein Thema oder Kapitel, den Namen wählst du selbst.</li>
<li>Beispiel: <code>Mathe/Bruchrechnung/2026-10-12 Brüche addieren.md</code></li>
<li>Dateien zu einer Einheit liegen in <code>Mathe/Bruchrechnung/Material/</code>.</li>
<li>Freie Notizen (keine Stunde) kannst du in jeden Ordner legen.</li>
<li>Alles sind normale Dateien in deinem Notizordner. Ordner, die mit <code>_</code> oder <code>.</code> beginnen, gehören der App und werden nicht angezeigt.</li>
</ul></div>

<div class="help-card"><h3>Zuerst: Einstellungen</h3>
<ul>
<li>Unter <b>Einstellungen</b> trägst du einmal deine <b>Unterrichtszeiten</b> ein (oder nimmst die Vorlage).</li>
<li>Dann den <b>Stundenplan</b>: Feld antippen, Fach eintragen – Einheit, Lehrkraft und Raum sind freiwillig.</li>
<li>Ohne Stundenplan geht auch alles – du trägst Fach und Zeit dann bei jeder Stunde selbst ein.</li>
</ul></div>

<div class="help-card"><h3>Start: Heute &amp; diese Woche</h3>
<ul>
<li><b>Start</b> (oder <b>Heute</b>) zeigt alles auf einer Seite. Die App öffnet sich hier.</li>
<li><b>Heute</b>: deine Stunden aus dem Stundenplan. <b>Öffnen</b> = Notiz gibt es schon, <b>Notiz anlegen</b> = ein Klick, alles ausgefüllt.</li>
<li><b>Hausaufgaben</b>: offene <code>- [ ]</code> aus „Hausaufgabe“, nach Frist sortiert. Rot = überfällig. Haken setzen, dann in der Notiz speichern.</li>
<li><b>Fragen an Lehrkräfte</b>: offene <code>??</code>, sortiert nach Lehrkraft. Antwort mit <code>→</code> dahinter oder in der Zeile darunter = erledigt.</li>
<li><b>Diese Woche</b> / <b>Nächste Woche</b> (ab Donnerstag): Mo–Fr kurz. Klick öffnet oder legt an.</li>
</ul></div>

<div class="help-card"><h3>Stunden (eine Notiz pro Unterricht)</h3>
<ul>
<li><b>+ Neue Stunde</b>: Fach, Einheit, Datum und Zeit wählen. Passt das zum Stundenplan, sind Einheit, Lehrkraft und Raum schon ausgefüllt.</li>
<li>Fehlende Ordner werden angelegt.</li>
<li>Jede Stunde hat die Abschnitte <b>Material</b>, <b>Mitschrift</b>, <b>Fragen</b> und <b>Hausaufgabe</b>.</li>
<li>Oben in der Datei steht ein kleiner Kopf (<code>---</code> … <code>---</code>) mit Datum, Zeit, Fach, Einheit, Lehrkraft und Raum. Nicht löschen, sonst ist es keine Stunde mehr. Klick darauf zeigt ihn zum Bearbeiten.</li>
</ul></div>

<div class="help-card"><h3>Fristen</h3>
<ul>
<li>In die Aufgabe schreiben: <code>bis Fr 16.10.</code>, <code>bis 16.10.</code> oder <code>Frist: 16.10.</code></li>
<li>Ohne Datum: Frist = nächste Stunde derselben Einheit (aus dem Stundenplan oder einer schon angelegten Stunde). Gestrichelt = geschätzt.</li>
<li>Gilt auf der Startseite und unter <b>Aufgaben</b> („Nach Frist“).</li>
</ul></div>

<div class="help-card"><h3>Material zur Stunde</h3>
<ul>
<li>PDF, Foto oder Word-Datei vom Computer auf eine offene Stunde ziehen.</li>
<li>Sie wird im Ordner <code>Material</code> der Einheit gespeichert und behält ihren Namen. Gibt es den Namen schon, kommt <code>-2</code>, <code>-3</code> … dazu – nichts wird überschrieben.</li>
<li>Der Link kommt unter <b>## Material</b>. Danach speichern.</li>
<li>Oben in jeder Stunde: die <b>Material-Leiste</b> mit Karten. Klick öffnet das Dokument rechts. ▾ klappt sie ein.</li>
</ul></div>

<div class="help-card"><h3>Dateien hinzufügen</h3>
<ul>
<li>Dateien oder ganze Ordner <b>irgendwo ins Fenster ziehen</b> – oder <b>+ Dateien hinzufügen</b> links oben.</li>
<li>Auf die offene Stunde: in deren <code>Material</code>. Auf einen Ordner links: in diesen Ordner. Sonst fragt <b>Dateien einsortieren</b>, wohin: vorgeschlagen ist die Stunde, die gerade läuft (oder die letzte).</li>
<li><b>Später – in den Eingang</b>: die Dateien warten in <code>_Eingang</code>. Links und auf der Startseite steht dann <b>Eingang</b> mit der Anzahl – ein Klick, und du sortierst sie ein.</li>
<li>Erlaubt sind nur <b>PDF</b>, <b>Bilder</b> (auch iPhone-Fotos HEIC) und <b>Office-Dateien</b> (Word, Excel, PowerPoint, OpenOffice). Andere Dateien sind grau und werden übersprungen.</li>
<li>Gibt es genau dieselbe Datei am Ziel schon, wird sie übersprungen. Liegt eine Datei aus dem Eingang dort schon, fragt die App: Kopie im Eingang in den Papierkorb legen (<b>Ja</b>) oder im Eingang lassen (<b>Nein</b>). Aus Ordnern werden nur die Dateien übernommen (ohne Unterordner).</li>
<li>Danach: <b>Rückgängig</b> in der Meldung unten – neue Dateien kommen in den Papierkorb, Dateien aus dem Eingang zurück in den Eingang, die Links verschwinden. Kopien, die in den Papierkorb gelegt wurden, holst du dort selbst zurück.</li>
</ul></div>

<div class="help-card"><h3>Übersicht (Fach → Einheit)</h3>
<ul>
<li>In jedem Ordner mit Stunden steht oben <b>📚 Übersicht</b>.</li>
<li><b>Stunden</b>: alle Stunden nach Einheit und Datum, mit Anzahl der Definitionen, Fragen, Hausaufgaben und Material.</li>
<li><b>Zusammenfassung</b>: alle DEF:, !!, EXAM:, ?? und offenen Aufgaben. Klick auf das Datum springt zur Stelle.</li>
<li><b>Alles lesen</b>: alle Stunden am Stück, wie ein Heft.</li>
<li><b>Material</b>: alle Dateien der Einheiten, neueste oben.</li>
<li>Die Übersicht wird immer neu aus den Stunden gebaut – nichts doppelt schreiben.</li>
</ul></div>

<div class="help-card"><h3>Notizen</h3>
<ul>
<li>Links in der Seitenleiste: Ordner und Notizen. Klick öffnet die Notiz als Tab.</li>
<li><b>+ Notiz</b> / <b>+ Ordner</b> oben in der Seitenleiste, oder Rechtsklick auf einen Ordner.</li>
<li>Rechtsklick (oder <b>⋯</b>): umbenennen, Speicherort zeigen, in den Papierkorb.</li>
<li>Notiz auf einen Ordner ziehen = verschieben.</li>
<li><b>Bearbeiten / Lesen</b> oben rechts (⌘E). Im Lesemodus: Doppelklick zum Bearbeiten.</li>
<li>Links erscheinen als kleine Chips. Zum Ändern des Links: <b>⌥ + Klick</b>.</li>
</ul></div>

<div class="help-card"><h3>Speichern</h3>
<ul>
<li><b>⌘S</b> speichert. Gespeichert wird nur mit ⌘S (oder dem Knopf <b>Speichern</b>).</li>
<li>Ein Punkt ● am Tab heißt: nicht gespeichert.</li>
<li>Beim Schließen eines Tabs oder der App fragt das Schulheft nach.</li>
<li>Wurde eine Notiz in einem anderen Programm geändert, wird sie neu geladen – oder du wirst gefragt.</li>
</ul></div>

<div class="help-card"><h3>Dokumente nebeneinander</h3>
<ul>
<li>Klick auf ein PDF oder Bild unter <b>Dokumente</b> öffnet es rechts neben der Notiz.</li>
<li>Die Trennlinie ziehen = Breite ändern. Doppelklick = Mitte.</li>
<li>Dokument in die Notiz ziehen, oder <b>🔗 Link</b> in der Leiste = Link einfügen.</li>
<li>Text im PDF markieren und mit ⌘C kopieren (Werkzeug „Auswählen“).</li>
</ul></div>

<div class="help-card"><h3>PDFs und Bilder bearbeiten</h3>
<ul>
<li><b>Text</b>: auf die Seite klicken und schreiben (z. B. Arbeitsblätter ausfüllen). ⌘Enter oder daneben klicken = fertig.</li>
<li><b>Notizzettel</b>, <b>Stift</b>, <b>Marker</b> (Shift = gerade Linie), <b>Pfeil</b>, <b>Rahmen</b>.</li>
<li><b>Abdecken</b>: weiße Fläche über alten Text – dann mit „Text“ neu schreiben.</li>
<li><b>Auswählen</b>: Anmerkung anklicken und verschieben, Doppelklick auf Text = ändern, Entf = löschen.</li>
<li><b>Radierer</b>: über Anmerkungen fahren. ⌘Z = rückgängig.</li>
<li>⌘S speichert direkt in die Datei. Das Original wird vorher in <code>_Original/</code> gesichert, deine Anmerkungen bleiben bearbeitbar. „⋯ → Original wiederherstellen“ macht alles rückgängig.</li>
</ul></div>

<div class="help-card"><h3>Markierungen</h3>
<table class="help-table">
<tr><td><span class="mk mk-imp"><span class="mk-tag">!!</span> Wichtig</span></td><td>Zeile beginnt mit <code>!!</code></td></tr>
<tr><td><span class="mk mk-exam"><span class="mk-tag">EXAM:</span> Prüfung</span></td><td><code>EXAM:</code> oder <code>TEST:</code></td></tr>
<tr><td><span class="mk mk-def"><span class="mk-tag">DEF:</span> Definition</span></td><td><code>DEF:</code></td></tr>
<tr><td><span class="mk mk-ask"><span class="mk-tag">??</span> Frage</span></td><td><code>??</code> – Frage an die Lehrkraft</td></tr>
<tr><td>☐ Aufgabe</td><td><code>- [ ]</code>, erledigt: <code>- [x]</code></td></tr>
<tr><td><mark>markiert</mark></td><td><code>==Text==</code></td></tr>
<tr><td><span class="red">rot</span></td><td><code>!!Text!!</code> mitten in der Zeile</td></tr>
</table>
<p>Die Knöpfe in der Leiste setzen die Marker für dich.</p></div>

<div class="help-card"><h3>Übersichten</h3>
<ul>
<li><b>Wichtig</b>: alle markierten Zeilen aus allen Notizen, mit Filter.</li>
<li><b>Aufgaben</b>: alle offenen <code>- [ ]</code>. Haken setzen ändert die Notiz (danach speichern).</li>
</ul></div>

<div class="help-card"><h3>Tastenkürzel</h3>
<table class="help-table">
<tr><td><kbd>⌘K</kbd></td><td>Suchen (Notizen, Dokumente, Text)</td></tr>
<tr><td><kbd>⌘S</kbd></td><td>Speichern</td></tr>
<tr><td><kbd>⌘E</kbd></td><td>Bearbeiten ↔ Lesen</td></tr>
<tr><td><kbd>⌘F</kbd></td><td>In der Notiz suchen</td></tr>
<tr><td><kbd>⌘B</kbd> / <kbd>⌘I</kbd></td><td>Fett / kursiv</td></tr>
<tr><td><kbd>⌘Z</kbd> / <kbd>⌘⇧Z</kbd></td><td>Rückgängig / wiederholen</td></tr>
<tr><td><kbd>⌘\\</kbd></td><td>Seitenleiste ein/aus</td></tr>
</table></div>

<div class="help-card"><h3>Bilder in Notizen</h3>
<ul>
<li>Bild kopieren und in die Notiz einfügen (⌘V), oder <b>🖼 Bild</b> in der Leiste.</li>
<li>Das Bild wird im Ordner <code>bilder/</code> neben der Notiz gespeichert (auch beim Ziehen auf eine Notiz, die keine Stunde ist).</li>
</ul></div>
</section></div>`);
