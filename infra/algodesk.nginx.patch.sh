#!/bin/sh
set -e
cp /root/algodesk-security-snippet.conf /etc/nginx/snippets/algodesk-security.conf
if ! grep -q algodesk-security /etc/nginx/sites-available/algodesk; then
  sed -i '/client_max_body_size/a\    include /etc/nginx/snippets/algodesk-security.conf;' /etc/nginx/sites-available/algodesk
fi
nginx -t
systemctl reload nginx
