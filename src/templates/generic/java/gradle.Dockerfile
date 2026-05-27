
ENV GRADLE_USER_HOME=/work/.gradle/.gradle_user_home

ENTRYPOINT ["/bin/sh", "-c", "(test -z \"$REPOSITORY_URL\" || (git init -q && git fetch $REPOSITORY_URL $REPOSITORY_BRANCH && git checkout -q FETCH_HEAD)) && /bin/sh ./gradlew run"]