FROM itzg/mc-monitor:0.15.0 as monitor

FROM alpine:latest

RUN apk update
RUN apk add --no-cache wget jq ca-certificates libudev-zero libstdc++ rcon
RUN update-ca-certificates

RUN rm -rf /tmp /var/tmp
RUN ln -s /work/.tmp /tmp
RUN ln -s /work/.tmp /var/tmp

COPY --from=monitor /mc-monitor /mc-monitor

WORKDIR /work
ENTRYPOINT ["java", "-Djava.net.preferIPv6Addresses=system", "-XX:MaxRAMPercentage=95.0", "-jar", "/server.jar"]
HEALTHCHECK --start-period=2m --retries=3 --interval=30s CMD /mc-monitor status -json
