FROM rust:{RUST_VERSION}

RUN rm -rf /tmp /var/tmp
RUN ln -s /work/.tmp /tmp
RUN ln -s /work/.tmp /var/tmp

WORKDIR /work

STOPSIGNAL SIGINT

ENTRYPOINT ["/bin/sh", "-c", "(test -z \"$REPOSITORY_URL\" || (git init -q && git fetch $REPOSITORY_URL $REPOSITORY_BRANCH && git checkout -q FETCH_HEAD)) && cargo run --release --locked"]
