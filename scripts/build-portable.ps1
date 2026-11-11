param([string]$OutputPath)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$root = (Get-Location).Path
$version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$') { throw 'Versión de paquete inválida.' }
$packageName = "Fortnite-Chest-Analyzer-v$version"
$env:DOTNET_CLI_HOME = Join-Path $root '.research/dotnet'
$env:NUGET_PACKAGES = Join-Path $root '.research/packages'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
if (!(Test-Path -LiteralPath 'dist/index.html')) { throw 'Primero ejecuta npm run build.' }

New-Item -ItemType Directory -Force -Path 'portable/dist' | Out-Null
$oldReader = Join-Path $root 'portable/replay.exe'
if (Test-Path -LiteralPath $oldReader -PathType Leaf) { Remove-Item -LiteralPath $oldReader }
dotnet publish launcher/LocalReplayHost.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o portable
if ($LASTEXITCODE -ne 0) { throw 'Error al compilar el lanzador.' }
$project = [xml](Get-Content -LiteralPath 'launcher/LocalReplayHost.csproj' -Raw)
$webViewVersion = ($project.Project.ItemGroup.PackageReference | Where-Object Include -eq 'Microsoft.Web.WebView2').Version
$webViewPackage = Join-Path $env:NUGET_PACKAGES "microsoft.web.webview2/$webViewVersion"
New-Item -ItemType Directory -Path 'portable/licenses' -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $webViewPackage 'runtimes/win-x64/native/WebView2Loader.dll') -Destination 'portable/WebView2Loader.dll' -Force
Copy-Item -LiteralPath (Join-Path $webViewPackage 'LICENSE.txt') -Destination 'portable/licenses/Microsoft-WebView2-SDK-LICENSE.txt' -Force
Copy-Item -LiteralPath (Join-Path $webViewPackage 'NOTICE.txt') -Destination 'portable/licenses/Microsoft-WebView2-SDK-NOTICE.txt' -Force
$rustc = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cargo/bin/rustc.exe'
if (!(Test-Path -LiteralPath $rustc)) { $rustc = 'rustc' }
& $rustc --edition 2024 -C opt-level=s -C strip=symbols -C panic=abort -C link-arg=/DEBUG:NONE --target x86_64-pc-windows-msvc launcher/open_overlay.rs -o 'portable/Abrir overlay.exe'
if ($LASTEXITCODE -ne 0) { throw 'Error al compilar el acceso directo del overlay.' }
$oldSymbols = Join-Path $root 'portable/Abrir overlay.pdb'
if (Test-Path -LiteralPath $oldSymbols -PathType Leaf) { Remove-Item -LiteralPath $oldSymbols }

tar.exe -a -c -f dist/fuente.zip --exclude='parser/bin' --exclude='launcher/bin' --exclude='tests/bin' --exclude='*/obj' --exclude='engine-rust/target' --exclude='public/engine' -- README.md README.es.md INVESTIGACION.md LICENSE package.json package-lock.json index.html tsconfig.json vite.config.ts docs src public scripts parser engine-rust launcher tests
if ($LASTEXITCODE -ne 0) { throw 'Error al empaquetar el código fuente.' }

$webRoot = (Resolve-Path -LiteralPath 'portable/dist').ProviderPath
$expectedWebRoot = Join-Path $root 'portable\dist'
if ($webRoot -ne $expectedWebRoot) { throw 'La carpeta de destino portable no coincide con la ruta esperada.' }
Get-ChildItem -LiteralPath $webRoot -Force | ForEach-Object {
    $target = (Resolve-Path -LiteralPath $_.FullName).ProviderPath
    if (!$target.StartsWith($webRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'La ruta generada está fuera de la carpeta portable.'
    }
    Remove-Item -LiteralPath $target -Recurse -Force
}
Get-ChildItem -LiteralPath 'dist' | Copy-Item -Destination 'portable/dist' -Recurse -Force
Copy-Item -LiteralPath 'README.md' -Destination 'portable/README.md' -Force
Copy-Item -LiteralPath 'README.es.md' -Destination 'portable/LEEME.md' -Force
Copy-Item -LiteralPath 'README.es.md' -Destination 'portable/README.es.md' -Force
Copy-Item -LiteralPath 'docs' -Destination 'portable' -Recurse -Force
Copy-Item -LiteralPath 'INVESTIGACION.md' -Destination 'portable/INVESTIGACION.md' -Force
Copy-Item -LiteralPath 'LICENSE' -Destination 'portable/LICENSE' -Force

# Give every entry the same versioned root, including when using "Extract here".
$portableRoot = (Resolve-Path -LiteralPath 'portable').ProviderPath
$temporaryZip = Join-Path $root ".research/portable-$([guid]::NewGuid()).zip"
$archive = [IO.Compression.ZipFile]::Open($temporaryZip, [IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem -LiteralPath $portableRoot -Recurse -File | ForEach-Object {
        $relativePath = [IO.Path]::GetRelativePath($portableRoot, $_.FullName).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $_.FullName, "$packageName/$relativePath", [IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $archive.Dispose()
}
if (!$OutputPath) { $OutputPath = Join-Path $root "$packageName-Windows-x64.zip" }
Move-Item -LiteralPath $temporaryZip -Destination $OutputPath -Force


