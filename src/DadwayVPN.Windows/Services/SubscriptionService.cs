using System.Net.Http.Headers;
using System.Text;
namespace DadwayVPN.Windows.Services;
public sealed class SubscriptionService
{
    private readonly HttpClient _http;
    public SubscriptionService()
    {
        _http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true }) { Timeout = TimeSpan.FromSeconds(25) };
        _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("DadwayVPN-Windows", "2.0"));
    }
    public async Task<string> GetAsync(string profileId, string url, CancellationToken token)
    {
        AppPaths.Ensure(); var cache = Path.Combine(AppPaths.Cache, profileId + ".txt");
        try
        {
            var raw = (await _http.GetStringAsync(url, token)).Trim(); var decoded = Decode(raw);
            if (!decoded.Contains("://", StringComparison.Ordinal)) throw new InvalidDataException("Подписка не содержит ссылок подключения.");
            await File.WriteAllTextAsync(cache, decoded, token); return decoded;
        }
        catch when (File.Exists(cache)) { return await File.ReadAllTextAsync(cache, token); }
    }
    private static string Decode(string value)
    {
        if (value.Contains("://", StringComparison.Ordinal)) return value;
        try { var s=value.Replace("\r","").Replace("\n","").Trim().Replace('-','+').Replace('_','/'); s += new string('=',(4-s.Length%4)%4); return Encoding.UTF8.GetString(Convert.FromBase64String(s)).Trim(); }
        catch { return value; }
    }
    public static string FirstSupportedLink(string text) => text.Split(['\r','\n'], StringSplitOptions.RemoveEmptyEntries).Select(x=>x.Trim())
        .FirstOrDefault(x=>x.StartsWith("vless://",StringComparison.OrdinalIgnoreCase)) ?? throw new InvalidDataException("В подписке не найден профиль VLESS.");
}
