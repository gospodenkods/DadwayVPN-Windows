using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text.Json;
namespace DadwayVPN.Windows.Services;
public sealed class XrayCoreService
{
    private Process? _process;
    private readonly LogService _log;
    public bool IsRunning => _process is { HasExited: false };
    public XrayCoreService(LogService log) => _log = log;
    public async Task EnsureAsync(CancellationToken token)
    {
        AppPaths.Ensure();
        var exe = Path.Combine(AppPaths.Core, "xray.exe");
        if (File.Exists(exe)) return;
        _log.Write("Загрузка Xray Core...");
        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("DadwayVPN-Windows", "1.0"));
        var release = JsonDocument.Parse(await http.GetStringAsync("https://api.github.com/repos/XTLS/Xray-core/releases/latest", token));
        var url = release.RootElement.GetProperty("assets").EnumerateArray()
            .First(x => x.GetProperty("name").GetString()!.Equals("Xray-windows-64.zip", StringComparison.OrdinalIgnoreCase))
            .GetProperty("browser_download_url").GetString()!;
        var zip = Path.Combine(AppPaths.Root, "xray.zip");
        await using (var fs = File.Create(zip)) await (await http.GetStreamAsync(url, token)).CopyToAsync(fs, token);
        ZipFile.ExtractToDirectory(zip, AppPaths.Core, true); File.Delete(zip);
        _log.Write("Xray Core установлен.");
    }
    public async Task StartAsync(string config, CancellationToken token)
    {
        await EnsureAsync(token); await StopAsync();
        await File.WriteAllTextAsync(AppPaths.Config, config, token);
        var psi = new ProcessStartInfo(Path.Combine(AppPaths.Core, "xray.exe"), $"run -config \"{AppPaths.Config}\"") {
            WorkingDirectory = AppPaths.Core, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
        };
        _process = Process.Start(psi) ?? throw new InvalidOperationException("Не удалось запустить Xray Core.");
        _process.OutputDataReceived += (_,e)=> { if(!string.IsNullOrWhiteSpace(e.Data)) _log.Write("CORE: "+e.Data); };
        _process.ErrorDataReceived += (_,e)=> { if(!string.IsNullOrWhiteSpace(e.Data)) _log.Write("CORE: "+e.Data); };
        _process.BeginOutputReadLine(); _process.BeginErrorReadLine();
        await Task.Delay(1200, token);
        if (_process.HasExited) throw new InvalidOperationException("Xray Core завершился сразу после запуска. См. журнал.");
    }
    public Task StopAsync()
    {
        try { if (_process is { HasExited:false }) { _process.Kill(true); _process.WaitForExit(3000); } } catch { }
        _process?.Dispose(); _process=null; return Task.CompletedTask;
    }
}
