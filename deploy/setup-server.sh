#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server. Run as root:
#   ssh root@<host> 'bash -s' -- "<deploy public key>" < deploy/setup-server.sh
set -euo pipefail

DEPLOY_USER=deploy

deploy_public_key="${1:?Usage: setup-server.sh <deploy public key>}"
ssh_dir="/home/$DEPLOY_USER/.ssh"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 git ufw unattended-upgrades
systemctl enable --now docker

if ! id "$DEPLOY_USER" > /dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ssh_dir"
printf '%s\n' "$deploy_public_key" > "$ssh_dir/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$ssh_dir/authorized_keys"
chmod 600 "$ssh_dir/authorized_keys"

printf 'PasswordAuthentication no\n' > /etc/ssh/sshd_config.d/10-keys-only.conf
systemctl reload ssh

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443
ufw --force enable
echo "Server ready. CI can now deploy as $DEPLOY_USER."
