using System.Collections.Concurrent;
using System.Threading.Channels;

internal sealed class OverlayReplayFeed : IDisposable
{
    internal sealed record Entry(Guid Id, string Path, long Size, long WrittenAt);
    internal sealed record Batch(int Generation, int Found, long StartedAt, Entry[] Files, string[] Removed, bool Failed = false, int Waiting = 0);
    private sealed record Source(int Generation, string Path, long Size, DateTime Written);
    private readonly Channel<Batch> batches = Channel.CreateUnbounded<Batch>();
    private readonly ConcurrentDictionary<Guid, Source> files = new();
    private CancellationTokenSource? scan;
    private int generation;
    private readonly long startedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    internal int Generation => Volatile.Read(ref generation);

    internal void Watch(string folder)
    {
        var epoch = Interlocked.Increment(ref generation);
        scan?.Cancel();
        files.Clear();
        var current = scan = new CancellationTokenSource();
        _ = Task.Run(async () =>
        {
            try { await Scan(folder, epoch, current.Token); }
            catch (OperationCanceledException) when (current.IsCancellationRequested) { }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
            {
                batches.Writer.TryWrite(new Batch(epoch, 0, startedAt, [], [], true));
            }
        });
    }

    internal async ValueTask<Batch?> Next(CancellationToken token)
    {
        while (await batches.Reader.WaitToReadAsync(token))
            if (batches.Reader.TryRead(out var batch) && batch.Generation == Generation) return batch;
        return null;
    }

    internal FileStream? Open(Guid id, int epoch)
    {
        if (epoch != Generation || !files.TryRemove(id, out var file) || file.Generation != epoch) return null;
        var info = new FileInfo(file.Path);
        if (!info.Exists || info.Length != file.Size || info.LastWriteTimeUtc != file.Written
            || info.Attributes.HasFlag(FileAttributes.ReparsePoint)) return null;
        return File.Open(file.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
    }

    public void Dispose()
    {
        scan?.Cancel();
        files.Clear();
        batches.Writer.TryComplete();
    }

    private async Task Scan(string folder, int epoch, CancellationToken token)
    {
        var changes = Channel.CreateUnbounded<string>(new() { SingleReader = true });
        using var watcher = new FileSystemWatcher(folder, "*.replay")
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size
        };
        watcher.Created += (_, e) => changes.Writer.TryWrite(e.FullPath);
        watcher.Changed += (_, e) => changes.Writer.TryWrite(e.FullPath);
        watcher.Deleted += (_, e) => changes.Writer.TryWrite(e.FullPath);
        watcher.Renamed += (_, e) =>
        {
            changes.Writer.TryWrite(e.OldFullPath);
            changes.Writer.TryWrite(e.FullPath);
        };
        watcher.Error += (_, _) => changes.Writer.TryWrite("");
        watcher.EnableRaisingEvents = true;
        changes.Writer.TryWrite("");

        var options = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true,
            AttributesToSkip = FileAttributes.ReparsePoint };
        var seen = new Dictionary<string, Source>(StringComparer.OrdinalIgnoreCase);
        var waiting = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var first = true;
        while (await changes.Reader.WaitToReadAsync(token))
        {
            await Task.Delay(750, token);
            var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            while (changes.Reader.TryRead(out var path)) paths.Add(path);
            var previouslyWaiting = waiting.Count;
            if (paths.Remove(""))
            {
                paths.UnionWith(Directory.EnumerateFiles(folder, "*.replay", options));
                paths.UnionWith(seen.Keys);
                paths.UnionWith(waiting);
            }
            var added = new List<Entry>();
            var removed = new List<string>();
            foreach (var path in paths.Order(StringComparer.OrdinalIgnoreCase))
            {
                token.ThrowIfCancellationRequested();
                if (!string.Equals(Path.GetExtension(path), ".replay", StringComparison.OrdinalIgnoreCase)) continue;
                var info = new FileInfo(path);
                var relative = Path.GetRelativePath(folder, path).Replace('\\', '/');
                if (!info.Exists || info.Attributes.HasFlag(FileAttributes.ReparsePoint))
                {
                    if (seen.Remove(path) | waiting.Remove(path)) removed.Add(relative);
                    continue;
                }
                var source = new Source(epoch, path, info.Length, info.LastWriteTimeUtc);
                if (seen.TryGetValue(path, out var old) && source == old) continue;
                try
                {
                    using var probe = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.Read);
                }
                catch (IOException error) when ((error.HResult & 0xffff) is 32 or 33)
                {
                    waiting.Add(path);
                    continue;
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException)
                {
                    // Let the browser report an individual file error without ending the watch.
                }
                waiting.Remove(path);
                seen[path] = source;
                var id = Guid.NewGuid();
                if (source.Size <= 128 * 1024 * 1024) files[id] = source;
                added.Add(new Entry(id, relative, source.Size, new DateTimeOffset(source.Written).ToUnixTimeMilliseconds()));
            }
            if (first || added.Count != 0 || removed.Count != 0 || waiting.Count != previouslyWaiting)
                batches.Writer.TryWrite(new Batch(epoch, seen.Keys.Union(waiting, StringComparer.OrdinalIgnoreCase).Count(),
                    startedAt, [.. added], [.. removed], Waiting: waiting.Count));
            first = false;
        }
    }
}
