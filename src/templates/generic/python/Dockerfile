FROM python:{PYTHON_VERSION}

RUN rm -rf /tmp /var/tmp
RUN ln -s /work/.tmp /tmp
RUN ln -s /work/.tmp /var/tmp

WORKDIR /work

RUN python -m venv --system-site-packages /venv && rm -rf /venv/lib/*/site-packages && ln -s /work/site-packages /venv/lib/* && mv /venv/bin /venv/_bin && ln -s /work/site-packages/bin /venv/bin

ENV PATH="/work/site-packages/bin:$PATH"

STOPSIGNAL SIGINT

ENTRYPOINT ["/bin/bash", "-c", "(test -z \"$REPOSITORY_URL\" || (git init -q && git fetch $REPOSITORY_URL $REPOSITORY_BRANCH && git checkout -q FETCH_HEAD)) && mkdir -p site-packages/bin && pushd site-packages > /dev/null && rm -rf pip pip-* && ln -sf $(realpath /usr/local/lib/*/site-packages/pip) && ln -sf $(realpath /usr/local/lib/*/site-packages/pip-*) && pushd bin > /dev/null && for i in /venv/_bin/*; do ln -sf \"$i\"; done && popd > /dev/null && popd > /dev/null && source /venv/bin/activate && ((test ! -f requirements.txt) || pip --cache-dir=.pip install -r requirements.txt) && python $MAIN_FILE"]