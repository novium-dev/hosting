ARG MINECRAFT_VERSION
ARG PURPUR_BUILD

RUN wget "https://api.purpurmc.org/v2/purpur/$MINECRAFT_VERSION/$PURPUR_BUILD/download" --output-document /server.jar
