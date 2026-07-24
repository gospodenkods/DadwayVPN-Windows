using DadwayVPN.Windows.Models;
using System.Diagnostics;
using System.Net.Http;
namespace DadwayVPN.Windows.Services;
public static class DiagnosticsService
{
    public static async Task<DiagnosticsResult> TestAsync(CancellationToken token)
    {
        using var http=new HttpClient{Timeout=TimeSpan.FromSeconds(20)};
        var pingWatch=Stopwatch.StartNew(); var ip=(await http.GetStringAsync("https://api.ipify.org",token)).Trim(); pingWatch.Stop();
        var ping=pingWatch.ElapsedMilliseconds;
        var speedWatch=Stopwatch.StartNew();
        var data=await http.GetByteArrayAsync("https://speed.cloudflare.com/__down?bytes=1000000",token);
        speedWatch.Stop();
        var down=Math.Max(0.01,data.Length*8d/1_000_000d/Math.Max(0.1,speedWatch.Elapsed.TotalSeconds));
        return new(ip,ping,down,0);
    }
}
