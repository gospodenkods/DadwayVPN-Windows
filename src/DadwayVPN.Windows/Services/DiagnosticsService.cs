using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
namespace DadwayVPN.Windows.Services;
public static class DiagnosticsService
{
    public static async Task<(string ip,long ping)> TestAsync(CancellationToken token)
    {
        using var handler = new HttpClientHandler { Proxy = new WebProxy("http://127.0.0.1:10809"), UseProxy = true };
        using var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(15) };
        var sw=Stopwatch.StartNew(); var ip=(await http.GetStringAsync("https://api.ipify.org",token)).Trim(); sw.Stop();
        return (ip, sw.ElapsedMilliseconds);
    }
}
