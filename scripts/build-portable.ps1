$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$root = (Get-Location).Path
$env:DOTNET_CLI_HOME = Join-Path $root '.research/dotnet'
$env:NUGET_PACKAGES = Join-Path $root '.research/packages'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
if (!(Test-Path -LiteralPath 'dist/index.html')) { throw 'Primero ejecuta npm run build.' }

New-Item -ItemType Directory -Force -Path 'portable/dist' | Out-Null
dotnet publish launcher/LocalReplayHost.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o portable
if ($LASTEXITCODE -ne 0) { throw 'Error al compilar el lanzador.' }

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

tar.exe -a -c -f Fortnite-Chest-Analyzer-Windows-x64.zip -C portable -- .
if ($LASTEXITCODE -ne 0) { throw 'Error al empaquetar la aplicación portable.' }


