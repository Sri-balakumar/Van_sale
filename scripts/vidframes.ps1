<#
.SYNOPSIS
  Extract PNG frames from a screen recording using VLC.

.DESCRIPTION
  This machine has no ffmpeg and no python, only VLC. VLC can do it via its
  `scene` video filter, with one trap worth remembering:

      --vout=dummy SILENTLY DISABLES the scene filter.

  VLC then decodes the whole file, reports nothing wrong, and writes zero
  frames. So this script deliberately does NOT pass --vout=dummy and lets VLC
  use the real video output. The `avcodec ... dropping frame (computer too
  slow?)` and `direct3d11 vout display error` lines it prints are normal here
  and do not mean failure.

.EXAMPLE
  ./scripts/vidframes.ps1 -Video "C:\Users\me\Downloads\rec.mp4"
  ./scripts/vidframes.ps1 -Video rec.mp4 -Ratio 15          # more frames
  ./scripts/vidframes.ps1 -Video rec.mp4 -Start 30 -Stop 90 # just that window
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Video,

    # Keep every Nth frame. Lower = more frames. 90 gave ~50 frames on a
    # 3-minute 30fps recording; 30 gives roughly 3x that.
    [int] $Ratio = 30,

    # Where the PNGs land. Emptied on every run.
    [string] $Out = "$env:TEMP\vidframes",

    # Optional window of the video, in seconds. 0 = from start / to end.
    [int] $Start = 0,
    [int] $Stop = 0
)

$ErrorActionPreference = 'Stop'

# ── Resolve inputs ────────────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $Video)) {
    Write-Error "Video not found: $Video"
    exit 1
}
$videoPath = (Resolve-Path -LiteralPath $Video).Path

$vlc = @(
    "$env:ProgramFiles\VideoLAN\VLC\vlc.exe",
    "${env:ProgramFiles(x86)}\VideoLAN\VLC\vlc.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $vlc) {
    Write-Error "vlc.exe not found. Install VLC or add it to one of the standard Program Files locations."
    exit 1
}

# ── Prepare the output directory ──────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $Out)) {
    New-Item -ItemType Directory -Force -Path $Out | Out-Null
}
Get-ChildItem -LiteralPath $Out -Filter *.png -File -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

# ── Build the VLC arguments ───────────────────────────────────────────────────
# NOTE: no --vout=dummy. See the comment at the top of this file.
$vlcArgs = @(
    '-I', 'dummy'
    '--no-audio'
    '--play-and-exit'
    '--video-filter=scene'
    '--scene-format=png'
    "--scene-ratio=$Ratio"
    '--scene-prefix=f'
    "--scene-path=$Out"
)
if ($Start -gt 0) { $vlcArgs += "--start-time=$Start" }
if ($Stop  -gt 0) { $vlcArgs += "--stop-time=$Stop" }
$vlcArgs += $videoPath

Write-Output "Extracting frames (every ${Ratio}th) from: $videoPath"
Write-Output "Into: $Out"

$sw = [System.Diagnostics.Stopwatch]::StartNew()

# VLC writes its progress/decoder noise to stderr; none of it is fatal here, so
# swallow it and judge success purely by how many PNGs landed.
& $vlc @vlcArgs 2>&1 | Out-Null

$sw.Stop()

# ── Report ────────────────────────────────────────────────────────────────────
$frames = @(Get-ChildItem -LiteralPath $Out -Filter *.png -File | Sort-Object Name)

if ($frames.Count -eq 0) {
    Write-Warning "No frames were written."
    Write-Warning "If this script was edited, check that --vout=dummy was not reintroduced - it disables the scene filter silently."
    exit 1
}

$secs = [math]::Round($sw.Elapsed.TotalSeconds, 1)
Write-Output ""
Write-Output "$($frames.Count) frames in ${secs}s"
Write-Output "First: $($frames[0].FullName)"
Write-Output "Last:  $($frames[-1].FullName)"
