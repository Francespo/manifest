#!/usr/bin/env bash
# switch-manifest.sh — cambia il target attivo del router di Manifest.
#
# Questo script e' un CLIENT. Prima non lo era: avviava il router da solo con
# `nohup node`, ne scriveva lo stato in ~/.config e assumeva prod e staging sulla
# stessa macchina. Dopo la migrazione a due host nessuna delle tre cose e' piu' vera
# — il router gira come container su production, deployato dal repo `infra`
# (scripts/deploy-router.sh), e sa da solo dove stanno prod e staging perche' glielo
# dice il suo .env (PROD_URL / STAGING_URL).
#
# Quindi qui resta solo la parte che ha senso: parlare con la sua API di controllo.
# Avviare/riavviare il router, o riallineare le due configurazioni, non si fa piu' da
# qui: vedi `where` in fondo.
#
# Uso:
#   switch-manifest.sh status
#   switch-manifest.sh prod
#   switch-manifest.sh staging
#   switch-manifest.sh toggle
#   switch-manifest.sh wt <slug>
#   switch-manifest.sh route <target|porta>
#   switch-manifest.sh targets
#   switch-manifest.sh where
#
# Il router da contattare si sceglie con MANIFEST_ROUTER. Il default e' il router su
# `personal`, perche' e' quello che i client usano: il suo prod punta a production,
# quindi il traffico arriva comunque sulla macchina giusta.
#
# NON si usa il nome `MANIFEST_ROUTER_URL`: e' gia' preso da un'altra convenzione (in
# ~/.bashrc) che punta all'endpoint dei modelli, percorso `/v1/models` incluso. Reusare
# quel nome faceva leggere a questo script un URL sbagliato in silenzio.

set -euo pipefail

ROUTER_URL="${MANIFEST_ROUTER:-http://100.111.146.34:2098}"
ROUTER_URL="${ROUTER_URL%/}"

die() { printf '%s\n' "$*" >&2; exit 1; }

need_curl() { command -v curl >/dev/null 2>&1 || die "serve curl"; }

# Un target che non risolve non deve passare in silenzio: se il router non risponde
# e' inutile fingere che lo switch sia riuscito.
api_get() {
    need_curl
    curl -sf --max-time 10 "$ROUTER_URL$1" || die "il router non risponde su $ROUTER_URL (health: $ROUTER_URL/__router/health)"
}

api_post() {
    need_curl
    curl -sf --max-time 30 -X POST "$ROUTER_URL$1" || die "switch rifiutato dal router su $ROUTER_URL$1"
}

show_status() {
    local json
    json="$(api_get /__router/status)" || return 1
    if command -v jq >/dev/null 2>&1; then
        printf '%s\n' "$json" | jq --arg u "$ROUTER_URL" '
            "router:      \($u)",
            "attivo:      \(.active)  (porta \(.port))",
            "destinazione:\(.targetUrl)",
            "cambiato:    \(.lastSwitched)",
            "richieste:   \(.stats.totalRequests)  errori: \(.stats.errors)",
            "per target:  \(.stats.routesHandled | to_entries | map("\(.key)=\(.value)") | join("  "))"'
    else
        printf 'router: %s\n%s\n' "$ROUTER_URL" "$json"
    fi
}

case "${1:-}" in
    status)   show_status ;;

    prod)     api_post /__router/route?target=prod    >/dev/null; echo "target: prod";     show_status ;;
    staging)  api_post /__router/route?target=staging >/dev/null; echo "target: staging";  show_status ;;
    toggle)   api_post /__router/toggle               >/dev/null; show_status ;;

    wt)
        slug="${2:-}"
        [ -n "$slug" ] || die "uso: switch-manifest.sh wt <slug>"
        api_post "/__router/switch/wt/$slug" >/dev/null
        echo "target: worktree $slug"
        show_status ;;

    # Un target esplicito: un nome noto (prod/production/staging/dev/manifest-dev)
    # oppure una porta, per puntare una preview.
    route)
        t="${2:-}"
        [ -n "$t" ] || die "uso: switch-manifest.sh route <target|porta>"
        api_post "/__router/route?target=$t" >/dev/null
        echo "target: $t"
        show_status ;;

    targets)
        cat <<'EOF'
target    dove punta
prod      prod su production (default)   alias: production
staging   staging su personal            alias: dev, manifest-dev
wt/<slug> la preview di un worktree su personal
<porta>   una porta esplicita, per esempio 2105
EOF
        ;;

    # Le due cose che questo script faceva e che ora stanno altrove. Meglio dirlo
    # che fallire in modo oscuro o, peggio, farne una versione sbagliata.
    restart-router)
        die "il router non si avvia piu' da qui: gira come container su production,
deployato dal repo infra.  ->  infra/scripts/deploy-router.sh production" ;;

    snapshot|restart-prod|restart-staging)
        die "'$1' non e' piu' di questo script. La configurazione di Manifest ora e'
codice: infra/scripts/manifest-config.py (snapshot | diff | apply | merge).
I due stack si riavviano sul loro host: prod su production, staging su personal." ;;

    where)
        cat <<'EOF'
router         container `manifest-router`, deployato da infra/scripts/deploy-router.sh
               production -> prod locale, staging remoto (personal)
               personal   -> prod remoto (production), staging locale
config         infra/scripts/manifest-config.py  (snapshot | diff | apply | merge)
stack prod     production, /root/srv/manifest/docker
stack staging  personal,   /home/ubuntu/srv/manifest/docker (progetto mnfst-dev)
EOF
        ;;

    ''|-h|--help|help)
        sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
        ;;

    *) die "comando sconosciuto: $1  (usa --help)" ;;
esac
