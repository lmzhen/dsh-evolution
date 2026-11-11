## Was es tut

Aus einer normalen Harness-Sitzung wird eine, die sich selbst verbessert: Der Agent merkt sich, was er gelernt hat, pflegt eine Skill-Bibliothek, prüft die eigene Arbeit, führt doppelte Skills zusammen und kuratiert sie mit der Zeit. Die Daten bleiben in deinem DSH-Home; die Modellaufrufe gehen an den Anbieter, den du konfiguriert hast.

## Was enthalten ist

- Gedächtnis: ein `memory`-Tool fürs Modell, das auf einem lokalen, mehrschichtigen Gedächtnisspeicher aufsetzt.
- Skills: das `skill_manage`-Tool, ein Katalog, den der Agent laden kann, und ein Arbeitsbereich für die Skill-Historie.
- Review und Zusammenführen: Hintergrund-Review, Skills in zwei Runden verfassen und eine Merge-Freigabe, die du einschalten kannst.
- Kuration und Wartung: Lebenszyklus-Prüfungen, Scans auf Abweichungen und eine rein lesende Health-Ansicht, die standardmäßig aus ist.
- Befehle: `/evolution pending`, `curator`, `maintain` und `doctor` laufen in jeder Sitzung, mit oder ohne Panel.

## Wo du es einstellst

Jeder änderbare Parameter gehört zu der Komponente, die ihn besitzt; dort zeigt das Panel den aktuellen Wert, den Standard ab Werk und ob du ihn überschrieben hast. Die meisten Änderungen gelten sofort, nur wenige Deployment-Einstellungen brauchen einen Neustart; Parameter, die du in Ruhe lässt, bleiben auf dem Standard.

## Hinweise

Normale Gedächtnis- und Skill-Schreibvorgänge werden standardmäßig automatisch übernommen. Erst wenn du die Schreibfreigabe aktivierst, wird jeder davon zu einem ausstehenden Eintrag, den du zuerst freigibst oder ablehnst. Die Health-Ansicht ist standardmäßig aus. Das Zusammenführen von Skills hat eine eigene Freigabe-Einstellung, getrennt von der Schreibfreigabe, und legt einen Beleg an, mit dem du den Merge rückgängig machen kannst.
