---
name: manifest-dev
description: Manifest environments, the router, and where the config lives. Use when switching the gateway between prod and staging, checking stack health, needing the right base URL, or changing routing tiers and providers.
---

# Manifest: ambienti, router, configurazione

## Dove gira cosa

Dopo la migrazione prod e staging stanno su **macchine diverse**, quindi nessun host
puo' ricavare la destinazione da un solo indirizzo.

| | host | indirizzo | chi ci parla |
|---|---|---|---|
| prod | `production` | `100.109.76.51:2099` | il router |
| staging | `personal` | `100.111.146.34:2100` | il router |
| router | `production` | `100.109.76.51:2098` | agenti e tool |
| router | `personal` | `100.111.146.34:2098` | i client (`pi`, OpenClaw) |

`prod` **non ascolta su loopback**: lega l'IP del tailnet. `127.0.0.1:2099` non
risponde, nemmeno sulla stessa macchina. E' il motivo per cui il router ha
`PROD_URL` e `STAGING_URL` invece di ricavare tutto da `BACKEND_HOST`.

Il router e' un **container**, non piu' un demone systemd avviato da questi script: si
deploya da `infra` con `scripts/deploy-router.sh <host>`. Lo stato e' per-router: uno
switch fatto su uno non si vede dall'altro, e non e' condiviso.

## Cambiare target: `switch-manifest.sh`

E' un **client** del router: chiama l'API di controllo via HTTP, non avvia niente. Se
il router non risponde lo dice, invece di avviarne uno per conto suo.

```bash
./scripts/switch-manifest.sh status      # router, target attivo, salute
./scripts/switch-manifest.sh prod        # tutti i modelli -> prod
./scripts/switch-manifest.sh staging     # tutti i modelli -> staging
./scripts/switch-manifest.sh toggle      # inverte il target
./scripts/switch-manifest.sh wt <slug>   # -> stack del worktree
./scripts/switch-manifest.sh targets     # cosa offre
./scripts/switch-manifest.sh where       # dove gira il router che sta contattando
```

Il router da contattare si sceglie con **`MANIFEST_ROUTER`**, default
`http://100.111.146.34:2098`. **Non** usare `MANIFEST_ROUTER_URL`: quel nome e' gia'
occupato e contiene un percorso (`.../v1/models`), quindi passarlo produce URL rotti
(`.../v1/models/__router/status`).

### Cosa non fa piu' (e dove e' finito)

| prima | ora |
|---|---|
| `restart-router` | `infra/scripts/deploy-router.sh <host>` |
| `restart-prod` / `restart-staging` | ricostruire l'immagine e `docker compose up -d --force-recreate manifest` sull'host di competenza |
| `snapshot prod-to-staging` / `staging-to-prod` | `infra/scripts/manifest-config.py diff \| apply` |

I vecchi comandi gestivano stack **locali**: con prod e staging su macchine diverse non
potevano piu' funzionare. Lo script ora esce con un errore che dice dove sono finiti,
invece di fare qualcosa di diverso da quello che il nome promette.

## La configurazione sta in git

Tier, provider e agenti vivono in `infra/services/manifest/config/manifest-config.json`,
non nel database come fonte di verita'. `infra/scripts/manifest-config.py` offre
`snapshot` / `diff` / `apply` / `merge` / `copy-secret`.

Le colonne dei segreti sono escluse dallo snapshot **per costruzione**: `apply` non puo'
cancellare le chiavi di un'istanza. Il rovescio e' che un provider migrato arriva senza
chiave, e serve un `copy-secret` esplicito (una colonna, una riga, per nome).

## Il router ha una copia sola

Il codice del router sta in `infra/services/manifest-router/`. La copia
`scripts/manifest-router.js` di questo repo e' codice di **upstream** e vale solo come
riferimento: non e' quella che gira, e una correzione fatta qui non arriva agli host.
E' il motivo per cui i router erano divergiti. Per cambiare il router: modifica
`infra`, poi redeploya.

## Worktree locali

`worktree-stack.sh` resta valido **solo** su un host che ha worktree locali e le
immagini corrispondenti (oggi: nessuno degli host in produzione). Con prod e staging
distribuiti, uno stack per worktree non ha piu' un posto naturale dove girare.
