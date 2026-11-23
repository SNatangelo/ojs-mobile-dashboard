#!/usr/bin/env bash
# tests/run.sh
# Copyright (C) 2026 Stefano Natangelo
# SPDX-License-Identifier: AGPL-3.0-only
#
# Mobile Dashboard (mobileDashboard) automated tests.
# ONLY for a local OJS 3.5 copy in Docker, never for a live site.
#
#   MD_LOCALE=/path/to/the/docker/copy bash tests/run.sh
#   MD_LOCALE=... bash tests/run.sh phone        one group (or more):
#                                                static phone desktop
#
# It first backs up the local copy's database and plugin folder, then replaces
# real names and email addresses with placeholder data and installs the plugin
# from this repository. At the end it restores everything, even if a test
# fails or the suite is interrupted. No email is actually sent.

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"                   # repository root = the plugin
NAME=mobileDashboard
LOCALE="${MD_LOCALE:-}"
export MSYS_NO_PATHCONV=1
export MD_BASE="${MD_BASE:-http://localhost:8080}"
export MD_JOURNAL="${MD_JOURNAL:-jse}"           # journal used by the tests (path in the URL)
# Other plugins that change the same pages, disabled during the tests
# (and then restored)
DISABLE=${MD_DISABLE:-}
# Plugin files to install (the same as in the release package)
FILES="MobileDashboardPlugin.php index.php version.xml styles locale"
B=$MD_BASE
OUT="$HERE/results"
ALL="static phone desktop"
WANT=" ${*:-$ALL} "

if [ -z "$LOCALE" ] || [ ! -f "$LOCALE/docker-compose.yml" -a ! -f "$LOCALE/compose.yaml" -a ! -f "$LOCALE/docker-compose.yaml" ]; then
  echo "Set MD_LOCALE to the folder of the OJS Docker copy (the one with docker-compose.yml)."; exit 2
fi
# Local copy only: host exactly localhost, 127.0.0.1 or [::1], optional port and
# path, no user@ in the URL (the password is sent to this address)
[[ "$B" =~ ^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(/[^@]*)?$ ]] \
  || { echo "MD_BASE must be the local copy (http://localhost, 127.0.0.1 or [::1], with no user in the URL)."; exit 2; }
for g in $WANT; do case " $ALL " in *" $g "*) ;; *) echo "Unknown group: $g (groups: $ALL)"; exit 2;; esac; done
want() { [[ "$WANT" == *" $1 "* ]]; }
winpath() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

PASS=0; FAIL=0; FAILED=()
ok()   { PASS=$((PASS+1)); echo "  ok    $1"; }
ko()   { FAIL=$((FAIL+1)); FAILED+=("$1"); echo "  FAILED $1${2:+ — $2}"; }
check(){ if eval "$2"; then ok "$1"; else ko "$1" "$3"; fi; }

dc() { (cd "$LOCALE" && docker compose "$@"); }
db() { dc exec -T db mysql -uojs -pojs ojs -N -e "$1" 2>/dev/null; }
clear_cache() {
  dc exec -T ojs sh -c 'cd /var/www/html && rm -rf cache/opcache/* cache/t_compile/* cache/fc-* cache/*.php'
  sleep 3   # Apache rereads the cache files after a few seconds
}

command -v node >/dev/null || { echo "Node.js (node) is needed for the browser tests."; exit 2; }
docker info >/dev/null 2>&1 || { echo "Docker is not running: start it and try again."; exit 2; }
[ "$(dc ps --status running --services 2>/dev/null | grep -c '^ojs$')" = 1 ] || dc up -d >/dev/null 2>&1
curl -s -o /dev/null --retry 15 --retry-connrefused --retry-delay 2 "$B/" || { echo "Local OJS is not responding at $B"; exit 2; }
for i in $(seq 1 30); do db "SELECT 1" | grep -q 1 && break; sleep 2; done

# Safety: the tests do not start if real mail is enabled
MAIL=$(dc exec -T ojs awk '/^\[/{s=$0} s=="[email]" && /^[ \t]*default[ \t]*=/{v=$0; sub(/^[^=]*=[ \t]*/,"",v); gsub(/["\047 \t\r]/,"",v); print v}' /var/www/html/config.inc.php)
if [ "$MAIL" != log ]; then
  echo "config.inc.php has [email] default = '$MAIL': the tests only run with 'log' (no real email)."; exit 2
fi

rm -rf "$OUT"; mkdir -p "$OUT"

# ---------------------------------------------------------------- backup
echo "Backing up the local copy's database and plugin"
# The plugin folder is archived and the archive checked before touching it;
# if there was none, that is recorded (and the folder is removed on restore)
dc exec -T ojs sh -c "touch /tmp/mdtests-marker; rm -f /tmp/mdtests-plugin.tgz /tmp/mdtests-plugin.none; cd /var/www/html/plugins/generic \
  && if [ -e $NAME ]; then tar -czf /tmp/mdtests-plugin.tgz $NAME && tar -tzf /tmp/mdtests-plugin.tgz | grep -qx '$NAME/version.xml'; else touch /tmp/mdtests-plugin.none; fi" \
  || { echo "Plugin folder backup failed: stopping without touching anything."; exit 2; }
dc exec -T db sh -c 'mysqldump -uojs -pojs --single-transaction ojs > /tmp/mdtests-db.sql 2>/dev/null && test -s /tmp/mdtests-db.sql' \
  || { echo "Database backup failed: stopping without touching anything."; exit 2; }

restore() {
  trap - EXIT INT TERM
  echo; echo "## Restoring the local copy"
  dc exec -T db sh -c 'mysql -uojs -pojs ojs < /tmp/mdtests-db.sql 2>/dev/null && rm -f /tmp/mdtests-db.sql' \
    && echo "  database restored" || echo "  WARNING: database restore failed (copy in /tmp/mdtests-db.sql in the db container)"
  # The archive is first extracted elsewhere and checked, then swapped in
  dc exec -T ojs sh -c "cd /var/www/html/plugins/generic && if [ -f /tmp/mdtests-plugin.none ]; then rm -rf $NAME && rm -f /tmp/mdtests-plugin.none; \
    else rm -rf /tmp/mdtests-restore && mkdir /tmp/mdtests-restore && tar -xzf /tmp/mdtests-plugin.tgz -C /tmp/mdtests-restore \
    && [ -f /tmp/mdtests-restore/$NAME/version.xml ] && rm -rf $NAME && mv /tmp/mdtests-restore/$NAME . && chown -R www-data:www-data $NAME \
    && rm -rf /tmp/mdtests-restore /tmp/mdtests-plugin.tgz; fi" \
    && echo "  plugin folder restored" \
    || echo "  WARNING: plugin folder not restored (archive in /tmp/mdtests-plugin.tgz in the ojs container)"
  clear_cache
  local n; n=$(dc exec -T ojs sh -c 'find /var/www/files -newer /tmp/mdtests-marker -type f | wc -l; rm -f /tmp/mdtests-marker')
  [ "${n:-0}" = 0 ] && echo "  no new files in the OJS files folder" || echo "  WARNING: $n new files in /var/www/files"
}
trap restore EXIT
trap 'exit 130' INT TERM

# ---------------------------------------------------------------- setup
echo "Replacing names, email addresses and titles with placeholder data"
dc exec -T db mysql -uojs -pojs ojs < "$HERE/placeholders.sql" 2>/dev/null || echo "  (placeholder data not fully applied)"

echo "Installing the plugin from this repository"
STAGE=$(mktemp -d); mkdir -p "$STAGE/$NAME"
(cd "$SRC" && cp -r $FILES "$STAGE/$NAME/")
dc exec -T ojs rm -rf "/var/www/html/plugins/generic/$NAME"
dc cp "$(winpath "$STAGE/$NAME")" "ojs:/var/www/html/plugins/generic/$NAME" >/dev/null 2>&1
rm -rf "$STAGE"
dc exec -T ojs sh -c "chown -R www-data:www-data /var/www/html/plugins/generic/$NAME && chmod -R u+w /var/www/html/plugins/generic/$NAME"
dc exec -T -u www-data ojs php /var/www/html/lib/pkp/tools/installPluginVersion.php "plugins/generic/$NAME/version.xml" >/dev/null 2>&1

# Plugin enabled for the site; those in MD_DISABLE disabled
db "DELETE FROM plugin_settings WHERE plugin_name='mobiledashboardplugin'"
db "INSERT INTO plugin_settings (plugin_name,context_id,setting_name,setting_value,setting_type) VALUES ('mobiledashboardplugin',NULL,'enabled','1','bool')"
for p in $DISABLE; do db "UPDATE plugin_settings SET setting_value='0' WHERE plugin_name='$p' AND setting_name='enabled'"; done
clear_cache

# Sign in as administrator. The password comes from MD_ADMIN_PASSWORD
# or from import-locale.ps1 in the Docker copy's folder; it is never printed.
CJ=$(mktemp); command -v cygpath >/dev/null && CJ=$(cygpath -m "$CJ")
ADMIN=${MD_ADMIN:-$(db "SELECT u.username FROM users u JOIN user_user_groups uug ON uug.user_id=u.user_id JOIN user_groups g ON g.user_group_id=uug.user_group_id WHERE g.role_id=1 AND g.context_id IS NULL LIMIT 1")}
PW=${MD_ADMIN_PASSWORD:-$( [ -f "$LOCALE/import-locale.ps1" ] && grep -m1 'AdminPassword = ' "$LOCALE/import-locale.ps1" | sed -E "s/.*= *['\"]([^'\"]*)['\"].*/\1/")}
LT=$(curl -s -c "$CJ" -b "$CJ" "$B/index/login" | grep -o 'name="csrfToken" value="[^"]*' | cut -d'"' -f4)
curl -s -c "$CJ" -b "$CJ" -o /dev/null --data-urlencode "csrfToken=$LT" --data-urlencode "username=$ADMIN" --data-urlencode "password=$PW" "$B/index/login/signIn"
unset PW
export MD_SID=$(awk '$6=="OJSESSION"{print $7}' "$CJ")
# Runs one browser.mjs group; LAST keeps its result lines
run_browser() {
  LAST=$(node "$(winpath "$HERE/browser.mjs")" "$1" "$(winpath "$OUT")" 2>&1); local rc=$?
  echo "$LAST" >> "$OUT/browser.log"
  echo "$LAST" | grep '^  ok\|^  FAILED'
  PASS=$((PASS+$(echo "$LAST" | grep -c '^  ok')))
  local f; while IFS= read -r f; do FAIL=$((FAIL+1)); FAILED+=("${f#  FAILED }"); done < <(echo "$LAST" | grep '^  FAILED')
  if [ $rc != 0 ] && ! echo "$LAST" | grep -q '^  FAILED'; then
    ko "browser group \"$1\" did not start" "$(echo "$LAST" | grep -m1 -i 'error' | head -c 200)"
  fi
}
check "signed in as administrator on the local copy" '[ -n "$MD_SID" ] && curl -sL -b "$CJ" "$B/$MD_JOURNAL/dashboard/editorial" | grep -q "app__main\|pkp_structure_main"'

# ---------------------------------------------------------------- static
if want static; then
  echo; echo "## File checks"
  T=$(mktemp -d)
  rel=$(grep -o '<release>[^<]*' "$SRC/version.xml" | cut -d'>' -f2)
  cls=$(grep -o '<class>[^<]*' "$SRC/version.xml" | cut -d'>' -f2)
  app=$(grep -o '<application>[^<]*' "$SRC/version.xml" | cut -d'>' -f2)
  check "version $rel in OJS format (a.b.c.d)" '[[ "$rel" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]'
  check "plugin name $app matches the folder ($NAME)" '[ "$app" = "$NAME" ]'
  check "class $cls exists" '[ -f "$SRC/$cls.php" ] && grep -q "class $cls " "$SRC/$cls.php"'
  bad=$(dc exec -T ojs sh -c "cd /var/www/html/plugins/generic/$NAME && for f in \$(find . -name '*.php'); do php -l \$f >/dev/null 2>&1 || echo \$f; done")
  check "PHP has no syntax errors" '[ -z "$bad" ]' "$bad"
  for js in "$SRC"/styles/*.js; do
    check "$(basename "$js") has no syntax errors" 'node --check "$(winpath "$js")" 2>/dev/null'
  done
  grep '^msgid "' "$SRC/locale/en/locale.po" | sort > "$T/en"; grep '^msgid "' "$SRC/locale/it/locale.po" | sort > "$T/it"
  check "same strings in English and Italian" 'cmp -s "$T/en" "$T/it"' "$(diff "$T/en" "$T/it" | tr '\n' ' ')"
  miss=$(grep -oh "__('plugins\.generic\.[^']*'" "$SRC"/*.php | cut -d"'" -f2 | sort -u | while read -r k; do grep -q "^msgid \"$k\"" "$SRC/locale/en/locale.po" || echo "$k"; done)
  check "every string used in the PHP is translated" '[ -z "$miss" ]' "$miss"
  cssbad=$(node "$(winpath "$HERE/css-check.mjs")" "$(winpath "$SRC/styles/mobile.css")")
  check "the CSS only changes things below 900 px" '[ -z "$cssbad" ]' "$cssbad"
  c=$(curl -sL -b "$CJ" "$B/$MD_JOURNAL/dashboard/editorial" | grep -c "$NAME/styles/mobile")
  check "plugin enabled: its files are loaded" '[ "$c" -ge 1 ]' "$c"
  db "UPDATE plugin_settings SET setting_value='0' WHERE plugin_name='mobiledashboardplugin' AND setting_name='enabled'"; clear_cache
  c=$(curl -sL -b "$CJ" "$B/$MD_JOURNAL/dashboard/editorial" | grep -c "$NAME/styles/mobile")
  check "plugin disabled: its files are not loaded" '[ "$c" = 0 ]' "$c"
  db "UPDATE plugin_settings SET setting_value='1' WHERE plugin_name='mobiledashboardplugin' AND setting_name='enabled'"; clear_cache
  rm -rf "$T"
fi

# ---------------------------------------------------------------- browser
if want phone; then
  echo; echo "## Phone (390×844)"
  run_browser phone
fi
if want desktop; then
  echo; echo "## Desktop (1300 px): identical with and without the plugin"
  run_browser desktop
fi

rm -f "$CJ"
echo
echo "Screenshots in $(winpath "$OUT") (placeholder data; look at them before publishing)"
if [ $FAIL = 0 ]; then
  echo "RESULT: all $PASS tests passed"
else
  echo "RESULT: $FAIL of $((PASS+FAIL)) tests failed:"; printf '  - %s\n' "${FAILED[@]}"
fi
[ $FAIL = 0 ]
