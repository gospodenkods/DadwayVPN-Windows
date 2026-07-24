using DadwayVPN.Windows.Models;
using DadwayVPN.Windows.Services;
using Microsoft.Win32;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using Forms = System.Windows.Forms;
namespace DadwayVPN.Windows;
public partial class MainWindow : Window
{
    private readonly ServerProfile[] _profiles = [
        new("russia","Россия","🇷🇺","https://promo.dadway.ru/sub/tnt9ztgjgvizzclm"),
        new("usa","USA","🇺🇸","https://zpp.div3.ru:2096/sub/m315s5c3qc51hkoj"),
        new("netherlands","Netherlands","🇳🇱","http://mikrot.icu:2096/sub/hqx2y9f5rar310zd",true) ];
    private readonly SettingsService _settingsService = new(); private readonly AppSettings _settings;
    private readonly LogService _log = new(); private readonly SubscriptionService _subscriptions = new(); private readonly XrayCoreService _core;
    private readonly Forms.NotifyIcon _tray; private CancellationTokenSource? _cts; private bool _connected;
    public MainWindow()
    {
        InitializeComponent(); AppPaths.Ensure(); _settings=_settingsService.Load(); _core=new(_log); _log.LineAdded += x => Dispatcher.Invoke(()=> { LogBox.AppendText(x+Environment.NewLine); LogBox.ScrollToEnd(); });
        _tray=new Forms.NotifyIcon { Icon=new System.Drawing.Icon(Path.Combine(AppContext.BaseDirectory,"Assets","dadway.ico")), Text="Dadway VPN", Visible=true };
        var menu=new Forms.ContextMenuStrip(); menu.Items.Add("Открыть",null,(_,_)=>Dispatcher.Invoke(ShowWindow)); menu.Items.Add("Подключить / отключить",null,(_,_)=>Dispatcher.Invoke(async()=>await ToggleAsync())); menu.Items.Add("Выход",null,(_,_)=>Dispatcher.Invoke(async()=>await ExitAsync())); _tray.ContextMenuStrip=menu; _tray.DoubleClick += (_,_)=>Dispatcher.Invoke(ShowWindow);
        Closing += (_,e)=> { e.Cancel=true; Hide(); }; SelectProfile(_settings.SelectedProfileId); AutoStartCheck.IsChecked=_settings.AutoStart; SystemProxyCheck.IsChecked=_settings.EnableSystemProxy;
        _log.Write("Dadway VPN for Windows запущен.");
    }
    private void ShowWindow(){ Show(); WindowState=WindowState.Normal; Activate(); }
    private async void ConnectButton_Click(object s,RoutedEventArgs e)=>await ToggleAsync();
    private async Task ToggleAsync(){ if(_connected) await DisconnectAsync(); else await ConnectAsync(); }
    private async Task ConnectAsync()
    {
        try { ConnectButton.IsEnabled=false; StatusText.Text="Статус: Подключение..."; _cts=new(); var p=_profiles.First(x=>x.Id==_settings.SelectedProfileId); _log.Write($"Загрузка профиля {p.Title}...");
            var text=await _subscriptions.GetAsync(p.Id,p.SubscriptionUrl,_cts.Token); var link=SubscriptionService.FirstSupportedLink(text); var config=VlessConfigBuilder.Build(link); await _core.StartAsync(config,_cts.Token);
            if(SystemProxyCheck.IsChecked==true) SystemProxyService.Enable(10809); _connected=true; ConnectButton.BorderBrush=(System.Windows.Media.Brush)FindResource("Green"); StatusText.Text="Статус: Подключено"; _log.Write($"Подключено: {p.Title}"); await UpdateDiagnosticsAsync(); }
        catch(Exception ex){ _log.Write("ОШИБКА: "+ex.Message); StatusText.Text="Статус: Ошибка"; await DisconnectAsync(); }
        finally { ConnectButton.IsEnabled=true; }
    }
    private async Task DisconnectAsync(){ _cts?.Cancel(); SystemProxyService.Disable(); await _core.StopAsync(); _connected=false; ConnectButton.BorderBrush=(System.Windows.Media.Brush)FindResource("Yellow"); StatusText.Text="Статус: Отключено"; IpText.Text="—"; PingText.Text="— мс"; _log.Write("VPN отключён."); }
    private async Task UpdateDiagnosticsAsync(){ try { var d=await DiagnosticsService.TestAsync(CancellationToken.None); IpText.Text=d.ip; PingText.Text=$"{d.ping} мс"; _log.Write($"Проверка: IP={d.ip}, ping={d.ping} мс"); } catch(Exception ex){ _log.Write("Проверка IP не удалась: "+ex.Message); } }
    private async void Test_Click(object s,RoutedEventArgs e)=>await UpdateDiagnosticsAsync();
    private void Server_Click(object s,RoutedEventArgs e){ if(_connected) return; SelectProfile((string)((Button)s).Tag); }
    private void SelectProfile(string id){ _settings.SelectedProfileId=id; _settingsService.Save(_settings); var p=_profiles.First(x=>x.Id==id); ServerText.Text=p.Title; foreach(var b in new[]{RussiaButton,UsaButton,NetherlandsButton}) b.BorderBrush=(System.Windows.Media.Brush)new System.Windows.Media.BrushConverter().ConvertFrom("#354150")!; ((Button)(id=="russia"?RussiaButton:id=="usa"?UsaButton:NetherlandsButton)).BorderBrush=(System.Windows.Media.Brush)FindResource("Yellow"); _log.Write("Выбран сервер: "+p.Title); }
    private void OpenLogs_Click(object s,RoutedEventArgs e)=>Process.Start(new ProcessStartInfo("explorer.exe",AppPaths.Logs){UseShellExecute=true});
    private void Site_Click(object s,RoutedEventArgs e)=>OpenUrl("https://dadway.ru"); private void Telegram_Click(object s,RoutedEventArgs e)=>OpenUrl("https://t.me/gds_technical");
    private static void OpenUrl(string url)=>Process.Start(new ProcessStartInfo(url){UseShellExecute=true});
    private void AutoStart_Changed(object s,RoutedEventArgs e){ if(!IsLoaded)return; _settings.AutoStart=AutoStartCheck.IsChecked==true; using var k=Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run",true)!; if(_settings.AutoStart) k.SetValue("DadwayVPN",$"\"{Environment.ProcessPath}\""); else k.DeleteValue("DadwayVPN",false); _settingsService.Save(_settings); }
    private async Task ExitAsync(){ await DisconnectAsync(); _tray.Visible=false; _tray.Dispose(); Application.Current.Shutdown(); }
}
