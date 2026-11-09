using System.Diagnostics;
using System.Net;

var root = Path.Combine(AppContext.BaseDirectory, "dist") + Path.DirectorySeparatorChar;
if (!File.Exists(Path.Combine(root, "index.html")))
{
    Console.Error.WriteLine("Falta la carpeta dist. Colócala junto al ejecutable.");
    return 1;
}

using var server = new HttpListener();
string? url = null;
for (var port = 18746; port < 18756; port++)
{
    var address = $"http://127.0.0.1:{port}/";
    server.Prefixes.Add(address);
    try
    {
        server.Start();
        url = address;
        break;
    }
    catch (HttpListenerException)
    {
        server.Prefixes.Remove(address);
    }
}

if (url is null)
{
    Console.Error.WriteLine("No se pudo abrir un puerto local entre 18746 y 18755.");
    return 1;
}

Console.WriteLine($"Fortnite Replay Analyzer — {url}");
Console.WriteLine("Cierra esta ventana para detener el servidor local.");
if (!args.Contains("--no-open", StringComparer.Ordinal))
{
    try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
    catch (System.ComponentModel.Win32Exception) { Console.WriteLine("Abre la dirección anterior en el navegador."); }
}

while (true)
{
    var context = await server.GetContextAsync();
    _ = Serve(context, root);
}

static async Task Serve(HttpListenerContext context, string root)
{
    using var response = context.Response;
    var request = context.Request;
    try
    {
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
