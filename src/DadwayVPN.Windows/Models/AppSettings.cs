namespace DadwayVPN.Windows.Models;
public sealed class AppSettings
{
    public string SelectedProfileId { get; set; } = "russia";
    public bool AutoStart { get; set; }
    public bool EnableSystemProxy { get; set; } = true;
    public bool AutoReconnect { get; set; } = true;
    public bool AutoFallback { get; set; } = true;
    public bool StartMinimized { get; set; }
}
