namespace DadwayVPN.Windows.Services;
public static class AppPaths
{
    public static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DadwayVPN");
    public static readonly string Core = Path.Combine(Root, "core");
    public static readonly string Cache = Path.Combine(Root, "cache");
    public static readonly string Logs = Path.Combine(Root, "logs");
    public static readonly string Config = Path.Combine(Root, "config.json");
    public static readonly string Settings = Path.Combine(Root, "settings.json");
    public static void Ensure() { Directory.CreateDirectory(Root); Directory.CreateDirectory(Core); Directory.CreateDirectory(Cache); Directory.CreateDirectory(Logs); }
}
