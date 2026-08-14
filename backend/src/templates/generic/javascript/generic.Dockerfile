FROM node:{NODE_VERSION}

RUN rm -rf /tmp /var/tmp && \
    ln -s /work/.tmp /tmp && \
    ln -s /work/.tmp /var/tmp

WORKDIR /work

ENV PATH="/work/node_modules/.bin:$PATH"

STOPSIGNAL SIGINT
