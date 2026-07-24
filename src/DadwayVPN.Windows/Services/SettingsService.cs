using DadwayVPN.Windows.Models;
using System.Text.Json;
namespace DadwayVPN.Windows.Services;
public sealed class SettingsService
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    public AppSettings Load()
    {
        AppPaths.Ensure();
        try { return File.Exists(AppPaths.Settings) ? JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(AppPaths.Settings), JsonOptions) ?? new() : new(); }
        catch { return new(); }
    }
    public void Save(AppSettings value) { AppPaths.Ensure(); File.WriteAllText(AppPaths.Settings, JsonSerializer.Serialize(value, JsonOptions)); }
}
