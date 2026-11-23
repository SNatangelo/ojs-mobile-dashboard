#!/usr/bin/env bash
# tests/run.sh
# Copyright (C) 2026 Stefano Natangelo
# SPDX-License-Identifier: AGPL-3.0-only
#
# Test automatici di Mobile Dashboard (mobileDashboard).
# SOLO per una copia locale di OJS 3.5 in Docker, mai per un sito online.
#
#   MD_LOCALE=/percorso/della/copia/docker bash tests/run.sh
#   MD_LOCALE=... bash tests/run.sh telefono     un gruppo (o più):
#                                                statici telefono computer
#
# Prima salva il database e la cartella del plugin della copia locale, poi
# mette dati finti al posto di nomi ed email reali e installa il plugin di
# questo repository. Alla fine rimette tutto com'era, anche se un test
# fallisce o la suite viene interrotta. Nessuna email parte davvero.

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"                   # radice del repository = il plugin
NAME=mobileDashboard
LOCALE="${MD_LOCALE:-}"
export MSYS_NO_PATHCONV=1
export MD_BASE="${MD_BASE:-http://localhost:8080}"
export MD_JOURNAL="${MD_JOURNAL:-jse}"           # rivista dei test (percorso nell'URL)
# Altri plugin che cambiano le stesse pagine, da spegnere durante i test
# (poi rimessi com'erano)
DISABLE=${MD_DISABLE:-}
# File del plugin da installare (gli stessi del pacchetto di release)
FILES="MobileDashboardPlugin.php index.php version.xml styles locale"
B=$MD_BASE
OUT="$HERE/risultati"
ALL="statici telefono computer"
WANT=" ${*:-$ALL} "

if [ -z "$LOCALE" ] || [ ! -f "$LOCALE/docker-compose.yml" -a ! -f "$LOCALE/compose.yaml" -a ! -f "$LOCALE/docker-compose.yaml" ]; then
  echo "Indicate in MD_LOCALE la cartella della copia Docker di OJS (quella con docker-compose.yml)."; exit 2
fi
# Solo la copia locale: host esattamente localhost, 127.0.0.1 o [::1], porta e
# percorso facoltativi, niente utente@ nell'URL (la password va a questo indirizzo)
[[ "$B" =~ ^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(/[^@]*)?$ ]] \
  || { echo "MD_BASE deve essere la copia locale (http://localhost, 127.0.0.1 o [::1], senza utente nell'URL)."; exit 2; }
for g in $WANT; do case " $ALL " in *" $g "*) ;; *) echo "Gruppo sconosciuto: $g (gruppi: $ALL)"; exit 2;; esac; done
want() { [[ "$WANT" == *" $1 "* ]]; }
winpath() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

PASS=0; FAIL=0; FAILED=()
ok()   { PASS=$((PASS+1)); echo "  ok    $1"; }
ko()   { FAIL=$((FAIL+1)); FAILED+=("$1"); echo "  FALLITO $1${2:+ — $2}"; }
check(){ if eval "$2"; then ok "$1"; else ko "$1" "$3"; fi; }

dc() { (cd "$LOCALE" && docker compose "$@"); }
db() { dc exec -T db mysql -uojs -pojs ojs -N -e "$1" 2>/dev/null; }
clear_cache() {
  dc exec -T ojs sh -c 'cd /var/www/html && rm -rf cache/opcache/* cache/t_compile/* cache/fc-* cache/*.php'
  sleep 3   # Apache rilegge i file di cache dopo qualche secondo
}

command -v node >/dev/null || { echo "Serve Node.js (node) per i test nel browser."; exit 2; }
docker info >/dev/null 2>&1 || { echo "Docker non è avviato: avviatelo e riprovate."; exit 2; }
[ "$(dc ps --status running --services 2>/dev/null | grep -c '^ojs$')" = 1 ] || dc up -d >/dev/null 2>&1
curl -s -o /dev/null --retry 15 --retry-connrefused --retry-delay 2 "$B/" || { echo "OJS locale non risponde su $B"; exit 2; }
for i in $(seq 1 30); do db "SELECT 1" | grep -q 1 && break; sleep 2; done

# Sicurezza: con la posta reale attiva i test non partono
MAIL=$(dc exec -T ojs awk '/^\[/{s=$0} s=="[email]" && /^[ \t]*default[ \t]*=/{v=$0; sub(/^[^=]*=[ \t]*/,"",v); gsub(/["\047 \t\r]/,"",v); print v}' /var/www/html/config.inc.php)
if [ "$MAIL" != log ]; then
  echo "In config.inc.php [email] default = '$MAIL': i test partono solo con 'log' (nessuna email reale)."; exit 2
fi

rm -rf "$OUT"; mkdir -p "$OUT"

# ---------------------------------------------------------------- salvataggio
echo "Salvo database e plugin della copia locale"
# La cartella del plugin si salva e si controlla l'archivio prima di toccarla;
# se non c'era, lo si annota (al ripristino viene tolta)
dc exec -T ojs sh -c "touch /tmp/mdtests-marker; rm -f /tmp/mdtests-plugin.tgz /tmp/mdtests-plugin.none; cd /var/www/html/plugins/generic \
  && if [ -e $NAME ]; then tar -czf /tmp/mdtests-plugin.tgz $NAME && tar -tzf /tmp/mdtests-plugin.tgz | grep -qx '$NAME/version.xml'; else touch /tmp/mdtests-plugin.none; fi" \
  || { echo "Salvataggio della cartella del plugin non riuscito: mi fermo senza toccare nulla."; exit 2; }
dc exec -T db sh -c 'mysqldump -uojs -pojs --single-transaction ojs > /tmp/mdtests-db.sql 2>/dev/null && test -s /tmp/mdtests-db.sql' \
  || { echo "Salvataggio del database non riuscito: mi fermo senza toccare nulla."; exit 2; }

restore() {
  trap - EXIT INT TERM
  echo; echo "## Ripristino della copia locale"
  dc exec -T db sh -c 'mysql -uojs -pojs ojs < /tmp/mdtests-db.sql 2>/dev/null && rm -f /tmp/mdtests-db.sql' \
    && echo "  database rimesso com'era" || echo "  ATTENZIONE: ripristino del database non riuscito (copia in /tmp/mdtests-db.sql del container db)"
  # Prima si estrae l'archivio a parte e lo si controlla, poi si sostituisce
  dc exec -T ojs sh -c "cd /var/www/html/plugins/generic && if [ -f /tmp/mdtests-plugin.none ]; then rm -rf $NAME && rm -f /tmp/mdtests-plugin.none; \
    else rm -rf /tmp/mdtests-restore && mkdir /tmp/mdtests-restore && tar -xzf /tmp/mdtests-plugin.tgz -C /tmp/mdtests-restore \
    && [ -f /tmp/mdtests-restore/$NAME/version.xml ] && rm -rf $NAME && mv /tmp/mdtests-restore/$NAME . && chown -R www-data:www-data $NAME \
    && rm -rf /tmp/mdtests-restore /tmp/mdtests-plugin.tgz; fi" \
    && echo "  cartella del plugin rimessa com'era" \
    || echo "  ATTENZIONE: cartella del plugin non rimessa (archivio in /tmp/mdtests-plugin.tgz del container ojs)"
  clear_cache
  local n; n=$(dc exec -T ojs sh -c 'find /var/www/files -newer /tmp/mdtests-marker -type f | wc -l; rm -f /tmp/mdtests-marker')
  [ "${n:-0}" = 0 ] && echo "  nessun file nuovo nella cartella dei file di OJS" || echo "  ATTENZIONE: $n file nuovi in /var/www/files"
}
trap restore EXIT
trap 'exit 130' INT TERM

# ---------------------------------------------------------------- preparazione
echo "Metto dati finti al posto di nomi, email e titoli"
dc exec -T db mysql -uojs -pojs ojs < "$HERE/placeholders.sql" 2>/dev/null || echo "  (dati finti non applicati del tutto)"

echo "Installo il plugin di questo repository"
STAGE=$(mktemp -d); mkdir -p "$STAGE/$NAME"
(cd "$SRC" && cp -r $FILES "$STAGE/$NAME/")
dc exec -T ojs rm -rf "/var/www/html/plugins/generic/$NAME"
dc cp "$(winpath "$STAGE/$NAME")" "ojs:/var/www/html/plugins/generic/$NAME" >/dev/null 2>&1
rm -rf "$STAGE"
dc exec -T ojs sh -c "chown -R www-data:www-data /var/www/html/plugins/generic/$NAME && chmod -R u+w /var/www/html/plugins/generic/$NAME"
dc exec -T -u www-data ojs php /var/www/html/lib/pkp/tools/installPluginVersion.php "plugins/generic/$NAME/version.xml" >/dev/null 2>&1

# Plugin attivo per il sito; quelli in MD_DISABLE spenti
db "DELETE FROM plugin_settings WHERE plugin_name='mobiledashboardplugin'"
db "INSERT INTO plugin_settings (plugin_name,context_id,setting_name,setting_value,setting_type) VALUES ('mobiledashboardplugin',NULL,'enabled','1','bool')"
for p in $DISABLE; do db "UPDATE plugin_settings SET setting_value='0' WHERE plugin_name='$p' AND setting_name='enabled'"; done
clear_cache

# Accesso come amministratore. La password si legge da MD_ADMIN_PASSWORD
# oppure da import-locale.ps1 nella cartella della copia Docker; mai stampata.
CJ=$(mktemp); command -v cygpath >/dev/null && CJ=$(cygpath -m "$CJ")
ADMIN=${MD_ADMIN:-$(db "SELECT u.username FROM users u JOIN user_user_groups uug ON uug.user_id=u.user_id JOIN user_groups g ON g.user_group_id=uug.user_group_id WHERE g.role_id=1 AND g.context_id IS NULL LIMIT 1")}
PW=${MD_ADMIN_PASSWORD:-$( [ -f "$LOCALE/import-locale.ps1" ] && grep -m1 'AdminPassword = ' "$LOCALE/import-locale.ps1" | sed -E "s/.*= *['\"]([^'\"]*)['\"].*/\1/")}
LT=$(curl -s -c "$CJ" -b "$CJ" "$B/index/login" | grep -o 'name="csrfToken" value="[^"]*' | cut -d'"' -f4)
curl -s -c "$CJ" -b "$CJ" -o /dev/null --data-urlencode "csrfToken=$LT" --data-urlencode "username=$ADMIN" --data-urlencode "password=$PW" "$B/index/login/signIn"
unset PW
export MD_SID=$(awk '$6=="OJSESSION"{print $7}' "$CJ")
# Lancia una prova di browser.mjs; LAST tiene le sue righe di esito
run_browser() {
  LAST=$(node "$(winpath "$HERE/browser.mjs")" "$1" "$(winpath "$OUT")" 2>&1); local rc=$?
  echo "$LAST" >> "$OUT/browser.log"
  echo "$LAST" | grep '^  ok\|^  FALLITO'
  PASS=$((PASS+$(echo "$LAST" | grep -c '^  ok')))
  local f; while IFS= read -r f; do FAIL=$((FAIL+1)); FAILED+=("${f#  FALLITO }"); done < <(echo "$LAST" | grep '^  FALLITO')
  if [ $rc != 0 ] && ! echo "$LAST" | grep -q '^  FALLITO'; then
    ko "prova \"$1\" nel browser non partita" "$(echo "$LAST" | grep -m1 -i 'error' | head -c 200)"
  fi
}
check "accesso come amministratore alla copia locale" '[ -n "$MD_SID" ] && curl -sL -b "$CJ" "$B/$MD_JOURNAL/dashboard/editorial" | grep -q "app__main\|pkp_structure_main"'

# ---------------------------------------------------------------- statici
if want statici; then
  echo; echo "## Controlli dei file"
  T=$(mktemp -d)
  rel=$(grep -o '<release>[^<]*' "$SRC/version.xml" | cut -d'>' -f2)
  cls=$(grep -o '<class>[^<]*' "$SRC/version.xml" | cut -d'>' -f2)
  app=$(grep -o '<application>[^<]*' "$SRC/version.xml" | cut -d'>' -f2)
  check "versione $rel nel formato di OJS (a.b.c.d)" '[[ "$rel" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]'
  check "nome del plugin $app uguale alla cartella ($NAME)" '[ "$app" = "$NAME" ]'
  check "la classe $cls esiste" '[ -f "$SRC/$cls.php" ] && grep -q "class $cls " "$SRC/$cls.php"'
  bad=$(dc exec -T ojs sh -c "cd /var/www/html/plugins/generic/$NAME && for f in \$(find . -name '*.php'); do php -l \$f >/dev/null 2>&1 || echo \$f; done")
  check "PHP senza errori di sintassi" '[ -z "$bad" ]' "$bad"
  for js in "$SRC"/styles/*.js; do
    check "$(basename "$js") senza errori di sintassi" 'node --check "$(winpath "$js")" 2>/dev/null'
  done
  grep '^msgid "' "$SRC/locale/en/locale.po" | sort > "$T/en"; grep '^msgid "' "$SRC/locale/it/locale.po" | sort > "$T/it"
  check "stesse traduzioni in inglese e italiano" 'cmp -s "$T/en" "$T/it"' "$(diff "$T/en" "$T/it" | tr '\n' ' ')"
  miss=$(grep -oh "__('plugins\.generic\.[^']*'" "$SRC"/*.php | cut -d"'" -f2 | sort -u | while read -r k; do grep -q "^msgid \"$k\"" "$SRC/locale/en/locale.po" || echo "$k"; done)
  check "ogni testo usato nel PHP è tradotto" '[ -z "$miss" ]' "$miss"
  cssbad=$(node "$(winpath "$HERE/css-check.mjs")" "$(winpath "$SRC/styles/mobile.css")")
  check "il CSS cambia qualcosa solo sotto i 900 px" '[ -z "$cssbad" ]' "$cssbad"
  c=$(curl -sL -b "$CJ" "$B/$MD_JOURNAL/dashboard/editorial" | grep -c "$NAME/styles/mobile")
  check "plugin attivo: i suoi file vengono caricati" '[ "$c" -ge 1 ]' "$c"
  db "UPDATE plugin_settings SET setting_value='0' WHERE plugin_name='mobiledashboardplugin' AND setting_name='enabled'"; clear_cache
  c=$(curl -sL -b "$CJ" "$B/$MD_JOURNAL/dashboard/editorial" | grep -c "$NAME/styles/mobile")
  check "plugin spento: i suoi file non vengono caricati" '[ "$c" = 0 ]' "$c"
  db "UPDATE plugin_settings SET setting_value='1' WHERE plugin_name='mobiledashboardplugin' AND setting_name='enabled'"; clear_cache
  rm -rf "$T"
fi

# ---------------------------------------------------------------- browser
if want telefono; then
  echo; echo "## Telefono (390×844)"
  run_browser telefono
fi
if want computer; then
  echo; echo "## Computer (1300 px): identico con e senza plugin"
  run_browser computer
fi

rm -f "$CJ"
echo
echo "Schermate in $(winpath "$OUT") (dati finti; guardatele prima di pubblicarle)"
if [ $FAIL = 0 ]; then
  echo "RISULTATO: tutti i $PASS test superati"
else
  echo "RISULTATO: $FAIL test falliti su $((PASS+FAIL)):"; printf '  - %s\n' "${FAILED[@]}"
fi
[ $FAIL = 0 ]
