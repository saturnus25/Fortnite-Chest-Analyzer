using System.Diagnostics;
using System.Globalization;
using Microsoft.Extensions.Logging;
using Unreal.Core;
using Unreal.Core.Attributes;
using Unreal.Core.Contracts;
using Unreal.Core.Exceptions;
using Unreal.Core.Models;
using Unreal.Core.Models.Enums;
using BinaryArchive = Unreal.Core.BinaryReader;

namespace ReplayAnalyzer;

// NetPlayerIndex is present when the replay spectator opens its actor channel.
[PlayerController("BP_ReplayPC_Athena_C")]
internal sealed class ReplayControllerMarker { }

public sealed class Reader : ReplayReader<Replay>
{
    private enum Kind { Other, Chest, Cannon, Pickup, Pawn, PlayerState, GameState, Controller }
    private const int MaxReplay = 128 * 1024 * 1024;
    private const int MaxChunk = 64 * 1024 * 1024;
    private readonly Func<byte[], byte[], byte[]> _decrypt;
    private readonly Dictionary<string, Kind> _classes = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Chest> _chests = new(StringComparer.Ordinal);
    private readonly Dictionary<uint, string> _chestIds = [];
    private readonly Dictionary<(string, int, int), List<Chest>> _spawnCells = [];
    private readonly Dictionary<uint, Pickup> _pickups = [];
    private readonly Dictionary<uint, string> _cannonLoot = [];
    private readonly Dictionary<uint, uint> _pawns = [];
    private readonly HashSet<uint> _ambiguousPawns = [];
    private readonly Dictionary<uint, Player> _players = [];
    private readonly Func<string, string> _accountKey;
    private readonly Dictionary<uint, string> _itemNames = [];
    private readonly Dictionary<string, HashSet<string>> _fields = new(StringComparer.Ordinal);
    private readonly Analysis _result = new();
    private readonly DecodeLog _log;
    private readonly Stopwatch _timer = new();
    private uint? _recorder, _controller;
    private float _time;
    private int _chunkEnd;
    private bool _hasChestSchema;
    private byte[] _key;
    private readonly bool _trace = Environment.GetEnvironmentVariable("REPLAY_TRACE") == "1";

    public Reader(Func<byte[], byte[], byte[]> decrypt, Func<string, string> accountKey) : this(decrypt, accountKey, new DecodeLog()) { }
    private Reader(Func<byte[], byte[], byte[]> decrypt, Func<string, string> accountKey, DecodeLog log) : base(log, ParseMode.Minimal)
    {
        _decrypt = decrypt;
        _accountKey = accountKey;
        _log = log;
    }

    public Analysis Analyze(byte[] bytes)
    {
        _timer.Start();
        if (bytes.Length < 8 || bytes.Length > MaxReplay)
        {
            _result.Status = "error";
            _result.Detail = "Tamaño inválido. El límite por repetición es 128 MiB.";
            return _result;
        }

        Replay = new Replay();
        using var archive = new BinaryArchive(bytes.AsMemory());
        try
        {
            ReadReplayInfo(archive);
            _key = Replay.Info.EncryptionKey.ToArray();
            ReadReplayChunks(archive);
            _result.Status = Replay.Header is not null && _result.Frames > 0 && _hasChestSchema
                ? "complete" : "unsupported";
            if (_result.Status == "unsupported")
                _result.Detail = "No se reconoció el flujo de cofres en esta grabación.";
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            _result.Status = _result.Frames > 0 ? "partial" : ex is NotSupportedException ? "unsupported" : "error";
            _result.Detail = ex is InvalidDataException or InvalidReplayException or NotSupportedException or TimeoutException
                ? ex.Message : $"Lectura interrumpida en el byte {archive.Position} ({ex.GetType().Name}).";
        }

        _result.SkippedPackets = _log.Errors;
        if (_result.Status == "complete" && _result.SkippedPackets > 0)
        {
            _result.Status = "partial";
            _result.Detail = "Algunos bloques de red no se pudieron decodificar.";
        }

        if (Replay.Info is { } info)
        {
            _result.DurationMs = info.LengthInMs;
            _result.Build = info.Changelist;
            _result.FileVersion = (uint)info.FileVersion;
            _result.RecordedAt = info.Timestamp == default ? null :
                info.Timestamp.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);
            _result.Encrypted = info.IsEncrypted;
            _result.Compressed = info.IsCompressed;
            _result.Live = info.IsLive;
        }
        if (Replay.Header is { } header)
        {
            _result.Branch = header.Branch;
            _result.Guid = string.IsNullOrWhiteSpace(header.Guid) || header.Guid.All(c => c is '0' or '-')
                ? null : header.Guid;
            _result.NetworkVersion = (uint)header.NetworkVersion;
            _result.EngineNetworkVersion = (uint)header.EngineNetworkVersion;
        }

        Finish();
        return _result;
    }

    public override void ReadReplayInfo(FArchive archive)
    {
        // Check the variable-length prefix before the upstream reader consumes it.
        var magic = archive.ReadUInt32();
        var version = archive.ReadUInt32();
        if (magic != FileMagic) throw new InvalidDataException("La firma no corresponde a un archivo .replay de Unreal.");
        if (version is < 5 or > (uint)ReplayVersionHistory.LATEST)
            throw new NotSupportedException($"Versión de contenedor {version} fuera del rango admitido (5–{(uint)ReplayVersionHistory.LATEST}).");
        if (version >= (uint)ReplayVersionHistory.HISTORY_CUSTOM_VERSIONS)
        {
            var count = archive.ReadInt32();
            if (count is < 0 or > 128) throw new InvalidDataException("Lista de versiones del contenedor inválida.");
        }
        archive.Seek(0, SeekOrigin.Begin);
        base.ReadReplayInfo(archive);
        if (Replay.Info.IsEncrypted && Replay.Info.EncryptionKey.Length is not (16 or 24 or 32))
            throw new InvalidDataException("La clave AES del replay es inválida.");
    }

    public override void ReadReplayChunks(FArchive archive)
    {
        var length = ((BinaryArchive)archive).Bytes.Length;
        while (archive.Position < length)
        {
            CheckTime();
            if (length - archive.Position < 8) throw new InvalidDataException("Cabecera de bloque truncada.");
            var type = archive.ReadUInt32AsEnum<ReplayChunkType>();
            var size = archive.ReadInt32();
            if (size < 0 || size > length - archive.Position)
                throw new InvalidDataException("Bloque truncado o tamaño inválido.");
            _chunkEnd = archive.Position + size;
            switch (type)
            {
                case ReplayChunkType.Header:
                    base.ReadReplayHeader(archive);
                    break;
                case ReplayChunkType.Event:
                    ReadEvent(archive);
                    break;
                case ReplayChunkType.ReplayData when Replay.Header is not null:
                    ReadReplayData(archive, size);
                    break;
            }
            if (archive.Position > _chunkEnd || archive.IsError)
                throw new InvalidDataException("Lectura fuera de los límites del bloque.");
            archive.Seek(_chunkEnd, SeekOrigin.Begin);
        }
    }

    public override void ReadEvent(FArchive archive)
    {
        archive.ReadFString(); // Event id, often contains player information.
        var group = archive.ReadFString();
        var metadata = archive.ReadFString();
        if (_result.Events.Count < 100 && group.Length < 160 && metadata.Length < 160)
            _result.Events.Add(string.IsNullOrEmpty(metadata) ? group : $"{group}/{metadata}");
    }

    public override void ReadDemoFrameIntoPlaybackPackets(FArchive archive)
    {
        var offset = archive.Position;
        if (archive.NetworkVersion >= NetworkVersionHistory.HISTORY_MULTIPLE_LEVELS)
            archive.ReadInt32();
        var seconds = archive.ReadSingle();
        archive.Seek(offset, SeekOrigin.Begin);
        if (!float.IsFinite(seconds) || seconds < 0 || seconds > 86400)
            throw new InvalidDataException("Marca temporal de fotograma inválida.");
        _time = seconds;
        _result.Frames++;
        if ((_result.Frames & 255) == 0) CheckTime();
        base.ReadDemoFrameIntoPlaybackPackets(archive);
        if (archive.Position <= offset || archive.IsError)
            throw new InvalidDataException("Fotograma truncado.");
    }

    private void CheckTime()
    {
        if (_timer.Elapsed.TotalMinutes > 2)
            throw new TimeoutException("Se alcanzó el límite de dos minutos por repetición.");
    }

    protected override FArchive DecryptBuffer(FArchive archive, int size)
    {
        if (size <= 0 || size > MaxChunk || size > _chunkEnd - archive.Position)
            throw new InvalidDataException("Tamaño de bloque de red inválido.");
        var data = archive.ReadMemory(size);
        if (_key.Length > 0)
        {
            if (size % 16 != 0) throw new InvalidDataException("Bloque AES incompleto.");
            data = _decrypt(_key, data.ToArray());
        }
        return Binary(data, archive);
    }

    protected override FArchive Decompress(FArchive archive)
    {
        if (!Replay.Info.IsCompressed) return archive;
        var unpacked = archive.ReadInt32();
        var packed = archive.ReadInt32();
        if (unpacked <= 0 || unpacked > MaxChunk || packed <= 0 || packed > ((BinaryArchive)archive).Bytes.Length - 8)
            throw new InvalidDataException("Tamaño de compresión Oodle inválido.");
        return Binary(Unreal.Encryption.Oodle.DecompressReplayData(archive.ReadBytes(packed), unpacked), archive);
    }

    private static BinaryArchive Binary(ReadOnlyMemory<byte> data, FArchive archive) => new(data)
    {
        EngineNetworkVersion = archive.EngineNetworkVersion,
        NetworkVersion = archive.NetworkVersion,
        ReplayHeaderFlags = archive.ReplayHeaderFlags,
        ReplayVersion = archive.ReplayVersion,
    };

    private Kind Classify(string path)
    {
        if (_classes.TryGetValue(path, out var kind)) return kind;
        var name = ShortName(path);
        if (!path.Contains(':') && !path.EndsWith("ClassNetCache", StringComparison.Ordinal))
        {
            if (name.Contains("LootCannon", StringComparison.OrdinalIgnoreCase) || name.Contains("Confetti", StringComparison.OrdinalIgnoreCase)) kind = Kind.Cannon;
            else if (name.Contains("Chest", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Tiered_Ammo") || name.Contains("Tiered_Short_Ammo") || name.Contains("AmmoBox")
                || path.Contains("/Containers/") || name.Contains("LootContainer") || name.Contains("SupplyDrop")) kind = Kind.Chest;
            else if (name.StartsWith("FortPickupAthena", StringComparison.Ordinal) && !name.Contains("Component")) kind = Kind.Pickup;
            else if (name.Contains("PlayerPawn", StringComparison.Ordinal)) kind = Kind.Pawn;
            else if (name.Contains("PlayerState", StringComparison.Ordinal) && !name.Contains("Component")) kind = Kind.PlayerState;
            else if (name.Contains("ReplayPC", StringComparison.Ordinal)) kind = Kind.Controller;
            else if (name.Contains("GameState", StringComparison.Ordinal) && !name.Contains("Component")) kind = Kind.GameState;
        }
        _classes[path] = kind;
        return kind;
    }

    public override bool ReceiveProperties(FBitArchive archive, NetFieldExportGroup group, uint channelIndex,
        out INetFieldExportGroup exportGroup, bool enablePropertyChecksum = true, bool netDeltaUpdate = false)
    {
        var kind = netDeltaUpdate ? Kind.Other : Classify(group.PathName);
        if (kind == Kind.Other)
            return base.ReceiveProperties(archive, group, channelIndex, out exportGroup, enablePropertyChecksum, netDeltaUpdate);
        exportGroup = null;
        if (Channels[channelIndex] is not { ActorId: uint actor } channel) return false;
        if (enablePropertyChecksum) archive.ReadBit();

        var type = ShortName(group.PathName);
        var schemaKey = kind is Kind.Chest or Kind.Cannon or Kind.Pickup or Kind.PlayerState ? $"{kind}/{type}" : kind.ToString();
        if (!_fields.TryGetValue(schemaKey, out var fields))
        {
            fields = new HashSet<string>(StringComparer.Ordinal);
            _fields.Add(schemaKey, fields);
        }

        uint? searcher = null, playerState = null, item = null, owner = null;
        bool? fired = null, searched = null, destroyed = null, tossed = null, picked = null;
        int? animation = null, count = null, team = null, squad = null;
        uint? teamActor = null;
        bool? spectator = null;
        string name = null, account = null;
        FVector location = null;
        List<uint> cannonLoot = null;
        while (!archive.IsError && archive.GetBitsLeft() >= 8)
        {
            var handle = archive.ReadIntPacked();
            if (handle == 0)
            {
                switch (kind)
                {
                    case Kind.Chest:
                        _hasChestSchema |= searched.HasValue || animation.HasValue;
                        UpdateChest(actor, type, ToPosition(location ?? channel.Actor?.Location), searcher, searched, destroyed, animation, false);
                        break;
                    case Kind.Cannon:
                        _hasChestSchema |= fired.HasValue || cannonLoot is not null;
                        var cannon = FindChest(actor, type, ToPosition(location ?? channel.Actor?.Location));
                        if (cannonLoot is { Count: > 0 })
                        {
                            cannon.OpenedAt ??= _time;
                            cannon.Action = "fired";
                            cannon.Evidence = "SpawnedPickupLoot";
                            cannon.Attribution = "unknown";
                            foreach (var guid in cannonLoot) _cannonLoot.TryAdd(guid, cannon.Id);
                        }
                        else if (fired.HasValue)
                        {
                            UpdateChest(actor, type, cannon.Position, searcher, fired, null, null, true);
                        }
                        break;
                    case Kind.Pickup:
                        UpdatePickup(actor, item, owner, count, tossed, picked, ToPosition(location ?? channel.Actor?.Location));
                        break;
                    case Kind.Pawn when playerState is > 0:
                    {
                        if (_pawns.TryGetValue(actor, out var previous) && previous != playerState.Value)
                            _ambiguousPawns.Add(actor);
                        _pawns[actor] = playerState.Value;
                        break;
                    }
                    case Kind.PlayerState:
                        if (!_players.TryGetValue(actor, out var player)) _players[actor] = player = new Player();
                        player.Alias = name ?? player.Alias;
                        player.Team = team ?? player.Team;
                        player.Squad = squad ?? player.Squad;
                        player.TeamActor = teamActor ?? player.TeamActor;
                        player.Spectator = spectator ?? player.Spectator;
                        player.Account = account ?? player.Account;
                        break;
                    case Kind.GameState when playerState is > 0:
                        _recorder ??= playerState;
                        break;
                    case Kind.Controller when playerState is > 0:
                        _controller ??= playerState;
                        break;
                }
                return true;
            }

            var size = (int)archive.ReadIntPacked();
            var start = archive.GetBitsLeft();
            if (size < 0 || size > start || archive.IsError) return false;
            var field = group.IsValidIndex(handle - 1) ? group.NetFieldExports[handle - 1]?.Name : null;
            if (field is not null && size > 0)
            {
                fields.Add(field);
                switch (kind, field)
                {
                    case (Kind.Chest, "bAlreadySearched") when size == 1: searched = archive.ReadBit(); break;
                    case (Kind.Chest, "bDestroyed") when size == 1: destroyed = archive.ReadBit(); break;
                    case (Kind.Chest or Kind.Cannon, "SearchingPawn") when ObjectSize(size): searcher = archive.ReadIntPacked(); break;
                    case (Kind.Cannon, "SingleUseLootCannonFired") when size == 1: fired = archive.ReadBit(); break;
                    case (Kind.Chest, "ChestCurrentLoc"): location = archive.ReadPackedVector(1, 24); break;
                    case (Kind.Cannon, "SpawnedPickupLoot") when size <= 4096 && Replay.Header.Branch == "++Fortnite+Release-43.00":
                        cannonLoot = ReadCannonLoot(archive.ReadBits(size), size);
                        break;
                    case (Kind.Chest, "SearchAnimationCount") when size <= 32: animation = archive.ReadBitsToInt(size); break;
                    case (Kind.Pawn or Kind.Controller, "PlayerState") when ObjectSize(size): playerState = archive.ReadIntPacked(); break;
                    case (Kind.GameState, "RecorderPlayerState") when ObjectSize(size): playerState = archive.ReadIntPacked(); break;
                    case (Kind.PlayerState, "TeamIndex") when size <= 16:
                        var index = archive.ReadBitsToInt(size);
                        if (index > 0) team = index;
                        break;
                    case (Kind.PlayerState, "SquadId") when size == 8: squad = archive.ReadByte(); break;
                    case (Kind.PlayerState, "PlayerTeamPrivate") when ObjectSize(size):
                        var teamGuid = archive.ReadIntPacked();
                        if (teamGuid > 1) teamActor = teamGuid;
                        break;
                    case (Kind.PlayerState, "bOnlySpectator") when size == 1: spectator = archive.ReadBit(); break;
                    case (Kind.PlayerState, "UniqueID" or "UniqueId") when size is >= 16 and <= 512:
                        account = ReadAccount(archive.ReadBits(size), size);
                        break;
                    case (Kind.PlayerState, "PlayerNamePrivate") when size is >= 40 and <= 2080:
                        name = ReadName(archive, size);
                        break;
                    case (Kind.Pickup, "ItemDefinition") when ObjectSize(size): item = archive.ReadIntPacked(); break;
                    case (Kind.Pickup, "Owner") when ObjectSize(size): owner = archive.ReadIntPacked(); break;
                    case (Kind.Pickup, "Count") when size == 32: count = archive.ReadInt32(); break;
                    case (Kind.Pickup, "bTossedFromContainer") when size == 1: tossed = archive.ReadBit(); break;
                    case (Kind.Pickup, "bPickedUp") when size == 1: picked = archive.ReadBit(); break;
                    case (Kind.Pickup, "LootInitialPosition"): location = archive.ReadPackedVector(10, 24); break;
                }
            }
            var remaining = size - (start - archive.GetBitsLeft());
            if (remaining < 0 || archive.IsError) return false;
            archive.SkipBits(remaining);
        }
        return false;
    }

    // UE replay dynamic array: length, changed index, property handle, bit count, value.
    // 43.00 serializes the pickup object reference at handle 46 in this array.
    private static List<uint> ReadCannonLoot(ReadOnlySpan<byte> bytes, int bits)
    {
        var reader = new NetBitReader();
        reader.FillBuffer(bytes.ToArray());
        var length = reader.ReadIntPacked();
        if (length > 128) return null;
        var actors = new List<uint>();
        while (reader.Position + 8 <= bits)
        {
            var index = reader.ReadIntPacked();
            if (index == 0) return reader.Position == bits ? actors : null;
            if (index > length) return null;
            while (reader.Position + 8 <= bits)
            {
                var handle = reader.ReadIntPacked();
                if (handle == 0) break;
                var size = (int)reader.ReadIntPacked();
                var start = reader.Position;
                if (size < 0 || size > bits - start) return null;
                if (handle == 46 && ObjectSize(size))
                {
                    var actor = reader.ReadIntPacked();
                    if (reader.Position - start != size) return null;
                    if (actor > 0) actors.Add(actor);
                }
                reader.Seek(start + size, SeekOrigin.Begin);
            }
        }
        return null;
    }

    private static string ReadAccount(ReadOnlySpan<byte> bytes, int bits)
    {
        var reader = new NetBitReader();
        reader.FillBuffer(bytes, bits);
        var id = reader.SerializePropertyNetId();
        return !reader.IsError && reader.AtEnd() && id is { Length: 32 }
            && id.All(Uri.IsHexDigit) && id.Any(c => c != '0') ? id : null;
    }

    private static bool ObjectSize(int size) => size is >= 8 and <= 40 && size % 8 == 0;

    private static string ReadName(FBitArchive archive, int bits)
    {
        archive.Mark();
        var count = (long)archive.ReadInt32();
        archive.Pop();
        var bytes = count < 0 ? -2 * count : count;
        if (bytes == 0 || 32 + bytes * 8 != bits) return null;
        return CleanName(archive.ReadFString());
    }

    private static string CleanName(string name) => string.IsNullOrWhiteSpace(name)
        || name.Length > 96 || name.Any(c => char.IsControl(c) || c == '\uFFFD') ? null : name;

    private static string ShortName(string path)
    {
        var name = path[(path.LastIndexOf('.') + 1)..];
        return name.EndsWith("_C", StringComparison.Ordinal) ? name[..^2] : name;
    }

    private static Position ToPosition(FVector vector) => vector is not null && double.IsFinite(vector.X)
        && double.IsFinite(vector.Y) && double.IsFinite(vector.Z) ? new(vector.X, vector.Y, vector.Z) : null;

    private Chest FindChest(uint actor, string type, Position position)
    {
        if (_chestIds.TryGetValue(actor, out var known)) return _chests[known];
        Chest chest = null;
        if (_netGuidCache.TryGetPathName(actor, out var name) && !string.IsNullOrEmpty(name))
        {
            if (!_chests.TryGetValue(name, out chest)) chest = new Chest(name, type, position);
        }
        else if (position is not null)
        {
            // Exact quantized horizontal spawn coordinates, with a small tolerance for replication rounding.
            // Z can change when a buried chest is revealed.
            var x = (int)Math.Floor(position.X / 25);
            var y = (int)Math.Floor(position.Y / 25);
            for (var dx = -1; dx <= 1 && chest is null; dx++)
            for (var dy = -1; dy <= 1 && chest is null; dy++)
                if (_spawnCells.TryGetValue((type, x + dx, y + dy), out var nearby))
                    chest = nearby.Find(c => Math.Abs(c.Position.X - position.X) <= 15
                        && Math.Abs(c.Position.Y - position.Y) <= 15);
            if (chest is null)
            {
                chest = new Chest($"net:{actor}", type, position);
                if (!_spawnCells.TryGetValue((type, x, y), out var bucket))
                    _spawnCells[(type, x, y)] = bucket = [];
                bucket.Add(chest);
            }
        }
        else chest = new Chest($"net:{actor}", type, null);
        _chestIds[actor] = chest.Id;
        _chests.TryAdd(chest.Id, chest);
        return chest;
    }

    private void UpdateChest(uint actor, string type, Position position, uint? pawn, bool? searched, bool? destroyed, int? animation, bool cannon)
    {
        var chest = FindChest(actor, type, position);
        if (_trace && (type.Contains("Cannon") || chest.Id.EndsWith("1911495771") || chest.Id.EndsWith("1430745799") || chest.Id.EndsWith("1727209515")))
            Console.Error.WriteLine($"ACTOR {_time} {actor} {chest.Id} {pawn} {searched} {destroyed} {animation}");
        var earlierObservation = _time - chest.LastSeenAt > 0.25f;
        chest.LastSeenAt = _time;
        if (chest.OpenedAt.HasValue || chest.PreviouslyOpen) return;
        var precedingSearcher = _time - chest.SearcherAt <= 2.5f ? chest.Searcher : null;
        if (pawn.HasValue)
        {
            chest.Searcher = pawn > 0 ? pawn : null;
            chest.SearcherAt = _time;
        }
        var broken = destroyed == true && searched != true && animation > 0 && pawn is > 0;
        var opens = searched == true || animation > 0;
        if (!opens)
        {
            if (searched == false || animation == 0 || pawn > 0) chest.WasClosed = true;
            return;
        }

        if (destroyed == true && searched != true && !broken) return;
        if (!chest.WasClosed && !earlierObservation && pawn is not > 0)
        {
            // A replicated snapshot already open says nothing about when it opened.
            chest.PreviouslyOpen = true;
            return;
        }
        chest.OpenedAt = _time;
        chest.OpeningPawn = pawn is > 0 ? pawn : pawn.HasValue ? null : precedingSearcher;
        chest.Action = cannon ? "fired" : broken ? "broken" : "opened";
        chest.Attribution = pawn is > 0 ? "confirmed" : chest.OpeningPawn.HasValue ? "inferred" : "unknown";
        chest.Evidence = cannon ? "SingleUseLootCannonFired" : broken ? "bDestroyed + SearchAnimationCount" :
            searched == true ? "bAlreadySearched" : "SearchAnimationCount";
    }

    private void UpdatePickup(uint actor, uint? item, uint? owner, int? count, bool? tossed, bool? picked, Position position)
    {
        if (!_pickups.TryGetValue(actor, out var data))
        {
            if (_pickups.Count >= 60000) throw new InvalidDataException("Límite de actores de objetos alcanzado.");
            _pickups[actor] = data = new Pickup(actor, _time, position);
        }
        if (item is > 0) data.Item = item;
        if (data.Item is uint key && !_itemNames.ContainsKey(key) && _netGuidCache.TryGetPathName(key, out var id))
            _itemNames[key] = id;
        if (count > 0) data.Count = count;
        if (picked == true) data.Picked = true;
        else if (picked == false) data.Picked ??= false;
        if (tossed.HasValue) data.Tossed = tossed;
        if (owner > 0) data.Owner = owner;
        data.Position ??= position;
    }

    private void Finish()
    {
        var recorder = _recorder ?? _controller;
        var player = recorder is uint r ? _players.GetValueOrDefault(r) : null;
        _result.RecorderName = player?.Alias;
        _result.RecorderTeam = player?.Team;
        var squad = ResolveSquad(recorder, player);
        _result.ChestActorsObserved = _chests.Count;
        foreach (var chest in _chests.Values.Where(c => c.OpenedAt.HasValue).OrderBy(c => c.OpenedAt))
        {
            uint? playerId = chest.OpeningPawn is uint pawn && !_ambiguousPawns.Contains(pawn)
                && _pawns.TryGetValue(pawn, out var playerState) ? playerState : null;
            var other = playerId is uint id ? _players.GetValueOrDefault(id) : null;
            var isRecorder = playerId.HasValue && playerId == recorder;
            var role = isRecorder ? "recorder" : playerId.HasValue && squad.Contains(playerId.Value) ? "squad"
                : player?.Team is int myTeam && other?.Team is int otherTeam && myTeam != otherTeam ? "other" : "unknown";
            _result.Chests.Add(new Opening(chest.Id, chest.Type, chest.OpenedAt.Value, chest.Position, playerId, other?.Alias,
                isRecorder, playerId.HasValue ? chest.Attribution : "unknown", chest.Evidence, chest.Action, role));
        }

        foreach (var pickup in _pickups.Values)
        {
            if (pickup.Item is not uint item) continue;
            var name = _itemNames.GetValueOrDefault(item);
            if (name is null && !_netGuidCache.TryGetPathName(item, out name)) continue;
            if (string.IsNullOrWhiteSpace(name)) continue;
            string sourceEvidence = null;
            string chestId = null;
            if (_cannonLoot.TryGetValue(pickup.Actor, out var cannon) &&
                _chests[cannon].OpenedAt is float fired && Math.Abs(fired - pickup.Time) <= 2)
            {
                chestId = cannon;
                sourceEvidence = "SpawnedPickupLoot";
            }
            else if (pickup.Tossed == true && pickup.Owner is uint owner && _chestIds.TryGetValue(owner, out var id)
                && _chests[id].OpenedAt is float opened && Math.Abs(opened - pickup.Time) <= 2)
            {
                chestId = id;
                sourceEvidence = "Owner + bTossedFromContainer";
            }
            _result.Items.Add(new Loot(pickup.Actor, name, pickup.Time, pickup.Position, pickup.Count,
                pickup.Picked, pickup.Tossed, chestId, sourceEvidence));
        }
        if (_trace)
            foreach (var (path, group) in _netGuidCache.NetFieldExportGroupMap)
            {
                var interesting = group.NetFieldExports.Where(f => f?.Name is "bAlreadySearched" or "SearchingPawn"
                    or "SingleUseLootCannonFired" or "SpawnedPickupLoot").Select(f => f.Name).Distinct();
                if (interesting.Any() || path.Contains("Confetti", StringComparison.OrdinalIgnoreCase))
                    Console.Error.WriteLine($"GROUP {path} {string.Join(',', interesting)}");
            }
        foreach (var (group, fields) in _fields)
            _result.Schema[group] = fields.Order(StringComparer.Ordinal).ToArray();
    }

    private HashSet<uint> ResolveSquad(uint? recorder, Player player)
    {
        var members = new HashSet<uint>();
        if (recorder is not uint owner) return members;
        var accounts = _players.Values.Where(p => p.Account is not null)
            .GroupBy(p => p.Account, StringComparer.Ordinal).Where(g => g.Count() == 1)
            .Select(g => g.Key).ToHashSet(StringComparer.Ordinal);
        var candidates = _players.ToDictionary();
        candidates.TryAdd(owner, new Player());
        _result.SquadEvidence = player?.Team is not null ? "TeamIndex" :
            player?.TeamActor is not null ? "PlayerTeamPrivate" : null;
        foreach (var (id, candidate) in candidates)
        {
            var evidence = id == owner ? "RecorderPlayerState" : SquadLink(player, candidate);
            if (evidence is null) continue;
            members.Add(id);
            var key = candidate.Account is not null && accounts.Contains(candidate.Account)
                ? _accountKey(candidate.Account) : null;
            _result.Squad.Add(new SquadMember(id, candidate.Alias, id == owner, key, evidence));
            if (_trace)
                Console.Error.WriteLine($"SQUAD {id} {candidate.Team} {candidate.Squad} {candidate.TeamActor} {key} {evidence}");
        }
        return members;
    }

    private static string SquadLink(Player owner, Player other)
    {
        if (owner is null || other.Spectator == true) return null;
        var bothSquads = owner.Squad is > 0 && other.Squad is > 0;
        if (bothSquads && owner.Squad != other.Squad) return null;
        if (owner.Team is int team && other.Team is int otherTeam)
            return team == otherTeam ? bothSquads ? "TeamIndex + SquadId" : "TeamIndex" : null;
        return owner.TeamActor is uint teamActor && other.TeamActor == teamActor ? "PlayerTeamPrivate" : null;
    }

    protected override void OnExternalDataRead(uint channelIndex, IExternalData data) { }
    protected override void OnExportRead(uint channelIndex, INetFieldExportGroup exportGroup) { }
    protected override void OnNetDeltaRead(uint channelIndex, NetDeltaUpdate update) { }

    private sealed class DecodeLog : ILogger
    {
        public int Errors;
        public IDisposable BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Error;
        public void Log<TState>(LogLevel level, EventId eventId, TState state, Exception exception,
            Func<TState, Exception, string> formatter)
        {
            if (level >= LogLevel.Error) Errors++;
        }
    }

    private sealed class Chest(string id, string type, Position position)
    {
        public string Id { get; } = id;
        public string Type { get; } = type;
        public Position Position { get; } = position;
        public bool WasClosed, PreviouslyOpen;
        public uint? Searcher, OpeningPawn;
        public float SearcherAt;
        public float LastSeenAt = float.PositiveInfinity;
        public float? OpenedAt;
        public string Attribution, Evidence, Action;
    }

    private sealed class Player
    {
        public string Alias, Account;
        public int? Team, Squad;
        public uint? TeamActor;
        public bool? Spectator;
    }

    private sealed class Pickup(uint actor, float time, Position position)
    {
        public uint Actor { get; } = actor;
        public float Time { get; } = time;
        public Position Position = position;
        public uint? Item, Owner;
        public int? Count;
        public bool? Picked, Tossed;
    }
}





