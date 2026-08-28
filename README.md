# Disk Health Deck

Plugin per Stream Deck che porta i dischi del PC sui tasti: spazio libero, salute
SMART, temperatura, attività I/O, più rete, ventole e consumi. Ogni tasto si
aggiorna una volta al secondo.

Pubblicato su Elgato Marketplace come `com.diskdeck.monitor`.

## Come funziona

| Componente | Ruolo |
|---|---|
| `bin/sampler.ps1` | Un processo PowerShell pubblica una riga JSON al secondo con spazio e contatori I/O di ogni volume, letti da `Win32_LogicalDisk` e `Win32_PerfFormattedData_PerfDisk_LogicalDisk` (classi indipendenti dalla lingua di Windows). |
| `bin/sampler.js` | Tiene aperto quel processo, ne conserva lo storico per i grafici e lo riavvia se muore. |
| `bin/sensors.js` | Temperature, salute SMART, ventole, rete e potenze da LibreHardwareMonitor (JSON su HTTP) con ripiego su HWiNFO (Shared Memory Registry). |
| `bin/render.js` | Disegna i tasti come SVG e li restituisce come data-URI. Nessuna dipendenza grafica. |
| `bin/plugin.js` | Registra le nove azioni, decide cosa disegnare e gestisce rotazione, allarmi e pressione prolungata. |
| `ui/` | Property Inspector autonomo, senza librerie esterne. |

### Due dettagli non ovvi

LibreHardwareMonitor non apre sempre il web server su `127.0.0.1`: il
rilevamento prova localhost e tutti gli IPv4 della macchina, in parallelo, su
tre porte.

Windows e LibreHardwareMonitor chiamano lo stesso disco in modo diverso
("Samsung SSD 990 PRO with Heatsink 1TB" contro "Samsung SSD 990 PRO 2TB"),
quindi l'abbinamento prova nell'ordine: modello esatto, sensore intestato alla
lettera di unità (`DISK_C_TEMP`), confronto approssimato per parole.

## Sviluppo

```bash
npm install --prefix com.diskdeck.monitor.sdPlugin   # dipendenze del plugin
npm run build                                        # icone PNG e profili
npm run link                                         # collega a Stream Deck
npm run restart                                      # ricarica dopo una modifica
```

I log finiscono in `com.diskdeck.monitor.sdPlugin/logs/`.

### Artefatti generati

Non sono versionati, si ricreano con `npm run build`:

- `imgs/*.png` — icone, da [`build-icons.mjs`](build-icons.mjs). Le versioni per
  l'elenco azioni sono monocromatiche su fondo trasparente, come richiesto dalle
  linee guida Elgato; quelle dei tasti sono a colori.
- `*.streamDeckProfile` — le viste a schermo intero aperte dalla pressione
  prolungata, una per formato di dispositivo, da [`build-profile.mjs`](build-profile.mjs).
  I tasti indicano i dischi per posizione (`#1`, `#2`, …) e non per lettera, così
  lo stesso profilo funziona su qualsiasi PC.

`npm run gallery` rigenera le immagini della pagina prodotto in `marketplace/`,
componendo i tasti veri con i dati reali della macchina e catturandoli con Edge
in modalità headless.

## Pubblicazione

```bash
npm run validate
npm run pack     # dist/com.diskdeck.monitor.streamDeckPlugin
```

Il DRM del Marketplace richiede `SDKVersion: 3`, `Software.MinimumVersion: 6.9`,
`@elgato/streamdeck` v2 o superiore e Stream Deck CLI 1.6 o superiore. La
protezione viene applicata da Elgato quando il pacchetto viene elaborato.

## Requisiti

Windows 10 o successivo, Stream Deck 6.9 o successivo.

Spazio e attività I/O funzionano senza altro. Temperature, salute SMART,
ventole, rete e consumi richiedono
[LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
con il web server attivo (Options → Remote Web Server → Run), oppure HWiNFO con
la Shared Memory Registry.

## Licenza

Tutti i diritti riservati. Il codice non è distribuito con licenza libera.
