namespace DadwayVPN.Windows.Services;
public static class AppPaths
{
    public static string Root => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DadwayVPN");
    public static string Core => Path.Combine(Root, "core");
    public static string Cache => Path.Combine(Root, "cache");
    public static string Logs => Path.Combine(Root, "logs");
    public static string Settings => Path.Combine(Root, "settings.json");
    public static string Config => Path.Combine(Root, "config.json");
    public static void Ensure() { Directory.CreateDirectory(Root); Directory.CreateDirectory(Core); Directory.CreateDirectory(Cache); Directory.CreateDirectory(Logs); }
}
