ARG MINECRAFT_VERSION

RUN wget https://piston-meta.mojang.com/mc/game/version_manifest_v2.json --output-document /version_manifest_v2.json
RUN wget "$(jq -r ".versions[] | select(.id == \"$MINECRAFT_VERSION\").url" /version_manifest_v2.json)" --output-document /version.json
RUN wget "$(jq -r '.downloads.server.url' /version.json)" --output-document /server.jar
RUN rm -f /version_manifest_v2.json /version.json
