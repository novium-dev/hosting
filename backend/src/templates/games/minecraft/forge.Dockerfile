ARG MINECRAFT_VERSION
ARG LOADER_VERSION

# install
RUN mkdir /work/.tmp -p
RUN mkdir /forge

# Older versions carry a Minecraft version suffix in their maven name
RUN set -eu; \
    wget "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml" --output-document /forge-metadata.xml; \
    escaped="$(printf '%s' "$MINECRAFT_VERSION-$LOADER_VERSION" | sed 's/\./\\./g')"; \
    full="$(grep -oE "<version>$escaped(-1\.[0-9.]+)?</version>" /forge-metadata.xml | sed -E 's#</?version>##g' | awk '{ print length, $0 }' | sort -n | head -n1 | cut -d' ' -f2)"; \
    [ -n "$full" ] || { echo "Forge $LOADER_VERSION for Minecraft $MINECRAFT_VERSION not found" >&2; exit 1; }; \
    wget "https://maven.minecraftforge.net/net/minecraftforge/forge/$full/forge-$full-installer.jar" --output-document /installer.jar; \
    echo "$full" > /forge/version

RUN cd /forge && java -jar /installer.jar --installServer /forge

# Newer versions start through a shim jar that only finds its libraries relative to the
# working directory, so its classpath is built here instead
RUN set -eu; \
    full="$(cat /forge/version)"; \
    java_args="-Dterminal.ansi=true -Djava.net.preferIPv6Addresses=system -XX:MaxRAMPercentage=95.0"; \
    args="/forge/libraries/net/minecraftforge/forge/$full/unix_args.txt"; \
    shim="$(ls /forge/forge-*-shim.jar 2>/dev/null | head -n1)"; \
    if [ -n "$shim" ]; then \
        props="$(unzip -p "$shim" bootstrap-shim.properties | tr -d '\r')"; \
        main="$(printf '%s\n' "$props" | sed -n 's/^Main-Class=//p')"; \
        extra="$(printf '%s\n' "$props" | sed -n 's/^Arguments=//p')"; \
        manifest_cp="$(unzip -p "$shim" META-INF/MANIFEST.MF | tr -d '\r' | sed -e ':a' -e 'N' -e '$!ba' -e 's/\n //g' | sed -n 's/^Class-Path: //p')"; \
        cp="$( { unzip -p "$shim" bootstrap-shim.list | tr -d '\r' | cut -f3 | sed 's#^#/forge/libraries/#'; printf '%s\n' $manifest_cp | sed 's#^#/forge/#'; } | awk 'NF && !seen[$0]++' | paste -sd: -)"; \
        [ -n "$main" ] && [ -n "$cp" ] || { echo "Unable to read the Forge shim" >&2; exit 1; }; \
        echo "exec java $java_args -cp $cp $main $extra nogui" > /run.sh; \
    elif [ -f "$args" ]; then \
        { sed 's#libraries#/forge/libraries#g' "$args" | xargs echo exec java $java_args; echo " nogui"; } | tr -d "\n" > /run.sh; \
    else \
        jar="$(ls /forge/forge-*.jar | grep -v installer | head -n1)"; \
        [ -n "$jar" ] || { echo "No Forge server jar found" >&2; exit 1; }; \
        echo "exec java $java_args -jar $jar nogui" > /run.sh; \
    fi; \
    cat /run.sh

# Clean up
RUN rm -f /installer.jar /forge-metadata.xml /forge/run.sh /forge/run.bat /forge/user_jvm_args.txt /forge/installer.jar.log

ENTRYPOINT ["/bin/sh", "/run.sh"]
