RUN printf '#!/bin/sh\ncurl --unix-socket /control.sock http://localhost/mark_restart\n' > /restart.sh \
    && chmod +x /restart.sh
