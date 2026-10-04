#!/bin/sh
set -eu

# The browser calls the API directly (not through nginx), using the same
# host it loaded the page from plus the API's host-published port. That
# port varies per stack (API_PORT in .env), so it can't be baked into
# index.html at image-build time — it has to be written at container
# start, from whatever API_PORT this particular stack's compose file
# passed in. Without this, the client fell back to a hardcoded :4000,
# which broke as soon as a second stack used a different API_PORT.
cat > /usr/share/nginx/html/config.js <<EOF
window.__API_PORT__ = "${API_PORT:-4000}";
EOF

exec nginx -g 'daemon off;'
