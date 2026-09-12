FROM python:{PYTHON_VERSION}

RUN rm -rf /tmp /var/tmp
RUN ln -s /work/.tmp /tmp
RUN ln -s /work/.tmp /var/tmp

# The daemon starts the server as this uid and mounts the storage at /work. Without a
# matching entry the uid resolves to no user at all and everything that looks up the home
# directory falls back to /, which is read-only. A base image user holding the uid is
# removed first, a base image group holding the gid is reused.
ARG CONTAINER_UID=25335
ARG CONTAINER_GID=25335
RUN set -eu; \
    existing_user="$(getent passwd "${CONTAINER_UID}" | cut -d: -f1)"; \
    [ -z "${existing_user}" ] || deluser "${existing_user}"; \
    getent group "${CONTAINER_GID}" >/dev/null || addgroup --gid "${CONTAINER_GID}" container; \
    adduser --uid "${CONTAINER_UID}" --gid "${CONTAINER_GID}" --home /work --shell /bin/sh --no-create-home --disabled-password --gecos "" container

WORKDIR /work

RUN python -m venv --system-site-packages /venv && rm -rf /venv/lib/*/site-packages && ln -s /work/site-packages /venv/lib/* && mv /venv/bin /venv/_bin && ln -s /work/site-packages/bin /venv/bin

ENV PATH="/work/site-packages/bin:$PATH"

STOPSIGNAL SIGINT

ENTRYPOINT ["/bin/bash", "-c", "(test -z \"$REPOSITORY_URL\" || (git init -q && GIT_TERMINAL_PROMPT=0 git -c credential.helper='!f() { test -n \"$REPOSITORY_PASSWORD\" && { echo \"username=${REPOSITORY_USERNAME:-oauth2}\"; echo \"password=$REPOSITORY_PASSWORD\"; }; }; f' fetch $REPOSITORY_URL $REPOSITORY_BRANCH && git checkout -q FETCH_HEAD)) && mkdir -p site-packages/bin && pushd site-packages > /dev/null && rm -rf pip pip-* && ln -sf $(realpath /usr/local/lib/*/site-packages/pip) && ln -sf $(realpath /usr/local/lib/*/site-packages/pip-*) && pushd bin > /dev/null && for i in /venv/_bin/*; do ln -sf \"$i\"; done && popd > /dev/null && popd > /dev/null && source /venv/bin/activate && { test -z \"$ENV_FILE\" || test ! -f \"./$ENV_FILE\" || { _novium_env=$(export -p); set -a; . \"./$ENV_FILE\"; set +a; eval \"$_novium_env\" > /dev/null 2>&1; unset _novium_env; }; } && eval \"$STARTUP_COMMAND\""]