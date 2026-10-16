param(
    [string]$OutputPath = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'Dongo-Storefront-handoff-final.zip')
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("dongo-handoff-" + [guid]::NewGuid().ToString('N'))
$temporaryArchive = Join-Path $outputDirectory ('.Dongo-Storefront-handoff-' + [guid]::NewGuid().ToString('N') + '.tmp.zip')
$previousOutput = Join-Path $outputDirectory ('.Dongo-Storefront-handoff-' + [guid]::NewGuid().ToString('N') + '.previous.zip')
$handoffCompleted = $false

function Copy-HandoffFile([string]$RelativePath) {
    $source = Join-Path $root $RelativePath
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required handoff file is missing: $RelativePath"
    }

    $target = Join-Path $staging $RelativePath
    $targetDirectory = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $targetDirectory)) {
        New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
    }
    Copy-Item -LiteralPath $source -Destination $target
}

function Copy-HandoffDirectory([string]$RelativePath) {
    $sourceDirectory = Join-Path $root $RelativePath
    if (-not (Test-Path -LiteralPath $sourceDirectory -PathType Container)) {
        throw "Required handoff directory is missing: $RelativePath"
    }

    Get-ChildItem -LiteralPath $sourceDirectory -File -Recurse -Force | ForEach-Object {
        $relativeFile = $_.FullName.Substring($root.Length + 1)
        if ($relativeFile -match '(^|[\\/])(\.env($|\.(?!example$))|node_modules|dist|dist-ssr|data|backups?|secrets?|credentials?)([\\/]|$)' -or
            $relativeFile -match '\.env\.(?!example$)' -or
            $_.Extension -match '^\.(sqlite3?|db|bak|backup|log|pem|key|crt|cer|der|p12|pfx|zip|secret|credentials)$' -or
            $_.Name -match '\.sqlite-(shm|wal|journal)$') {
            throw "Refusing to package excluded file: $relativeFile"
        }

        Copy-HandoffFile $relativeFile
    }
}

try {
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    }
    if (Test-Path -LiteralPath $resolvedOutput -PathType Container) {
        throw "Output path is a directory, not a ZIP file: $resolvedOutput"
    }

    New-Item -ItemType Directory -Path $staging | Out-Null

    @(
        '.gitignore',
        'README.md',
        'FINAL-UX-TEST-REPORT.md',
        'package.json',
        'package-lock.json',
        'backend/.env.example',
        'backend/package.json',
        'frontend/.env.example',
        'frontend/.oxlintrc.json',
        'frontend/index.html',
        'frontend/package.json',
        'frontend/tsconfig.json',
        'frontend/tsconfig.app.json',
        'frontend/tsconfig.node.json',
        'frontend/vite.config.ts'
    ) | ForEach-Object { Copy-HandoffFile $_ }

    @('backend/server', 'frontend/src', 'frontend/public', 'scripts', 'docs') |
        ForEach-Object { Copy-HandoffDirectory $_ }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($temporaryArchive, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem -LiteralPath $staging -File -Recurse -Force | ForEach-Object {
            $relativeFile = $_.FullName.Substring($staging.Length + 1).Replace('\', '/')
            $entryName = "Dongo-Storefront/$relativeFile"
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                $_.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally {
        $archive.Dispose()
    }

    $verification = [System.IO.Compression.ZipFile]::OpenRead($temporaryArchive)
    try {
        $entries = @($verification.Entries | ForEach-Object { $_.FullName })
        $forbidden = @($entries | Where-Object {
            $_ -match '(^|/)\.env($|\.(?!example$))' -or
            $_ -match '\.env\.(?!example$)' -or
            $_ -match '(^|/)(node_modules|dist|dist-ssr|data|backups?|secrets?|credentials?)(/|$)' -or
            $_ -match '\.(sqlite3?|db|bak|backup|log|pem|key|crt|cer|der|p12|pfx|zip|secret|credentials)$' -or
            $_ -match '\.sqlite-(shm|wal|journal)$'
        })
        if ($forbidden.Count -gt 0) {
            throw "Handoff archive contains forbidden entries: $($forbidden -join ', ')"
        }
        foreach ($requiredFile in @(
            'Dongo-Storefront/README.md',
            'Dongo-Storefront/package.json',
            'Dongo-Storefront/package-lock.json',
            'Dongo-Storefront/backend/.env.example',
            'Dongo-Storefront/backend/server/app.js',
            'Dongo-Storefront/backend/server/app.test.js',
            'Dongo-Storefront/frontend/.env.example',
            'Dongo-Storefront/frontend/src/App.tsx',
            'Dongo-Storefront/scripts/Manage-SqliteDatabase.ps1',
            'Dongo-Storefront/scripts/sqlite-maintenance.mjs',
            'Dongo-Storefront/docs/HUONG_DAN_TRIEN_KHAI_VA_QUAN_TRI.md',
            'Dongo-Storefront/docs/NOI_DUNG_BAO_VE.md'
        )) {
            if ($requiredFile -notin $entries) {
                throw "Handoff archive is missing a required file: $requiredFile"
            }
        }
        $productImages = @($entries | Where-Object {
            $_ -match '^Dongo-Storefront/frontend/public/images/products/[^/]+$'
        })
        if ($productImages.Count -ne 8) {
            throw "Handoff archive must contain exactly 8 product images; found $($productImages.Count)."
        }
    } finally {
        $verification.Dispose()
    }

    $verifiedArchiveHash = (Get-FileHash -LiteralPath $temporaryArchive -Algorithm SHA256).Hash
    if (Test-Path -LiteralPath $resolvedOutput -PathType Leaf) {
        [System.IO.File]::Replace($temporaryArchive, $resolvedOutput, $previousOutput)
        $installedArchiveHash = (Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256).Hash
        if ($installedArchiveHash -ne $verifiedArchiveHash) {
            [System.IO.File]::Replace($previousOutput, $resolvedOutput, $temporaryArchive)
            throw 'Installed ZIP hash differs from the verified archive; previous output was restored.'
        }
        $handoffCompleted = $true
        Remove-Item -LiteralPath $previousOutput -Force
    } else {
        [System.IO.File]::Move($temporaryArchive, $resolvedOutput)
        $handoffCompleted = $true
    }

    Write-Output "Created and verified: $resolvedOutput"
    Write-Output "SHA-256: $verifiedArchiveHash"
    Write-Output "Entries: $($entries.Count)"
    $entries | Sort-Object
} finally {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
    if (Test-Path -LiteralPath $temporaryArchive) {
        Remove-Item -LiteralPath $temporaryArchive -Force
    }
    if ($handoffCompleted -and (Test-Path -LiteralPath $previousOutput)) {
        Remove-Item -LiteralPath $previousOutput -Force
    }
}
