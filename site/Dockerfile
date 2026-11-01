FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html styles.css app.js config.js /srv/
COPY public /srv/public
EXPOSE 8000
