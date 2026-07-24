using DadwayVPN.Windows.Models;
using DadwayVPN.Windows.Services;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace DadwayVPN.Windows;
public partial class MainWindow : Window
{
    private readonly ServerProfile[] _profiles = [
        new("russia","Россия","🇷🇺","https://promo.dadway.ru/sub/tnt9ztgjgvizzclm"),
        new("usa","USA","🇺🇸","https://zpp.div3.ru:2096/sub/m315s5c3qc51hkoj"),
        new("netherlands","Netherlands","🇳🇱","http://mikrot.icu:2096/sub/hqx2y9f5rar310zd",true) ];
    private readonly SettingsService _settingsService=new(); private readonly AppSettings _settings;
    private readonly LogService _log=new(); private readonly SubscriptionService _subscriptions=new();
    private readonly SystemProxyService _systemProxy=new(); private readonly XrayCoreService _core; private readonly ConnectionMonitor _monitor=new();
    private readonly Forms.NotifyIcon _tray; private readonly DispatcherTimer _sessionTimer=new(){Interval=TimeSpan.FromSeconds(1)};
    private CancellationTokenSource? _cts; private ConnectionState _state; private DateTime _connectedAt; private bool _intentionalStop; private bool _exitRequested;

    public MainWindow()
    {
        InitializeComponent(); AppPaths.Ensure(); _settings=_settingsService.Load(); _core=new(_log);
        _log.LineAdded += x=>Dispatcher.Invoke(()=>{LogBox.AppendText(x+Environment.NewLine);LogBox.ScrollToEnd();});
        _core.UnexpectedExit += ()=>Dispatcher.Invoke(async()=>await HandleUnexpectedExitAsync()); _monitor.NetworkChanged += ()=>Dispatcher.Invoke(async()=>await HandleNetworkChangedAsync());
        _sessionTimer.Tick += (_,_)=>{if(_state==ConnectionState.Connected)SessionText.Text=(DateTime.Now-_connectedAt).ToString(@"hh\:mm\:ss");};
        _tray=new Forms.NotifyIcon{Icon=new System.Drawing.Icon(Path.Combine(AppContext.BaseDirectory,"Assets","dadway.ico")),Text="Dadway VPN 2.0",Visible=true};
        var menu=new Forms.ContextMenuStrip();menu.Items.Add("Открыть",null,(_,_)=>Dispatcher.Invoke(ShowWindow));menu.Items.Add("Подключить / отключить",null,(_,_)=>Dispatcher.Invoke(async()=>await ToggleAsync()));menu.Items.Add("Выход",null,(_,_)=>Dispatcher.Invoke(async()=>await ExitAsync()));_tray.ContextMenuStrip=menu;_tray.DoubleClick+=(_,_)=>Dispatcher.Invoke(ShowWindow);
        Closing+=(_,e)=>{if(!_exitRequested){e.Cancel=true;Hide();}};
        SystemProxyCheck.IsChecked=_settings.EnableSystemProxy;AutoReconnectCheck.IsChecked=_settings.AutoReconnect;AutoFallbackCheck.IsChecked=_settings.AutoFallback;AutoStartCheck.IsChecked=_settings.AutoStart;
        SelectProfile(_settings.SelectedProfileId,false);SetState(ConnectionState.Disconnected);_log.Write("Dadway VPN Windows 2.0 запущен.");
        if(Environment.GetCommandLineArgs().Any(x=>x.Equals("--minimized",StringComparison.OrdinalIgnoreCase))) Hide();
    }
    private void ShowWindow(){Show();WindowState=WindowState.Normal;Activate();}
    private async void ConnectButton_Click(object s,RoutedEventArgs e)=>await ToggleAsync();
    private async Task ToggleAsync(){if(_state is ConnectionState.Connected or ConnectionState.Connecting or ConnectionState.Reconnecting)await DisconnectAsync();else await ConnectSelectedAsync();}
    private async Task ConnectSelectedAsync()=>await ConnectAsync(_profiles.First(x=>x.Id==_settings.SelectedProfileId),false);
    private async Task ConnectAsync(ServerProfile p,bool reconnect)
    {
        if(_state==ConnectionState.Connecting)return; _intentionalStop=false; SetState(reconnect?ConnectionState.Reconnecting:ConnectionState.Connecting); _cts=new();
        try
        {
            _log.Write($"Загрузка профиля {p.Title}..."); var text=await _subscriptions.GetAsync(p.Id,p.SubscriptionUrl,_cts.Token);var link=SubscriptionService.FirstSupportedLink(text);var config=VlessConfigBuilder.Build(link);
            await _core.StartAsync(config,_cts.Token); if(SystemProxyCheck.IsChecked==true)_systemProxy.Enable(10809);
            _connectedAt=DateTime.Now;_sessionTimer.Start();SetState(ConnectionState.Connected);_log.Write($"Подключено: {p.Title}");await UpdateDiagnosticsAsync();
        }
        catch(Exception ex)
        {
            _log.Write("ОШИБКА: "+ex.Message);
            if(p.Id=="russia" && AutoFallbackCheck.IsChecked==true){var usa=_profiles.First(x=>x.Id=="usa");SelectProfile("usa",true);_log.Write("Автоматическое переключение на USA.");await ConnectAsync(usa,true);return;}
            SetState(ConnectionState.Error);await DisconnectCoreAsync();
        }
    }
    private async Task DisconnectAsync(){_intentionalStop=true;await DisconnectCoreAsync();SetState(ConnectionState.Disconnected);_log.Write("VPN отключён.");}
    private async Task DisconnectCoreAsync(){_cts?.Cancel();_sessionTimer.Stop();_systemProxy.Restore();await _core.StopAsync();IpText.Text="—";PingText.Text="— мс";DownloadText.Text="— Мбит/с";SessionText.Text="00:00:00";}
    private async Task HandleUnexpectedExitAsync(){if(_intentionalStop||_exitRequested)return;_log.Write("Ядро неожиданно остановлено.");if(AutoReconnectCheck.IsChecked==true){await Task.Delay(1500);await ConnectSelectedAsync();}else{_systemProxy.Restore();SetState(ConnectionState.Error);}}
    private async Task HandleNetworkChangedAsync(){if(_state!=ConnectionState.Connected||AutoReconnectCheck.IsChecked!=true)return;_log.Write("Изменение сети. Переподключение...");await DisconnectCoreAsync();await Task.Delay(1000);await ConnectSelectedAsync();}
    private async Task UpdateDiagnosticsAsync(){try{var d=await DiagnosticsService.TestAsync(CancellationToken.None);IpText.Text=d.Ip;PingText.Text=$"{d.PingMs} мс";DownloadText.Text=$"{d.DownloadMbps:F1} Мбит/с";_log.Write($"Тест: IP={d.Ip}, ping={d.PingMs} мс, download={d.DownloadMbps:F1} Мбит/с");}catch(Exception ex){_log.Write("Диагностика: "+ex.Message);}}
    private async void Test_Click(object s,RoutedEventArgs e)=>await UpdateDiagnosticsAsync();
    private void Server_Click(object s,RoutedEventArgs e){if(_state is ConnectionState.Connected or ConnectionState.Connecting)return;SelectProfile((string)((Button)s).Tag,true);}
    private void SelectProfile(string id,bool log){if(!_profiles.Any(x=>x.Id==id))id="russia";_settings.SelectedProfileId=id;_settingsService.Save(_settings);var p=_profiles.First(x=>x.Id==id);ServerText.Text=p.Title;foreach(var b in new[]{RussiaButton,UsaButton,NetherlandsButton})b.BorderBrush=(Brush)new BrushConverter().ConvertFrom("#354150")!;(id=="russia"?RussiaButton:id=="usa"?UsaButton:NetherlandsButton).BorderBrush=(Brush)FindResource("Yellow");if(log)_log.Write("Выбран сервер: "+p.Title);}
    private void SetState(ConnectionState state){_state=state;var connected=state==ConnectionState.Connected;ConnectButton.BorderBrush=(Brush)FindResource(connected?"Green":state==ConnectionState.Error?"Red":"Yellow");ConnectLabel.Text=connected?"ОТКЛЮЧИТЬ":state==ConnectionState.Connecting?"ПОДКЛЮЧЕНИЕ...":state==ConnectionState.Reconnecting?"ПЕРЕПОДКЛЮЧЕНИЕ...":"ПОДКЛЮЧИТЬ";StatusText.Text=state switch{ConnectionState.Connected=>"Подключено",ConnectionState.Connecting=>"Подключение...",ConnectionState.Reconnecting=>"Переподключение...",ConnectionState.Error=>"Ошибка",_=>"Отключено"};}
    private void ExportLogs_Click(object s,RoutedEventArgs e){try{var p=_log.Export();_log.Write("Лог экспортирован: "+p);Process.Start(new ProcessStartInfo("explorer.exe",$"/select,\"{p}\""){UseShellExecute=true});}catch(Exception ex){_log.Write("Экспорт логов: "+ex.Message);}}
    private void Site_Click(object s,RoutedEventArgs e)=>OpenUrl("https://dadway.ru");private void Telegram_Click(object s,RoutedEventArgs e)=>OpenUrl("https://t.me/gds_technical");private static void OpenUrl(string u)=>Process.Start(new ProcessStartInfo(u){UseShellExecute=true});
    private void Settings_Changed(object s,RoutedEventArgs e){if(!IsLoaded)return;_settings.AutoStart=AutoStartCheck.IsChecked==true;_settings.EnableSystemProxy=SystemProxyCheck.IsChecked==true;_settings.AutoReconnect=AutoReconnectCheck.IsChecked==true;_settings.AutoFallback=AutoFallbackCheck.IsChecked==true;AutoStartService.Set(_settings.AutoStart);_settingsService.Save(_settings);}
    private async Task ExitAsync(){_exitRequested=true;await DisconnectAsync();_monitor.Dispose();_tray.Visible=false;_tray.Dispose();System.Windows.Application.Current.Shutdown();}
}
