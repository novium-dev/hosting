ARG BUNGEECORD_BUILD

RUN wget "https://hub.spigotmc.org/jenkins/job/BungeeCord/$BUNGEECORD_BUILD/artifact/bootstrap/target/BungeeCord.jar" \
    --output-document /server.jar
