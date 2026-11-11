using System.Collections.Specialized;
using System.Text.Json;

internal static class OverlayProtocol
{
    internal const string Path = "/__fortnite_chest_analyzer/overlay";
    internal const string Header = "X-Fortnite-Chest-Analyzer";
    internal const string Version = "overlay-worker";
    internal sealed record Reply(int Status, Stream? Content = null, string? ContentType = null);

    internal static async Task<Reply> Handle(NameValueCollection query, OverlayWindow overlay)
    {
        if (!Guid.TryParse(query["client"], out var client)) return new Reply(403);
        var action = query["action"];
        if (action == "open") return new Reply(overlay.Open(client, query["language"] == "es") ? 204 : 409);
        if (action == "close")
        {
            overlay.Close(client);
            return new Reply(204);
        }
        var feed = overlay.Feed(client);
        if (feed is null) return new Reply(410);

        switch (action)
        {
            case "next":
                using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(45)))
                {
                    try
                    {
                        var batch = await feed.Next(timeout.Token);
                        return batch is null ? new Reply(410) : new Reply(200,
                            new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(batch, JsonSerializerOptions.Web)),
                            "application/json");
                    }
                    catch (OperationCanceledException) when (timeout.IsCancellationRequested) { return new Reply(204); }
                }
            case "file":
                if (Guid.TryParse(query["id"], out var id) && int.TryParse(query["generation"], out var generation))
                {
                    try
                    {
                        var file = feed.Open(id, generation);
                        if (file is not null) return new Reply(200, file, "application/octet-stream");
                    }
                    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
                }
                return new Reply(404);
            case "update":
                if (query["data"] is not { Length: > 0 and <= 6144 } data) return new Reply(400);
                try
                {
                    var counters = JsonSerializer.Deserialize<OverlayWindow.Counters>(data, JsonSerializerOptions.Web);
                    if (counters is null) return new Reply(400);
                    overlay.Update(client, counters);
                    return new Reply(204);
                }
                catch (JsonException) { return new Reply(400); }
            default:
                return new Reply(400);
        }
    }
}
