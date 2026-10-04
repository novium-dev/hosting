#!/bin/bash
set -euo pipefail

cd /work

runtime=/work/.tmp/web
port="${NOVIUM_PORT_HTTP:-8080}"
document_root="/work/${WEB_ROOT:-public}"

mkdir -p "$runtime" "$document_root" "$WEB_SERVER/conf.d" php

if [[ -n "${REPOSITORY_URL:-}" ]]; then
  git init -q
  GIT_TERMINAL_PROMPT=0 git -c credential.helper='!f() { test -n "$REPOSITORY_PASSWORD" && { echo "username=${REPOSITORY_USERNAME:-oauth2}"; echo "password=$REPOSITORY_PASSWORD"; }; }; f' fetch "$REPOSITORY_URL" "$REPOSITORY_BRANCH"
  git checkout -q FETCH_HEAD
fi

if [[ -n "${ENV_FILE:-}" && -f "./$ENV_FILE" ]]; then
  _novium_env=$(export -p)
  set -a
  . "./$ENV_FILE"
  set +a
  eval "$_novium_env" > /dev/null 2>&1
  unset _novium_env
fi

php_enabled=0
if command -v php-fpm > /dev/null; then
  php_enabled=1
fi

if [[ "$php_enabled" == "1" ]]; then
  if [[ "${COMPOSER_INSTALL:-0}" == "1" && -f composer.json ]]; then
    echo "### Installing composer dependencies..."
    composer install --no-interaction --no-progress --no-dev --prefer-dist --optimize-autoloader
  fi

  cat > "$runtime/php-fpm.conf" <<EOF
[global]
pid = $runtime/php-fpm.pid
error_log = /proc/self/fd/2
log_limit = 8192
daemonize = no

[www]
listen = 127.0.0.1:9000
pm = dynamic
pm.max_children = ${PHP_FPM_MAX_CHILDREN:-10}
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3
clear_env = no
catch_workers_output = yes
decorate_workers_output = no
EOF

  echo "### Starting PHP-FPM..."
  php-fpm -F -y "$runtime/php-fpm.conf" &
fi

case "$WEB_SERVER" in
  nginx)
    mkdir -p "$runtime/client_body" "$runtime/proxy" "$runtime/fastcgi" "$runtime/uwsgi" "$runtime/scgi"

    if [[ "$php_enabled" == "1" ]]; then
      index="index.php index.html index.htm"
      fallback="/index.php?\$query_string"
      php_location="location ~ \\.php\$ {
            try_files \$uri =404;
            fastcgi_split_path_info ^(.+\\.php)(/.+)\$;
            fastcgi_pass 127.0.0.1:9000;
            fastcgi_index index.php;
            include /etc/nginx/fastcgi_params;
            fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
            fastcgi_param PATH_INFO \$fastcgi_path_info;
        }"
    else
      index="index.html index.htm"
      fallback="=404"
      php_location=""
    fi

    cat > "$runtime/nginx.conf" <<EOF
worker_processes auto;
pid $runtime/nginx.pid;
error_log /dev/stderr warn;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    access_log off;
    sendfile on;
    tcp_nopush on;
    server_tokens off;
    keepalive_timeout 65;
    client_max_body_size 100m;

    client_body_temp_path $runtime/client_body;
    proxy_temp_path $runtime/proxy;
    fastcgi_temp_path $runtime/fastcgi;
    uwsgi_temp_path $runtime/uwsgi;
    scgi_temp_path $runtime/scgi;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;

    server {
        listen $port;
        listen [::]:$port;

        root $document_root;
        index $index;

        location / {
            try_files \$uri \$uri/ $fallback;
        }

        $php_location

        location ~ /\\.(?!well-known) {
            deny all;
        }

        include /work/nginx/conf.d/*.conf;
    }
}
EOF

    echo "### Starting nginx on port $port, serving $document_root..."
    exec nginx -e /dev/stderr -c "$runtime/nginx.conf" -g "daemon off;"
    ;;
  apache2)
    if [[ "$php_enabled" == "1" ]]; then
      index="index.php index.html index.htm"
      php_handler="<FilesMatch \"\\.php\$\">
    SetHandler \"proxy:fcgi://127.0.0.1:9000\"
</FilesMatch>"
    else
      index="index.html index.htm"
      php_handler=""
    fi

    cat > "$runtime/apache2.conf" <<EOF
ServerRoot "/etc/apache2"
ServerName localhost
ServerTokens Prod
ServerSignature Off
PidFile $runtime/apache2.pid
DefaultRuntimeDir $runtime
Mutex file:$runtime default
Timeout 300
KeepAlive On

LoadModule mpm_event_module /usr/lib/apache2/modules/mod_mpm_event.so
LoadModule authz_core_module /usr/lib/apache2/modules/mod_authz_core.so
LoadModule authz_host_module /usr/lib/apache2/modules/mod_authz_host.so
LoadModule authn_core_module /usr/lib/apache2/modules/mod_authn_core.so
LoadModule access_compat_module /usr/lib/apache2/modules/mod_access_compat.so
LoadModule alias_module /usr/lib/apache2/modules/mod_alias.so
LoadModule dir_module /usr/lib/apache2/modules/mod_dir.so
LoadModule env_module /usr/lib/apache2/modules/mod_env.so
LoadModule expires_module /usr/lib/apache2/modules/mod_expires.so
LoadModule filter_module /usr/lib/apache2/modules/mod_filter.so
LoadModule deflate_module /usr/lib/apache2/modules/mod_deflate.so
LoadModule headers_module /usr/lib/apache2/modules/mod_headers.so
LoadModule mime_module /usr/lib/apache2/modules/mod_mime.so
LoadModule negotiation_module /usr/lib/apache2/modules/mod_negotiation.so
LoadModule rewrite_module /usr/lib/apache2/modules/mod_rewrite.so
LoadModule setenvif_module /usr/lib/apache2/modules/mod_setenvif.so
LoadModule proxy_module /usr/lib/apache2/modules/mod_proxy.so
LoadModule proxy_fcgi_module /usr/lib/apache2/modules/mod_proxy_fcgi.so

Listen $port

ErrorLog /dev/stderr
LogLevel warn

TypesConfig /etc/mime.types
AddDefaultCharset UTF-8
AddOutputFilterByType DEFLATE text/plain text/css text/html application/json application/javascript text/xml application/xml image/svg+xml

DocumentRoot "$document_root"
DirectoryIndex $index

<Directory />
    Options FollowSymLinks
    AllowOverride None
    Require all denied
</Directory>

<Directory "$document_root">
    Options FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>

<FilesMatch "^\\.ht">
    Require all denied
</FilesMatch>

$php_handler

IncludeOptional /work/apache2/conf.d/*.conf
EOF

    echo "### Starting Apache on port $port, serving $document_root..."
    exec apache2 -f "$runtime/apache2.conf" -DFOREGROUND
    ;;
  *)
    echo "### Unknown web server: $WEB_SERVER" >&2
    exit 1
    ;;
esac
