using System.Text.Json;

namespace ReplayAnalyzer;

public sealed record Position(double X, double Y, double Z);
public sealed record Opening(string Id, string Type, float Time, Position Position,
    uint? PlayerId, string Player, bool Recorder, string Attribution, string Evidence, string Action, string TeamRole);
public sealed record SquadMember(uint PlayerId, string Alias, bool Recorder, string AccountKey, string Evidence);
public sealed record Loot(uint Actor, string ItemId, float ObservedAt, Position Position,
    int? Stack, bool? PickedUp, bool? FromContainer, string ChestId, string SourceEvidence);

public sealed class Analysis
{
    public string Status { get; set; } = "unsupported";
    public string Detail { get; set; }
    public string Branch { get; set; }
    public uint? Build { get; set; }
    public uint? FileVersion { get; set; }
    public uint? NetworkVersion { get; set; }
    public uint? EngineNetworkVersion { get; set; }
    public string Guid { get; set; }
    public uint? DurationMs { get; set; }
    public string RecordedAt { get; set; }
    public bool? Encrypted { get; set; }
    public bool? Compressed { get; set; }
    public int Frames { get; set; }
    public int SkippedPackets { get; set; }
    public int ChestActorsObserved { get; set; }
    public string RecorderName { get; set; }
    public string SquadEvidence { get; set; }
    public int? RecorderTeam { get; set; }
    public List<SquadMember> Squad { get; } = [];
    public List<Opening> Chests { get; } = [];
    public List<Loot> Items { get; } = [];
    public SortedDictionary<string, string[]> Schema { get; } = [];
    public SortedSet<string> Events { get; } = [];
}

public static class AnalysisJson
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    public static string Serialize(Analysis result) => JsonSerializer.Serialize(result, Options);
}



