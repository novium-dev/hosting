ARG JAVA
FROM eclipse-temurin:${JAVA}-jre AS jre

FROM {BASE}
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"
COPY --from=jre /opt/java/openjdk /opt/java/openjdk
