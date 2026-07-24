namespace DadwayVPN.Windows.Models;
public sealed record DiagnosticsResult(string Ip, long PingMs, double DownloadMbps, double UploadMbps);
