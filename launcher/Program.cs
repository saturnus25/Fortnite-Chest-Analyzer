using System.Diagnostics;
using System.Net;

var root = Path.Combine(AppContext.BaseDirectory, "dist") + Path.DirectorySeparatorChar;
if (!File.Exists(Path.Combine(root, "index.html")))
{
    Console.Error.WriteLine("Falta la carpeta dist. Colócala junto al ejecutable.");
    return 1;
}

if (args.Contains("--overlay-only", StringComparer.Ordinal)) return OverlayWindow.RunStandalone(root);

using var server = StartListener(out var url);
if (server is null)
{
    Console.Error.WriteLine("No se pudo abrir un puerto local entre 18746 y 18755. / Could not open a local port between 18746 and 18755.");
    return 1;
}

using var shutdown = new EventWaitHandle(false, EventResetMode.ManualReset, @"Local\FortniteChestAnalyzer.Shutdown.v1");
var stopped = Task.Run(() => shutdown.WaitOne());
using var overlay = new OverlayWindow();
Console.WriteLine($"Fortnite Chest Analyzer — {url}");
Console.WriteLine("Cierra esta ventana para detener el servidor local. / Close this window to stop the local server.");
if (!args.Contains("--no-open", StringComparer.Ordinal))
{
    try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
    catch (System.ComponentModel.Win32Exception) { Console.WriteLine("Abre la dirección anterior en el navegador."); }
}

while (!shutdown.WaitOne(0))
{
    var incoming = server.GetContextAsync();
    if (await Task.WhenAny(incoming, stopped) == stopped) break;
    _ = Serve(await incoming, root, url.TrimEnd('/'), shutdown, overlay);
}
return 0;

static HttpListener? StartListener(out string url)
{
    for (var port = 18746; port < 18756; port++)
    {
        var address = $"http://127.0.0.1:{port}/";
        var listener = new HttpListener();
        try
        {
            listener.Prefixes.Add(address);
            listener.Start();
            url = address;
            return listener;
        }
        catch (HttpListenerException)
        {
            // Start can dispose the listener on failure. Try the next port with a fresh instance.
            listener.Close();
        }
    }

    url = string.Empty;
    return null;
}

static async Task Serve(HttpListenerContext context, string root, string origin, EventWaitHandle shutdown, OverlayWindow overlay)
{
    using var response = context.Response;
    var request = context.Request;
    try
    {
        if (request.IsLocal && request.Url?.AbsolutePath == OverlayProtocol.Path)
        {
            response.Headers["Cache-Control"] = "no-store";
            if (request.HttpMethod == "HEAD")
            {
                response.Headers[OverlayProtocol.Header] = OverlayProtocol.Version;
                response.StatusCode = 204;
                return;
            }
            if (request.HttpMethod != "POST" || request.Headers["Origin"] != origin
                || request.Headers[OverlayProtocol.Header] != "overlay")
            {
                response.StatusCode = 403;
                return;
            }
            var reply = await OverlayProtocol.Handle(request.QueryString, overlay);
            response.StatusCode = reply.Status;
            await using var content = reply.Content;
            if (content is not null)
            {
                response.ContentType = reply.ContentType;
                response.ContentLength64 = content.Length;
                await content.CopyToAsync(response.OutputStream);
            }
            return;
        }

        if (request.IsLocal && request.Url?.AbsolutePath == "/__fortnite_chest_analyzer/shutdown")
        {
            response.Headers["Cache-Control"] = "no-store";
            if (request.HttpMethod == "HEAD")
            {
                response.Headers["X-Fortnite-Chest-Analyzer"] = "portable";
                response.StatusCode = 204;
                return;
            }
            if (request.HttpMethod != "POST" || request.Headers["Origin"] != origin
                || request.Headers["X-Fortnite-Chest-Analyzer"] != "shutdown")
            {
                response.StatusCode = 403;
                return;
            }
            response.StatusCode = 204;
            response.Close();
            shutdown.Set();
            return;
        }

        if (!request.IsLocal || request.HttpMethod is not ("GET" or "HEAD"))
        {
            response.StatusCode = 405;
            return;
        }

        var resource = Uri.UnescapeDataString(request.Url!.AbsolutePath);
        if (resource == "/") resource = "/index.html";
        if (resource.Contains('\\') || resource.Contains(':') || resource.Split('/').Any(part => part is "." or ".."))
        {
            response.StatusCode = 404;
            return;
        }

        var fullPath = Path.GetFullPath(Path.Combine(root, resource.TrimStart('/')));
        if (!fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(fullPath))
        {
            response.StatusCode = 404;
            return;
        }

        response.ContentType = Path.GetExtension(fullPath).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".wasm" => "application/wasm",
            ".svg" => "image/svg+xml",
            ".txt" or ".md" => "text/plain; charset=utf-8",
            ".json" => "application/json",
            ".zip" => "application/zip",
            _ => "application/octet-stream",
        };
        response.Headers["X-Content-Type-Options"] = "nosniff";
        response.Headers["Referrer-Policy"] = "no-referrer";
        response.Headers["Content-Security-Policy"] =
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'";
        response.Headers["Cache-Control"] = "no-cache";
        await using var input = File.OpenRead(fullPath);
        response.ContentLength64 = input.Length;
        if (request.HttpMethod == "GET") await input.CopyToAsync(response.OutputStream);
    }
    catch (Exception ex) when (ex is IOException or ArgumentException or HttpListenerException or UnauthorizedAccessException)
    {
        // Clients can close a connection while reading an asset.
    }
}
