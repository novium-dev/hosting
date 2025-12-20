ARG MINECRAFT_VERSION
ARG LOADER_VERSION

# install
RUN mkdir /work/.tmp -p
RUN mkdir /install

RUN wget "https://maven.minecraftforge.net/net/minecraftforge/forge/$MINECRAFT_VERSION-$LOADER_VERSION/forge-$MINECRAFT_VERSION-$LOADER_VERSION-installer.jar" --output-document /installer.jar
RUN java -jar /installer.jar --installServer /install

# Clean up
RUN mv /install/libraries /libraries
RUN mv /install/*.jar /
RUN mv /forge-*.jar /server.jar
RUN rm /install /installer.jar -rf
