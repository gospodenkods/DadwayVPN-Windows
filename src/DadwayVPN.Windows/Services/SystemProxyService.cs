using Microsoft.Win32;
using System.Runtime.InteropServices;
namespace DadwayVPN.Windows.Services;
public static class SystemProxyService
{
    [DllImport("wininet.dll", SetLastError=true)] private static extern bool InternetSetOption(IntPtr h, int option, IntPtr buffer, int length);
    public static void Enable(int port)
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings", true)!;
        key.SetValue("ProxyEnable", 1); key.SetValue("ProxyServer", $"http=127.0.0.1:{port};https=127.0.0.1:{port}");
        key.SetValue("ProxyOverride", "<local>;*.ru;*.by;*.su"); Refresh();
    }
    public static void Disable()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings", true)!;
        key.SetValue("ProxyEnable", 0); Refresh();
    }
    private static void Refresh() { InternetSetOption(IntPtr.Zero,39,IntPtr.Zero,0); InternetSetOption(IntPtr.Zero,37,IntPtr.Zero,0); }
}
