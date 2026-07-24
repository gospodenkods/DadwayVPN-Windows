namespace DadwayVPN.Windows.Services;
public sealed class LogService
{
    private readonly object _sync = new();
    public event Action<string>? LineAdded;
    public string FilePath { get; }
    public LogService()
    {
        AppPaths.Ensure();
        FilePath = Path.Combine(AppPaths.Logs, $"dadway-{DateTime.Now:yyyyMMdd}.log");
    }
    public void Write(string message)
    {
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}";
        lock (_sync) File.AppendAllText(FilePath, line + Environment.NewLine);
        LineAdded?.Invoke(line);
    }
    public string Export()
    {
        var target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), $"DadwayVPN-log-{DateTime.Now:yyyyMMdd-HHmmss}.txt");
        File.Copy(FilePath, target, true); return target;
    }
}
