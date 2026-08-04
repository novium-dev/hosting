RUN apk add --no-cache curl

RUN echo #!/bin/sh > /restart.sh
RUN echo curl --unix-socket /control.sock http://localhost/mark_restart >> /restart.sh
RUN chmod +x /restart.sh
