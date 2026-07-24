using Microsoft.Win32;
using System.Runtime.InteropServices;
namespace DadwayVPN.Windows.Services;
public sealed class SystemProxyService
{
    private const string KeyPath=@"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
    private object? _oldEnable; private object? _oldServer; private object? _oldOverride; private bool _captured;
    [DllImport("wininet.dll", SetLastError=true)] private static extern bool InternetSetOption(IntPtr h,int option,IntPtr buffer,int length);
    public void Enable(int port)
    {
        using var key=Registry.CurrentUser.OpenSubKey(KeyPath,true) ?? throw new InvalidOperationException("Не удалось открыть настройки системного прокси.");
        if(!_captured){_oldEnable=key.GetValue("ProxyEnable");_oldServer=key.GetValue("ProxyServer");_oldOverride=key.GetValue("ProxyOverride");_captured=true;}
        key.SetValue("ProxyEnable",1); key.SetValue("ProxyServer",$"http=127.0.0.1:{port};https=127.0.0.1:{port}"); key.SetValue("ProxyOverride","<local>;*.ru;*.by;*.su"); Refresh();
    }
    public void Restore()
    {
        using var key=Registry.CurrentUser.OpenSubKey(KeyPath,true); if(key is null)return;
        if(_captured){SetOrDelete(key,"ProxyEnable",_oldEnable);SetOrDelete(key,"ProxyServer",_oldServer);SetOrDelete(key,"ProxyOverride",_oldOverride);} else key.SetValue("ProxyEnable",0);
        Refresh(); _captured=false;
    }
    public void EngageProxyKillSwitch(){using var key=Registry.CurrentUser.OpenSubKey(KeyPath,true);if(key is null)return;key.SetValue("ProxyEnable",1);key.SetValue("ProxyServer","127.0.0.1:9");Refresh();}
    private static void SetOrDelete(RegistryKey k,string n,object? v){if(v is null)k.DeleteValue(n,false);else k.SetValue(n,v);}
    private static void Refresh(){InternetSetOption(IntPtr.Zero,39,IntPtr.Zero,0);InternetSetOption(IntPtr.Zero,37,IntPtr.Zero,0);}
}
