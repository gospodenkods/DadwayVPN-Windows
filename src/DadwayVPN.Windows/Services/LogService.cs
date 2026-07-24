namespace DadwayVPN.Windows.Services;
public sealed class LogService
{
    public event Action<string>? LineAdded;
    public string FilePath { get; }
    public LogService()
    {
        AppPaths.Ensure();
        FilePath = Path.Combine(AppPaths.Logs, $"dadway-{DateTime.Now:yyyyMMdd}.log");
    }
    public void Write(string text)
    {
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {text}";
        File.AppendAllText(FilePath, line + Environment.NewLine);
        LineAdded?.Invoke(line);
    }
}
