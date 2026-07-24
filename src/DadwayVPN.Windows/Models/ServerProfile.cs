namespace DadwayVPN.Windows.Models;
public sealed record ServerProfile(string Id, string Title, string Flag, string SubscriptionUrl, bool AllowsHttp = false);
