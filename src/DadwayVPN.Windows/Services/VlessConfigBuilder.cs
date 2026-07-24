using System.Text.Json;
using System.Text.Json.Nodes;
namespace DadwayVPN.Windows.Services;
public static class VlessConfigBuilder
{
    public static string Build(string link, int socksPort = 10808, int httpPort = 10809)
    {
        var uri = new Uri(link);
        var q = ParseQuery(uri.Query);
        var id = Uri.UnescapeDataString(uri.UserInfo);
        var network = Get(q,"type") ?? "tcp";
        var security = Get(q,"security") ?? "none";
        var stream = new JsonObject { ["network"] = network, ["security"] = security };
        if (network.Equals("ws", StringComparison.OrdinalIgnoreCase))
            stream["wsSettings"] = new JsonObject { ["path"] = Get(q,"path") ?? "/", ["headers"] = new JsonObject { ["Host"] = Get(q,"host") ?? "" } };
        if (network.Equals("xhttp", StringComparison.OrdinalIgnoreCase) || network.Equals("splithttp", StringComparison.OrdinalIgnoreCase))
            stream["xhttpSettings"] = new JsonObject { ["path"] = Get(q,"path") ?? "/", ["host"] = Get(q,"host") ?? "", ["mode"] = Get(q,"mode") ?? "auto" };
        if (security.Equals("tls", StringComparison.OrdinalIgnoreCase))
            stream["tlsSettings"] = new JsonObject { ["serverName"] = Get(q,"sni") ?? uri.Host, ["allowInsecure"] = false, ["alpn"] = new JsonArray((Get(q,"alpn") ?? "http/1.1").Split(',').Select(JsonValue.Create).ToArray()) };
        if (security.Equals("reality", StringComparison.OrdinalIgnoreCase))
        {
            var sni = Get(q,"sni") ?? Get(q,"serverName") ?? throw new InvalidDataException("REALITY: отсутствует SNI.");
            stream["realitySettings"] = new JsonObject {
                ["serverName"] = sni, ["fingerprint"] = Get(q,"fp") ?? "chrome", ["publicKey"] = Get(q,"pbk") ?? "",
                ["shortId"] = Get(q,"sid") ?? "", ["spiderX"] = Get(q,"spx") ?? "/", ["mldsa65Verify"] = Get(q,"pqv") ?? ""
            };
        }
        var root = new JsonObject {
            ["log"] = new JsonObject { ["loglevel"] = "warning" },
            ["dns"] = new JsonObject { ["servers"] = new JsonArray("1.1.1.1", "8.8.8.8") },
            ["inbounds"] = new JsonArray(
                new JsonObject { ["tag"]="socks-in", ["listen"]="127.0.0.1", ["port"]=socksPort, ["protocol"]="socks", ["settings"]=new JsonObject { ["udp"]=true } },
                new JsonObject { ["tag"]="http-in", ["listen"]="127.0.0.1", ["port"]=httpPort, ["protocol"]="http", ["settings"]=new JsonObject() }),
            ["outbounds"] = new JsonArray(
                new JsonObject { ["tag"]="proxy", ["protocol"]="vless", ["settings"]=new JsonObject { ["vnext"]=new JsonArray(new JsonObject { ["address"]=uri.Host, ["port"]=uri.Port, ["users"]=new JsonArray(new JsonObject { ["id"]=id, ["encryption"]=Get(q,"encryption") ?? "none", ["flow"]=Get(q,"flow") ?? "" }) }) }, ["streamSettings"]=stream },
                new JsonObject { ["tag"]="direct", ["protocol"]="freedom", ["settings"]=new JsonObject() },
                new JsonObject { ["tag"]="block", ["protocol"]="blackhole", ["settings"]=new JsonObject() }),
            ["routing"] = new JsonObject { ["domainStrategy"]="IPIfNonMatch", ["rules"]=new JsonArray(
                new JsonObject { ["type"]="field", ["domain"]=new JsonArray("domain:ru","domain:by","domain:su"), ["outboundTag"]="direct" },
                new JsonObject { ["type"]="field", ["ip"]=new JsonArray("10.0.0.0/8","100.64.0.0/10","127.0.0.0/8","169.254.0.0/16","172.16.0.0/12","192.168.0.0/16","::1/128","fc00::/7","fe80::/10"), ["outboundTag"]="direct" }) }
        };
        return root.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
    }
    private static Dictionary<string,string> ParseQuery(string query)
    {
        var result = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = part.Split('=', 2);
            result[Uri.UnescapeDataString(pair[0])] = pair.Length > 1 ? Uri.UnescapeDataString(pair[1].Replace('+',' ')) : "";
        }
        return result;
    }
    private static string? Get(Dictionary<string,string> query, string key) => query.TryGetValue(key, out var value) ? value : null;
}

