import itertools
import json
import os
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

CHALLTESTSRV = os.environ.get("CHALLTESTSRV", "http://challtestsrv:8055")
ZONES = {name: f"zone-{name}" for name in os.environ.get("ZONES", "novium.test").split(",")}
PREFIX = "/client/v4"

records = {}
ids = itertools.count(1)


def challtestsrv(path, payload):
    request = urllib.request.Request(
        f"{CHALLTESTSRV}{path}",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(request, timeout=5).read()


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def route(self):
        url = urlparse(self.path)
        if not url.path.startswith(PREFIX):
            return None, None
        return url, url.path[len(PREFIX):].strip("/").split("/")

    def do_GET(self):
        url, parts = self.route()
        if parts == ["zones"]:
            name = parse_qs(url.query).get("name", [""])[0]
            zone = ZONES.get(name)
            self.reply(200, {"success": True, "result": [{"id": zone}] if zone else []})
            return
        self.reply(404, {"success": False})

    def do_POST(self):
        _, parts = self.route()
        if parts and len(parts) == 3 and parts[0] == "zones" and parts[2] == "dns_records":
            length = int(self.headers.get("content-length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
            record_id = f"record-{next(ids)}"
            records[record_id] = payload
            if payload.get("type") == "TXT":
                challtestsrv("/set-txt", {"host": payload["name"] + ".", "value": payload["content"]})
            print(f"created {payload.get('type')} {payload.get('name')} as {record_id}", flush=True)
            self.reply(200, {"success": True, "result": {"id": record_id}})
            return
        self.reply(404, {"success": False})

    def do_DELETE(self):
        _, parts = self.route()
        if parts and len(parts) == 4 and parts[0] == "zones" and parts[2] == "dns_records":
            payload = records.pop(parts[3], None)
            if payload and payload.get("type") == "TXT":
                challtestsrv("/clear-txt", {"host": payload["name"] + "."})
            print(f"deleted {parts[3]}", flush=True)
            self.reply(200, {"success": True, "result": {"id": parts[3]}})
            return
        self.reply(404, {"success": False})

    def log_message(self, format, *args):
        pass


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
