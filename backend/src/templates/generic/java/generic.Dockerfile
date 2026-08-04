FROM eclipse-temurin:{JAVA_VERSION}-jdk

RUN rm -rf /tmp /var/tmp
RUN ln -s /work/.tmp /tmp
RUN ln -s /work/.tmp /var/tmp

WORKDIR /work

STOPSIGNAL SIGINT