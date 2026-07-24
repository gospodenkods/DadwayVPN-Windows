using System.Net.NetworkInformation;
namespace DadwayVPN.Windows.Services;
public sealed class ConnectionMonitor : IDisposable
{
    public event Action? NetworkChanged;
    public ConnectionMonitor(){NetworkChange.NetworkAvailabilityChanged+=OnChanged;NetworkChange.NetworkAddressChanged+=OnAddress;}
    private void OnChanged(object? s,NetworkAvailabilityEventArgs e)=>NetworkChanged?.Invoke();
    private void OnAddress(object? s,EventArgs e)=>NetworkChanged?.Invoke();
    public void Dispose(){NetworkChange.NetworkAvailabilityChanged-=OnChanged;NetworkChange.NetworkAddressChanged-=OnAddress;}
}
