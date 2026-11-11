using System.Web;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class EmbeddedOverlayBrowser
{
    private const string Host = "overlay.fortnite-chest-analyzer.local";
    private const string Origin = "https://" + Host;

    internal static async Task Start(Form window, string root, OverlayWindow overlay, Guid client, Action<string> showError)
    {
        var browser = new WebView2 { Bounds = new Rectangle(-8, -8, 1, 1), TabStop = false };
        window.Controls.Add(browser);
        try
        {
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FortniteChestAnalyzer", "OverlayWebView");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
            if (window.IsDisposed) return;
            await browser.EnsureCoreWebView2Async(environment);
            var core = browser.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.NavigationStarting += (_, e) => e.Cancel = !e.Uri.StartsWith(Origin + "/", StringComparison.Ordinal);
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.NavigationCompleted += (_, e) => { if (!e.IsSuccess) showError("Could not load the local replay engine."); };
            core.WebMessageReceived += (_, e) =>
            {
                if (e.Source.StartsWith(Origin + "/", StringComparison.Ordinal)) showError(e.TryGetWebMessageAsString());
            };
            core.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            core.WebResourceRequested += async (_, e) =>
            {
                using var deferral = e.GetDeferral();
                var request = e.Request;
                var address = new Uri(request.Uri);
                OverlayProtocol.Reply reply;
                try
                {
                    if (address.AbsolutePath == OverlayProtocol.Path)
                    {
                        var query = HttpUtility.ParseQueryString(address.Query);
                        reply = request.Method == "POST" && request.Headers.GetHeader(OverlayProtocol.Header) == "overlay"
                            && Guid.TryParse(query["client"], out var owner) && owner == client
                            ? await OverlayProtocol.Handle(query, overlay)
                            : new OverlayProtocol.Reply(403);
                    }
                    else reply = request.Method == "GET" ? OpenAsset(root, address) : new OverlayProtocol.Reply(405);
                }
                catch (Exception error) when (error is IOException or InvalidOperationException or UnauthorizedAccessException)
                {
                    reply = new OverlayProtocol.Reply(500);
                }
                if (window.IsDisposed)
                {
                    reply.Content?.Dispose();
                    return;
                }
                var headers = "Cache-Control: no-store\r\n";
                if (reply.Content is not null)
                    headers += $"Content-Type: {reply.ContentType}\r\nContent-Length: {reply.Content.Length}\r\n";
                e.Response = environment.CreateWebResourceResponse(reply.Content, reply.Status,
                    reply.Status == 204 ? "No Content" : reply.Status == 200 ? "OK" : "Unavailable", headers);
            };
            core.Navigate($"{Origin}/index.html?overlayClient={client:D}");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (!window.IsDisposed) showError("The Microsoft Edge WebView2 Runtime is required to open the standalone overlay.");
        }
        catch (Exception error) when (error is InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            if (!window.IsDisposed) showError("Could not initialize the local replay engine.");
        }
    }

    private static OverlayProtocol.Reply OpenAsset(string root, Uri address)
    {
        var resource = Uri.UnescapeDataString(address.AbsolutePath).TrimStart('/');
        if (resource.Contains('\\') || resource.Contains(':') || resource.Split('/').Any(part => part is "." or ".."))
            return new OverlayProtocol.Reply(404);
        var path = Path.GetFullPath(Path.Combine(root, resource));
        if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
            return new OverlayProtocol.Reply(404);
        var mime = Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".wasm" => "application/wasm",
            ".json" => "application/json",
            ".svg" => "image/svg+xml",
            _ => "application/octet-stream",
        };
        return new OverlayProtocol.Reply(200, File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete), mime);
    }
}
