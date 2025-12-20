ARG MINECRAFT_VERSION
ARG PAPER_BUILD

RUN wget "https://api.papermc.io/v2/projects/paper/versions/$MINECRAFT_VERSION/builds/$PAPER_BUILD/downloads/paper-$MINECRAFT_VERSION-$PAPER_BUILD.jar" --output-document /server.jar
