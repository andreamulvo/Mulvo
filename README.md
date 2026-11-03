# Mulvo · Formazione

Questa sezione serve a studiare con costanza: tiene traccia dei corsi e del prossimo passo da fare, e trasforma quello che impari in idee di contenuto.
È un sito statico, senza build: HTML, CSS e JavaScript. I dati stanno in file JSON dentro la repo.

## Cosa fa

| Area | Funzioni |
|---|---|
| **Scheda corso** | Titolo, piattaforma, link e categoria. La frase «Perché lo sto facendo» è in evidenza. I moduli sono una checklist da spuntare e la percentuale di avanzamento si calcola da sola. Ci sono anche date di inizio e scadenza, minuti per lezione e stato (da iniziare / in corso / in pausa / completato). |
| **Avanzamento** | Una barra per ogni corso e una complessiva. C'è una previsione «a questo ritmo finisci il…», confrontata con la scadenza e con il ritmo che servirebbe per rispettarla. Un avviso gentile compare se un corso è fermo da più di 7 giorni. |
| **Costanza** | Registro delle sessioni (data, minuti, corso, modulo), streak, calendario a heatmap e obiettivo settimanale in minuti. In Home trovi sempre la **prossima azione**, cioè il prossimo modulo da fare. I traguardi vengono festeggiati: primo modulo, 50%, corso completato, streak di 3, 10, 30 e 100 giorni. |
| **Dal corso al contenuto** | Ogni modulo completato ha un campo «cosa ho imparato». Il pulsante 💡 lo trasforma in un'idea nello swipe file (`data/swipe.json`), con canale e stato (idea / bozza / pubblicata). |
| **Revisione settimanale** | Ogni domenica la Home propone il riepilogo della settimana: minuti rispetto all'obiettivo, giorni di studio, moduli completati, cosa hai imparato e tempo per corso. Qui fissi l'obiettivo e i minuti della settimana dopo. |

## Dati

- `data/formazione.json` contiene corsi, moduli, sessioni, revisioni, traguardi e impostazioni.
- `data/swipe.json` contiene le idee di contenuto.

Le spunte, le sessioni e le note **si salvano dall'interfaccia**:

1. Sul dispositivo ogni modifica va subito in `localStorage`, quindi funziona anche offline.
2. Se in **Impostazioni** inserisci un token GitHub, ogni modifica diventa anche un commit nei file JSON della repo. Il token è *fine-grained*, limitato a questa repo, con permesso *Contents: Read and write*. Se hai modificato i dati sia dal telefono sia dal computer, le modifiche vengono unite record per record, quindi non si sovrascrivono a vicenda.

Il token resta solo nel browser del dispositivo su cui lo inserisci, quindi va inserito su ognuno (telefono compreso). Senza token i dati restano sul dispositivo e puoi esportarli o importarli in JSON.

## Usarlo

- **Pubblicazione:** in GitHub, Settings → Pages → *Deploy from a branch* e scegli il branch. Poi apri il sito anche da telefono: puoi aggiungerlo alla schermata Home e il pulsante «+ Sessione» è sempre a portata di pollice.
- **In locale:** `npm start` (oppure `python3 -m http.server 8080`) e apri http://localhost:8080.
- **Test della logica** (date, previsioni, streak, traguardi, unione dei dati): `npm test`.

## Struttura

```
index.html
assets/css/style.css
assets/js/logic.js   calcoli puri (avanzamento, previsione, streak, traguardi, merge)
assets/js/store.js   localStorage + lettura e scrittura via GitHub API
assets/js/app.js     viste e interazioni
data/*.json          i tuoi dati
tests/               test con node:test
```
