import base64, json, os, signal, subprocess, tempfile, threading, time, urllib.request
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

from .config import HTTP_PORT, SOCKS_PORT

class XrayManager:
    def __init__(self, log):
        self.log = log
        self.proc = None
        self.config_path = None
        self.started_at = None
        self.previous_proxy_mode = None

    def _decode_subscription(self, raw: bytes) -> list[str]:
        text = raw.decode("utf-8", errors="replace").strip()
        if text.startswith(("vless://", "vmess://")):
            return [x.strip() for x in text.splitlines() if x.strip()]
        try:
            padded = text + "=" * (-len(text) % 4)
            decoded = base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")
            return [x.strip() for x in decoded.splitlines() if x.strip()]
        except Exception:
            return [x.strip() for x in text.splitlines() if x.strip()]

    def load_subscription(self, url: str) -> list[str]:
        req = urllib.request.Request(url, headers={"User-Agent": "DadwayVPN-Linux/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return self._decode_subscription(r.read())

    def _vless_to_outbound(self, link: str) -> dict:
        u = urlparse(link)
        q = parse_qs(u.query)
        network = q.get("type", ["tcp"])[0]
        security = q.get("security", ["none"])[0]
        stream = {"network": network, "security": security}
        if network == "ws":
            stream["wsSettings"] = {"path": unquote(q.get("path", ["/"])[0]), "headers": {"Host": q.get("host", [u.hostname])[0]}}
        elif network == "xhttp":
            stream["xhttpSettings"] = {"path": unquote(q.get("path", ["/"])[0]), "host": q.get("host", [u.hostname])[0], "mode": q.get("mode", ["auto"])[0]}
        if security == "tls":
            stream["tlsSettings"] = {"serverName": q.get("sni", [u.hostname])[0], "allowInsecure": False, "fingerprint": q.get("fp", ["chrome"])[0]}
        elif security == "reality":
            stream["realitySettings"] = {"serverName": q.get("sni", [u.hostname])[0], "fingerprint": q.get("fp", ["chrome"])[0], "publicKey": q.get("pbk", [""])[0], "shortId": q.get("sid", [""])[0], "spiderX": q.get("spx", [""])[0]}
        user = {"id": u.username, "encryption": q.get("encryption", ["none"])[0]}
        if q.get("flow", [""])[0]: user["flow"] = q["flow"][0]
        return {"protocol": "vless", "settings": {"vnext": [{"address": u.hostname, "port": u.port or 443, "users": [user]}]}, "streamSettings": stream, "tag": "proxy"}

    def build_config(self, link: str) -> dict:
        if not link.startswith("vless://"):
            raise ValueError("Сейчас поддерживаются VLESS-ссылки подписки")
        outbound = self._vless_to_outbound(link)
        return {
            "log": {"loglevel": "warning"},
            "inbounds": [
                {"listen":"127.0.0.1","port":SOCKS_PORT,"protocol":"socks","settings":{"udp":True},"tag":"socks-in"},
                {"listen":"127.0.0.1","port":HTTP_PORT,"protocol":"http","settings":{},"tag":"http-in"}
            ],
            "outbounds": [outbound, {"protocol":"freedom","tag":"direct"}, {"protocol":"blackhole","tag":"block"}],
            "routing": {"domainStrategy":"IPIfNonMatch","rules":[
                {"type":"field","ip":["geoip:private"],"outboundTag":"direct"},
                {"type":"field","protocol":["bittorrent"],"outboundTag":"block"}
            ]}
        }

    def find_xray(self) -> str:
        for p in ("/usr/local/bin/xray", "/usr/bin/xray", str(Path.home()/".local/share/dadway-vpn/xray")):
            if os.path.isfile(p) and os.access(p, os.X_OK): return p
        raise FileNotFoundError("Xray Core не найден. Запустите install.sh")

    def set_system_proxy(self, enabled: bool):
        if not shutil_which("gsettings"):
            self.log("gsettings не найден: системный proxy не изменён")
            return
        if enabled:
            subprocess.run(["gsettings","set","org.gnome.system.proxy","mode","manual"], check=False)
            for proto, port in (("http",HTTP_PORT),("https",HTTP_PORT),("socks",SOCKS_PORT)):
                subprocess.run(["gsettings","set",f"org.gnome.system.proxy.{proto}","host","127.0.0.1"], check=False)
                subprocess.run(["gsettings","set",f"org.gnome.system.proxy.{proto}","port",str(port)], check=False)
        else:
            subprocess.run(["gsettings","set","org.gnome.system.proxy","mode","none"], check=False)

    def start(self, link: str):
        self.stop()
        cfg = self.build_config(link)
        fd, path = tempfile.mkstemp(prefix="dadway-xray-", suffix=".json")
        os.close(fd); Path(path).write_text(json.dumps(cfg, ensure_ascii=False, indent=2))
        self.config_path = path
        xray = self.find_xray()
        self.proc = subprocess.Popen([xray,"run","-config",path], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self.started_at = time.time(); self.set_system_proxy(True)
        threading.Thread(target=self._pipe_logs, daemon=True).start()
        time.sleep(1)
        if self.proc.poll() is not None: raise RuntimeError("Xray завершился сразу после запуска")

    def _pipe_logs(self):
        if self.proc and self.proc.stdout:
            for line in self.proc.stdout: self.log(line.rstrip())

    def stop(self):
        self.set_system_proxy(False)
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try: self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired: self.proc.kill()
        self.proc = None; self.started_at = None
        if self.config_path:
            try: os.unlink(self.config_path)
            except OSError: pass
            self.config_path = None

    def connected(self): return self.proc is not None and self.proc.poll() is None
    def duration(self): return int(time.time()-self.started_at) if self.started_at else 0

def shutil_which(name):
    import shutil
    return shutil.which(name)

def external_ip():
    with urllib.request.urlopen("https://api.ipify.org", timeout=10) as r: return r.read().decode().strip()
