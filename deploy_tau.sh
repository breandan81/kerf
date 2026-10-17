#!/bin/bash
# Deploy the static site to https://kerf.bposhaughnessy.com
#   first time: ./deploy_tau.sh, then on tau:  sudo sh ~/install-kerf.sh
#   afterwards: ./deploy_tau.sh goes live directly (no sudo)
set -e
cd "$(dirname "$0")"
./build_web.sh
HOST=tau.bposhaughnessy.com
rsync -a --delete dist/ $HOST:kerf-site/
scp -q install-kerf.sh $HOST:install-kerf.sh
if ssh $HOST 'test -O /var/www/kerf'; then
  ssh $HOST 'rsync -a --delete ~/kerf-site/ /var/www/kerf/ && find /var/www/kerf -type d -exec chmod 755 {} + && find /var/www/kerf -type f -exec chmod 644 {} +'
  echo "live: https://kerf.bposhaughnessy.com/"
else
  echo "uploaded to ~/kerf-site on tau. First install (once):  ssh -t $HOST sudo sh ~/install-kerf.sh"
fi
