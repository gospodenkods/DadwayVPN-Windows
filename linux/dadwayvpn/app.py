#!/usr/bin/env python3
import gi, threading, time
from pathlib import Path

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GLib, Gdk
from .config import APP_NAME, VERSION, SUBSCRIPTIONS
from .core import XrayManager, external_ip

CSS = b'''
window { background: #15171c; color: #f4f4f4; }
.title { font-size: 26px; font-weight: 700; }
.status { font-size: 18px; font-weight: 600; }
.card { background: #23262e; border-radius: 16px; padding: 18px; }
.connect { background-image: none; background-color: #f4b400; color: #151515; border-radius: 14px; font-weight: 700; padding: 14px; }
.disconnect { background-image: none; background-color: #d93025; color: white; border-radius: 14px; font-weight: 700; padding: 14px; }
'''

class Window(Gtk.Window):
    def __init__(self):
        super().__init__(title=f"{APP_NAME} {VERSION}")
        self.set_default_size(540, 650); self.set_border_width(20)
        self.manager = XrayManager(self.log)
        self.links = []
        root = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=14); self.add(root)
        title = Gtk.Label(label="DADWAY VPN"); title.get_style_context().add_class("title"); root.pack_start(title, False, False, 4)
        self.status = Gtk.Label(label="Отключено"); self.status.get_style_context().add_class("status"); root.pack_start(self.status, False, False, 4)
        self.server = Gtk.ComboBoxText()
        for name in SUBSCRIPTIONS: self.server.append_text(name)
        self.server.set_active(0); root.pack_start(self.server, False, False, 0)
        self.button = Gtk.Button(label="ПОДКЛЮЧИТЬ"); self.button.get_style_context().add_class("connect"); self.button.connect("clicked", self.toggle); root.pack_start(self.button, False, False, 0)
        grid = Gtk.Grid(column_spacing=12,row_spacing=8); root.pack_start(grid,False,False,4)
        self.ip=Gtk.Label(label="Внешний IP: —",xalign=0); self.timer=Gtk.Label(label="Сессия: 00:00:00",xalign=0)
        grid.attach(self.ip,0,0,1,1); grid.attach(self.timer,0,1,1,1)
        self.logview=Gtk.TextView(); self.logview.set_editable(False); self.logview.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        scroll=Gtk.ScrolledWindow(); scroll.set_vexpand(True); scroll.add(self.logview); root.pack_start(scroll,True,True,0)
        self.connect("destroy", self.on_destroy)
        GLib.timeout_add_seconds(1,self.tick)

    def log(self,text):
        GLib.idle_add(self._append,text)
    def _append(self,text):
        b=self.logview.get_buffer(); b.insert(b.get_end_iter(), text+"\n"); return False
    def toggle(self,*_):
        if self.manager.connected(): self.disconnect_vpn(); return
        name=self.server.get_active_text(); url=SUBSCRIPTIONS[name]
        self.status.set_text("Загрузка подписки…"); self.button.set_sensitive(False)
        threading.Thread(target=self._connect_worker,args=(name,url),daemon=True).start()
    def _connect_worker(self,name,url):
        try:
            links=self.manager.load_subscription(url)
            vless=next((x for x in links if x.startswith("vless://")),None)
            if not vless: raise RuntimeError("В подписке нет VLESS-конфигурации")
            self.manager.start(vless); GLib.idle_add(self._connected,name)
            try: ip=external_ip(); GLib.idle_add(self.ip.set_text,f"Внешний IP: {ip}")
            except Exception as e: self.log(f"IP check: {e}")
        except Exception as e: GLib.idle_add(self._failed,str(e))
    def _connected(self,name):
        self.status.set_text(f"Подключено: {name}"); self.button.set_label("ОТКЛЮЧИТЬ")
        self.button.get_style_context().remove_class("connect"); self.button.get_style_context().add_class("disconnect"); self.button.set_sensitive(True); return False
    def _failed(self,msg):
        self.status.set_text("Ошибка подключения"); self.log("ОШИБКА: "+msg); self.button.set_sensitive(True); return False
    def disconnect_vpn(self):
        self.manager.stop(); self.status.set_text("Отключено"); self.ip.set_text("Внешний IP: —"); self.button.set_label("ПОДКЛЮЧИТЬ")
        self.button.get_style_context().remove_class("disconnect"); self.button.get_style_context().add_class("connect")
    def tick(self):
        s=self.manager.duration(); self.timer.set_text(f"Сессия: {s//3600:02d}:{s%3600//60:02d}:{s%60:02d}")
        if self.manager.proc and not self.manager.connected(): self._failed("Xray Core остановлен")
        return True
    def on_destroy(self,*_): self.manager.stop(); Gtk.main_quit()

def main():
    provider=Gtk.CssProvider(); provider.load_from_data(CSS); Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(),provider,Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    w=Window(); w.show_all(); Gtk.main()
if __name__=="__main__": main()
