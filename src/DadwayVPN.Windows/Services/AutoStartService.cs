using Microsoft.Win32;
namespace DadwayVPN.Windows.Services;
public static class AutoStartService
{
    public static void Set(bool enabled)
    {
        using var key=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run",true)!;
        if(enabled) key.SetValue("DadwayVPN",$"\"{Environment.ProcessPath}\" --minimized"); else key.DeleteValue("DadwayVPN",false);
    }
}
