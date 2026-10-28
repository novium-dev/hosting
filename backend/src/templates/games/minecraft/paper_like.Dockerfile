ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN echo #!/bin/sh > /restart.sh
RUN echo curl --unix-socket /control.sock http://localhost/mark_restart >> /restart.sh
RUN chmod +x /restart.sh
