# Build the Van Sale user manual: van-sale-user-manual.md -> .docx -> .pdf
#
#   powershell -File documents\manual\build-manual.ps1
#   powershell -File documents\manual\build-manual.ps1 -RenderOnly
#
# Two stages, and they must not share a process.
#
# Stage 1 is python-docx writing the .docx. Stage 2 is Word, driven over COM,
# rendering that .docx to PDF. Running both in one PowerShell process makes the
# Word stage hang indefinitely without ever emitting a PDF, so the default run
# does stage 1 and then re-invokes this same script with -RenderOnly in a fresh
# process to do stage 2.

param(
  # Skip generation and only run the Word -> PDF stage. This is how the script
  # re-enters itself; it is also useful on its own after hand-editing the .docx.
  [switch]$RenderOnly
)

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$base = Join-Path $here 'van-sale-user-manual'
$md   = "$base.md"
$docx = "$base.docx"
$pdf  = "$base.pdf"

# --------------------------------------------------------------------------
# Stage 1 - generate the .docx, then hand off to a clean process.
# --------------------------------------------------------------------------

if (-not $RenderOnly) {
  if (-not (Test-Path $md)) { throw "No manual source at $md" }

  # python-docx and Pillow live only on the 3.14 interpreter on this machine,
  # and there is no bare `python` on PATH - always go through the py launcher.
  Write-Host 'Generating the document...' -ForegroundColor Cyan
  & py -3.14 (Join-Path $here 'build_manual.py')
  if ($LASTEXITCODE -ne 0) { throw "build_manual.py failed with exit code $LASTEXITCODE" }

  Write-Host "`nRendering the PDF in a separate process..." -ForegroundColor Cyan
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -RenderOnly
  if ($LASTEXITCODE -ne 0) { throw "Render stage failed with exit code $LASTEXITCODE" }

  Write-Host "`nDone." -ForegroundColor Cyan
  Get-ChildItem $docx, $pdf |
    Format-Table Name, @{N = 'KB'; E = { [math]::Round($_.Length / 1KB, 1) } }, LastWriteTime -AutoSize
  return
}

# --------------------------------------------------------------------------
# Stage 2 - Word renders the PDF.
# --------------------------------------------------------------------------

if (-not (Test-Path $docx)) { throw "No document to render at $docx" }

# A Word that was killed rather than quit leaves entries under Resiliency, and
# every later automated start then blocks trying to recover them - with no
# visible window to dismiss the prompt on. Clearing these first makes the build
# repeatable after a crash instead of wedged.
foreach ($key in 'DisabledItems', 'StartupItems') {
  $path = "HKCU:\Software\Microsoft\Office\16.0\Word\Resiliency\$key"
  if (Test-Path $path) {
    Write-Host "  clearing Word resiliency: $key" -ForegroundColor DarkGray
    Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$wdFormatPDF = 17

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0   # wdAlertsNone - never block on a dialog

try {
  # ReadOnly, AddToRecentFiles:false - rendering must not be able to mutate the
  # generated document or clutter Word's recent-files list.
  $doc = $word.Documents.Open($docx, $false, $true, $false)
  try {
    # No Fields.Update() anywhere here. Called over the header/footer story it
    # never returns, because NUMPAGES re-triggers the pagination that is being
    # updated. ExportAsFixedFormat resolves both PAGE and NUMPAGES while it
    # renders, so the page numbers come out correct without touching them.
    #
    # Arguments, positionally:
    #   1  output path
    #   2  format            17 = PDF
    #   3  open after        false
    #   4  optimise for      1 = on-screen, which keeps the file small
    #   5-8 range/from/to/item   whole document, content only
    #   9  include doc props true
    #   10 keep IRM          true
    #   11 create bookmarks  1 = wdExportCreateHeadingBookmarks
    #
    # That eleventh argument is the one that matters and the one that is easy
    # to miss: it defaults to "no bookmarks", so the short four-argument form
    # produces a PDF with no navigation outline at all. With it set, the
    # Heading 1/2/3 styles behind the part banners, section headings and step
    # headings become the PDF's Part/Step outline.
    $doc.ExportAsFixedFormat($pdf, $wdFormatPDF, $false, 1, 0, 0, 0, 0, $true, $true, 1)
    Write-Host "  rendered $(Split-Path $pdf -Leaf)" -ForegroundColor Green
  } finally {
    $doc.Close($false)
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null
  }
} finally {
  # Always quit. A headless WINWORD.EXE left running silently adopts the next
  # build, and killing it is what writes the Resiliency entries cleared above.
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
