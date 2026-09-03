ARG MINECRAFT_VERSION
ARG LOADER_VERSION

RUN wget "https://meta.quiltmc.org/v3/versions/installer" --output-document /installer.json
RUN wget "$(jq -r ".[0].url" /installer.json)" --output-document /installer.jar
RUN cd / && java -jar /installer.jar install server "$MINECRAFT_VERSION" "$LOADER_VERSION" --install-dir=/ --download-server

RUN rm -f /installer.json /installer.jar
