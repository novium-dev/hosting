ARG MINECRAFT_VERSION
ARG LOADER_VERSION

# install
RUN mkdir /work/.tmp -p
RUN mkdir /install

RUN wget "https://maven.neoforged.net/releases/net/neoforged/neoforge/$LOADER_VERSION/neoforge-$LOADER_VERSION-installer.jar" --output-document /installer.jar
RUN java -jar /installer.jar --installServer /install

RUN sed 's/libraries/..\/libraries/g' /install/libraries/net/neoforged/neoforge/$LOADER_VERSION/unix_args.txt | xargs echo java -Dterminal.ansi=true -Djava.net.preferIPv6Addresses=system -XX:MaxRAMPercentage=95.0 > /run.sh

# Clean up
RUN mv /install/libraries /libraries
RUN rm /install -rf

ENTRYPOINT ["/bin/sh", "/run.sh"]
