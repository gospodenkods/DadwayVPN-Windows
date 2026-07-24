using System.Text.Json;
namespace DadwayVPN.Windows.Services;
public sealed class AppSettings
{
    public string SelectedProfileId { get; set; } = "russia";
    public bool AutoStart { get; set; }
    public bool AutoConnect { get; set; }
    public bool EnableSystemProxy { get; set; } = true;
    public bool KillSwitch { get; set; }
}
public sealed class SettingsService
{
    public AppSettings Load()
    {
        try { return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(AppPaths.Settings)) ?? new(); }
        catch { return new(); }
    }
    public void Save(AppSettings value) => File.WriteAllText(AppPaths.Settings, JsonSerializer.Serialize(value, new JsonSerializerOptions { WriteIndented = true }));
}
