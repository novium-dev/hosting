#!/usr/bin/python3 -I
import json
import socket
import sys

HEADER = b"\xff\xff\xff\xff"
QUERY = HEADER + b"TSource Engine Query\x00"


def read_string(data, offset):
    end = data.index(b"\x00", offset)
    return data[offset:end].decode("utf-8", "replace"), end + 1


def query(port):
    address = ("127.0.0.1", port)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(3)
        sock.sendto(QUERY, address)
        data, _ = sock.recvfrom(65535)
        if data[4:5] == b"A":
            sock.sendto(QUERY + data[5:9], address)
            data, _ = sock.recvfrom(65535)

    if data[:5] != HEADER + b"I":
        raise ValueError("unexpected A2S_INFO response")

    offset = 6
    name, offset = read_string(data, offset)
    map_name, offset = read_string(data, offset)
    _folder, offset = read_string(data, offset)
    _game, offset = read_string(data, offset)
    offset += 2
    online, max_players = data[offset], data[offset + 1]

    return {
        "players": {"online": online, "max": max_players},
        "name": name,
        "map": map_name,
    }


def main():
    try:
        info = query(int(sys.argv[1]))
    except (OSError, ValueError, IndexError):
        return 1
    print(json.dumps(info, separators=(",", ":")))
    return 0


sys.exit(main())
