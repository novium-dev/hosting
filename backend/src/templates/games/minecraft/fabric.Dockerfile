ARG MINECRAFT_VERSION
ARG LOADER_VERSION

RUN wget "https://meta.fabricmc.net/v2/versions/installer" --output-document /installer.json
RUN wget "$(jq -r ".[0].url" /installer.json)" --output-document /installer.jar
RUN cd / && java -jar /installer.jar server -mcversion "$MINECRAFT_VERSION" -loader "$LOADER_VERSION" -downloadMinecraft

RUN rm -f /installer.json /installer.jar

ENTRYPOINT ["java", "-Dfabric.gameJarPath=/server.jar", "-Dterminal.ansi=true", "-Djava.net.preferIPv6Addresses=system", "-XX:MaxRAMPercentage=95.0", "-jar", "/fabric-server-launch.jar"]
