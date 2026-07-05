ARG MINECRAFT_VERSION
ARG PURPUR_BUILD

RUN wget "https://api.purpurmc.org/v2/purpur/$MINECRAFT_VERSION/$PURPUR_BUILD/download" --output-document /server.jar

ENTRYPOINT ["java", "--add-modules=jdk.incubator.vector", "-Dterminal.ansi=true", "-Djava.net.preferIPv6Addresses=system", "-XX:MaxRAMPercentage=95.0", "-jar", "/server.jar"]
