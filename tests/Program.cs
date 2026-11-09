using System.Security.Cryptography;
using ReplayAnalyzer;

static byte[] Decrypt(byte[] key, byte[] data)
{
    using var aes = Aes.Create();
    aes.Key = key;
    return aes.DecryptEcb(data, PaddingMode.PKCS7);
}

foreach (var path in args)
{
    var result = new Reader(Decrypt, id => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(id)))).Analyze(File.ReadAllBytes(path));
    Console.WriteLine(AnalysisJson.Serialize(result));
}


