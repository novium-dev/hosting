FROM golang:{GO_VERSION}

RUN rm -rf /tmp /var/tmp
RUN ln -s /work/.tmp /tmp
RUN ln -s /work/.tmp /var/tmp

WORKDIR /work

ENV GOCACHE=/work/.gocache

STOPSIGNAL SIGINT

ENTRYPOINT ["/bin/sh", "-c", "(test -z \"$REPOSITORY_URL\" || (git init -q && git fetch $REPOSITORY_URL $REPOSITORY_BRANCH && git checkout -q FETCH_HEAD)) && rm -f .tmp/binary && go build -o .tmp/binary $GO_FILE && .tmp/binary"]