# Test automatici di Mobile Dashboard

La suite rifà da sola le prove del plugin, così una modifica futura non rompe in silenzio quello che funzionava.
Funziona **solo su una copia locale di OJS 3.5 in Docker**, mai su un sito online: se l'indirizzo non è `localhost` si ferma.

## Come si lancia

1. Avviare Docker Desktop e la copia locale (`docker compose up -d` nella sua cartella).
2. Da Git Bash, nella radice del repository:

```bash
MD_LOCALE=/percorso/della/copia/docker bash tests/run.sh
```

Servono Node.js 22 o più recente e Google Chrome, Chromium o Microsoft Edge. Dura circa 14 minuti. Alla fine scrive `RISULTATO: tutti i N test superati` (codice di uscita 0) oppure l'elenco dei test falliti.

Si può lanciare anche un solo gruppo, o alcuni:

| Comando | Cosa prova | Durata |
|---|---|---|
| `bash tests/run.sh statici` | file e codice, senza browser | circa 1 minuto |
| `bash tests/run.sh telefono` | pagine del pannello a 390×844 | circa 6 minuti |
| `bash tests/run.sh computer` | 17 pagine a 1300 px, con e senza plugin | circa 8 minuti |

Ogni lancio comprende circa un minuto per salvare e preparare la copia locale e poi rimetterla com'era.

## Cosa fa

1. Controlla che in `config.inc.php` della copia locale la posta sia `default = log`. Se no, si ferma: **nessuna email parte davvero**.
2. Salva il database della copia locale e la cartella `plugins/generic/mobileDashboard` (se c'è).
3. Mette **dati finti** al posto di nomi, email, titoli e nomi delle riviste (`placeholders.sql`). Così le immagini in `tests/risultati/` non mostrano dati reali.
4. Installa il plugin di questo repository (solo i file del pacchetto: `MobileDashboardPlugin.php`, `index.php`, `version.xml`, `styles/`, `locale/`), lo attiva per il sito e spegne gli eventuali plugin indicati in `MD_DISABLE`.
5. Alla fine **rimette tutto com'era** (database, cartella del plugin, cache), anche se un test fallisce o la suite viene interrotta con Ctrl+C. Se nel frattempo sono comparsi file nuovi nella cartella dei file di OJS, lo segnala.

## Cosa copre

- **Statici:** formato della versione, nome e classe del plugin; `php -l` e `node --check` su tutti i file; stesse frasi in inglese e in italiano, e ogni frase usata nel PHP presente in inglese; nessuna regola di `mobile.css` che cambi il computer (tutto sta dentro `@media (max-width: 900px)`, tranne gli elementi creati dal plugin); file caricati con il plugin acceso e non caricati con il plugin spento.
- **Telefono:** nessuna pagina più larga dello schermo e nessun contenuto tagliato fuori dallo schermo; menu ☰ che si apre dentro lo schermo, arriva all'ultima voce e si chiude toccando fuori; menu delle fasi del workflow che si apre e si richiude scegliendo una fase; tabelle a schede con le etichette; elenchi dei plugin (rivista, Plugin Gallery, Administration) con nome e spunta sulla stessa riga e descrizione intera; Users & Roles con il nome in grassetto in alto; riquadri delle impostazioni abbastanza larghi; campi del Profilo (Identity, Contact) larghi quanto il modulo, uno per riga; pannello Tasks, statistiche ed elenchi (Counter R5, Announcements, Institutions) senza riquadri nei riquadri né titoli ripetuti, con Export sulla riga del titolo; schede su una riga che scorre di lato e resta sotto l'intestazione, con la scheda attiva unita al pannello; swipe con tocchi simulati che cambia scheda (prima le interne, poi le esterne, anche un po' obliquo, sopra una griglia, sulla pagina grigia sotto un pannello corto, nel Profilo e in Appearance > Setup, che ha lo stesso id di Site Setup) e trascinamento verticale che fa solo scorrere la pagina; dopo un tocco e uno swipe la linea colorata solo sulla scheda aperta (anche nel Profilo) e il pallino del focus solo con la tastiera; griglie nelle schede laterali (Workflow > Components) con i pulsanti dentro l'intestazione e le righe larghe quanto la griglia; nei pannelli laterali con un modulo, nuovo (Hosted Journals > Edit) o vecchio (Create Section), etichette e campi staccati dal bordo; editor del menu di navigazione con Assigned e Unassigned uno sotto l'altro, che si aprono e si chiudono toccando il titolo; Users & Roles con ogni data accanto al suo ruolo; barra dei passi di Invite to a role dentro lo schermo; DOIs senza il titolo che ripete la scheda; date del grafico delle statistiche senza sovrapposizioni; nessun errore JavaScript dai file del plugin.
- **Computer:** 17 pagine e finestre fotografate a 1300 px con e senza plugin: devono essere identiche al pixel. Prima di ogni foto la prova aspetta che la pagina abbia finito di caricare dalla rete; una coppia diversa si rifotografa una volta, perché a volte un elenco arriva dall'API dopo la foto, e se alla seconda prova coincide il controllo lo dice («alla seconda prova»). Una differenza dovuta al plugin resta anche alla seconda prova.

## Restano a mano

- Prova su un telefono vero (la suite simula un iPhone 390×844 in Chrome).
- Installazione del pacchetto su un sito online.

## Valori usati

Si possono cambiare con variabili d'ambiente:

- `MD_LOCALE` (obbligatoria): cartella della copia Docker, quella con `docker-compose.yml`;
- `MD_BASE=http://localhost:8080`: indirizzo della copia locale;
- `MD_JOURNAL=jse`: rivista dei test (percorso nell'URL);
- `MD_WORKFLOW=69/3` e `MD_WORKFLOW2=12/4`: un articolo in revisione e uno in produzione (`id/fase`);
- `MD_ADMIN` e `MD_ADMIN_PASSWORD`: amministratore del sito (se mancano: il primo amministratore nel database e la password scritta in `import-locale.ps1` nella copia Docker); la password non viene mai stampata;
- `MD_DISABLE`: altri plugin che cambiano le stesse pagine, da spegnere durante i test (nomi come in `plugin_settings`, separati da spazi; di solito nessuno);
- `MD_CHROME`: percorso del browser, se non è nella cartella solita.

## Risultati

In `tests/risultati/` (ignorata da git) restano le immagini del telefono, le coppie di immagini del computer che non coincidono e `browser.log`. I dati sono finti, ma prima di pubblicare un'immagine conviene guardarla.
