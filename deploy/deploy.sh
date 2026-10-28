#!/usr/bin/env bash
# Deploys one commit of collabitat-api on the server. Runs on the server, piped over SSH by CI:
#   ssh deploy@<host> 'bash -s' -- <commit> <api-domain> <web-origins> < deploy/deploy.sh
set -euo pipefail

POSTGRES_PASSWORD_BYTES=24

commit="${1:?Usage: deploy.sh <commit> <api-domain> <web-origins>}"
export API_DOMAIN="${2:?api domain missing}"
export WEB_ORIGINS="${3:?web origins missing}"
app_dir="${APP_DIR:-$HOME/collabitat-api}"
repo_url="${REPO_URL:-https://github.com/fly-die/collabitat-api.git}"

if [[ ! -d "$app_dir/.git" ]]; then
  git clone --quiet "$repo_url" "$app_dir"
fi
cd "$app_dir"
git fetch --quiet origin "$commit"
git checkout --quiet --force --detach FETCH_HEAD
cd deploy

# The database password is created once on the server and never leaves it.
if [[ ! -f .env ]]; then
  (umask 077 && printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex "$POSTGRES_PASSWORD_BYTES")" > .env)
fi

docker compose up --detach --build --remove-orphans --wait
docker image prune --force > /dev/null
echo "Deployed $(git rev-parse --short HEAD) to https://$API_DOMAIN"
