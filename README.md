# ELCO RemoconNet für Homey Pro

Private Homey-App für die Abfrage einer ELCO-Gastherme über RemoconNet. Die Zuordnung basiert auf öffentlich dokumentierten Gasthermen-Antworten. Welche Werte die THISION MINI mit deinem Gateway liefert, zeigt der erste Test vor Ort.

> **Hinweis:** Diese App wurde unabhängig entwickelt und ist keine offizielle ELCO-App. Die Nutzung erfolgt auf eigene Gefahr.

## Kompatibilität

Die App wurde mit einer **ELCO THISION MINI** auf Homey Pro getestet. Sie lässt sich mit einem eigenen RemoconNet-Konto und einer eigenen Anlage koppeln.

Andere ELCO-Gasthermen mit derselben RemoconNet-Schnittstelle können ebenfalls funktionieren. Je nach Modell können Messwerte fehlen, anders skaliert sein oder andere Betriebsarten zur Verfügung stehen. Für Wärmepumpen und andere Geräteserien liegen bisher keine Tests vor.

## Installation

1. Aktualisiere Homey Pro auf Firmware 12.9.0 oder neuer. Installiere Node.js 22 und die [Homey CLI](https://apps.developer.homey.app/the-basics/getting-started). Halte bei einem Homey Pro Early 2023 auch Docker bereit.
2. Entpacke das ZIP und öffne ein Terminal im Ordner `remocon-homey` (dort liegt `app.json`).
3. Melde dich bei Athom an, wähle deinen Homey Pro und installiere die App.

   ```sh
   npm install --global --no-optional homey
   homey login
   homey select
   homey app validate --level debug
   homey app install
   ```

4. Wähle in der Homey-App **Geräte → + → Neues Gerät → ELCO RemoconNet → ELCO-Heizung**. Gib dort E-Mail und Passwort deines RemoconNet-Kontos ein und wähle die Anlage. Die App sucht deine Anlagen automatisch. Falls die Liste leer bleibt, öffne die Anlage im [RemoconNet-Webportal](https://www.remocon-net.remotethermo.com/) und gib den letzten Teil der Adresse nach `/R2/Plant/Index/` in Homey ein. Homey speichert die Zugangsdaten im Gerätespeicher und die App verwendet sie für die Anmeldung bei RemoconNet. Bei geändertem Passwort verwende die Reparaturfunktion des Geräts.

## Messwerte prüfen

- **Brenner aktiv** verwendet das Flammensignal und fragt bei Bedarf zusätzlich `IsFlameOn` ab. Vergleiche es mit der iOS-App bei laufendem Brenner. Homey fragt den Status im Abstand von 15 Minuten ab. Die Flow-Auslöser reagieren auf von Homey beobachtete Zustände, kurze Zyklen können zwischen zwei Abfragen liegen.
- **Vorlauftemperatur** zeigt die gemessene Kessel-Vorlauftemperatur in °C.
- **Brennerstunden** erscheinen getrennt für Heizung und Warmwasser. Für die dokumentierten Diagnosefelder rechnet die App den gelieferten Wert mit Faktor zehn in Stunden um. Vergleiche die Rohwerte im INFO-Menü der THISION MINI, Parameter 810 und 811. ELCO gibt dort den Faktor zehn an. Die Werte sind kumulierte Zähler.
- **Gas Heizung / Warmwasser** zeigt die als kWh interpretierte RemoconNet-Monatswerte. Vergleiche sie mit der RemoconNet-Verbrauchsansicht für denselben Zeitraum und dieselbe Einheit. Die App fragt sie beim Start und ungefähr stündlich ab.
- Fehlende Werte bleiben leer. Wenn das Gerät keine unterstützten Werte liefert, zeigt Homey eine Meldung. Teile zur Fehlersuche den Meldungstext und die Namen der sichtbaren bzw. fehlenden Sensoren.

## Betriebsart ändern

Im Homey-Gerät oder mit der Flow-Aktion **Betriebsart einstellen** kannst du **Sommer**, **Winter**, **Nur Heizen** und **Aus** wählen. Homey nimmt den Auftrag sofort entgegen. Unter **Aktuelle Betriebsart** zeigt die App den Wechselstatus und anschließend den von RemoconNet gemeldeten Zustand. Ein erfolgreicher Flow bedeutet, dass der Auftrag angenommen wurde. Änderungen aus der iOS-App erscheinen beim nächsten regulären Abruf. Ein dort aktivierter Urlaubsmodus erscheint in Homey als leere Auswahl.

## Tagesverbrauch, Monatsverbrauch und Homey Insights

Installiere die neue Version mit `homey app install` über die bestehende App. Bereits gekoppelte Heizungen erhalten die zusätzlichen Messwerte beim Start.

- **Gas heute / diesen Monat / letzter Monat (m³)** nutzt die Volumenwerte aus dem RemoconNet-Webbericht. Heizung und Warmwasser erscheinen getrennt in m³, sofern der Bericht die passenden Reihen liefert. Die Abfrage erfolgt beim Start und ungefähr stündlich. Der Tagesbericht wird von RemoconNet in Zwei-Stunden-Abschnitten geführt.
- **Brennerleistung** zeigt den gemeldeten Momentanwert in kW zum Zeitpunkt der Abfrage.
- **Außentemperatur Heizung** verwendet den Anlagenstatus oder den RemoconNet-Datenpunkt OutsideTemp. Falls der Anlagenstatus fehlt, lässt sich die Herkunft vom physischen Fühler anhand der Cloud-Antwort allein nicht bestätigen. Vorlauf und Außentemperatur werden im selben 15-Minuten-Abfragezyklus aktualisiert.
- In der Homey-Web-App unter **Insights** wählst du beim Heizungsgerät **Vorlauftemperatur** und **Außentemperatur Heizung** im selben Zeitraum. Die App schreibt gültige Temperatur-, Leistungs-, Verbrauchs- und Betriebsstundenwerte bei jedem Abruf direkt nach Insights. Der Brennerstatus bleibt in der Geräteansicht und für Flows verfügbar. Suche die Reihen über den Gerätenamen, beispielsweise **Heizung – Vorlauftemperatur**. Die neuen Reihen beginnen mit der Installation. Homey verwaltet Speicherung und zeitliche Verdichtung.

## Diagnose bei fehlenden Werten

Öffne in Homey das Heizungsgerät, das Zahnrad und die erweiterten Einstellungen. **RemoconNet-Diagnose** zeigt nach der ersten Abfrage den Status des Außenfühlers und des Verbrauchsberichts. Die Zeile enthält Feldtypen und Anzahlen, aber keine Zugangsdaten, Anlagenkennung oder Rohantworten.

## Protokollreferenzen

- [elco-remocon-net](https://github.com/HAL9000RELOADED/elco-remocon-net) für Anmeldung, Gasthermen-Endpunkte und die Diagnosedaten.
- [python-ariston-api](https://github.com/fustom/python-ariston-api/blob/main/ariston/galevo_device.py) für Menüwerte und das Monatsformat des Gasverbrauchs.
- [ELCO Remocon-Net AppDaemon](https://github.com/nechry/elco-remocon-net-appdaemon) für das Flammensignal.

## Dashboard-Widget

In der Homey-Mobilapp unter **Mehr → Dashboards** ein Dashboard öffnen oder erstellen.
Beim Bearbeiten **Widget hinzufügen → Apps → ELCO RemoconNet → Heizungssteuerung** wählen.
Bei mehreren Heizungen wähle das gewünschte Gerät in den Widget-Einstellungen aus.
Die grüne Taste zeigt die bestätigte Betriebsart. Während eines Wechsels wird das Ziel umrandet.
