using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;

namespace ReplayAnalyzer;

[SupportedOSPlatform("browser")]
public static partial class Program
{
    public static void Main() { }

    [JSImport("decrypt", "replayCrypto")]
    private static partial byte[] Decrypt(byte[] key, byte[] data);

    [JSImport("accountKey", "replayCrypto")]
    private static partial string AccountKey(string id);

    [JSExport]
    public static string Analyze(byte[] replay) => AnalysisJson.Serialize(new Reader(Decrypt, AccountKey).Analyze(replay));
}


