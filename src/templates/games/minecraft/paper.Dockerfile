ARG MINECRAFT_VERSION
ARG PAPER_BUILD

RUN curl -s "https://fill.papermc.io/v3/projects/paper/versions/$MINECRAFT_VERSION/builds/$PAPER_BUILD" \
    | jq -r '.downloads["server:default"].url' \
    | xargs wget --output-document /server.jar