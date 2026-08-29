ARG VELOCITY_VERSION
ARG VELOCITY_BUILD

RUN curl -s "https://fill.papermc.io/v3/projects/velocity/versions/$VELOCITY_VERSION/builds/$VELOCITY_BUILD" \
    | jq -r '.downloads["server:default"].url' \
    | xargs wget --output-document /server.jar
