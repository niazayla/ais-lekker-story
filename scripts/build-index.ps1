# Rebuild index.html from partials/body.html after editing views
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$head = Get-Content "scripts\index-head.html" -Raw -Encoding UTF8
$body = Get-Content "partials\body.html" -Raw -Encoding UTF8
$foot = @'

    <script>
        (function () {
            function showLoaderError(message) {
                var err = document.getElementById('loader-file-error');
                var spin = document.getElementById('loader-spinner');
                var status = document.getElementById('loader-status');
                if (spin) spin.classList.add('hide');
                if (status) status.textContent = message || 'Application could not start';
                if (err) err.classList.remove('hide');
            }
            if (location.protocol === 'file:') {
                showLoaderError('Use a local web server (see below)');
                return;
            }
            window.addEventListener('error', function (e) {
                if (e.filename && e.filename.indexOf('app.js') !== -1) {
                    showLoaderError('Failed to load app.js — use http://localhost, not file://');
                }
            });
            setTimeout(function () {
                var loader = document.getElementById('app-loader');
                if (loader && !loader.classList.contains('hide')) {
                    showLoaderError('Loading timed out — run start-server.bat or python -m http.server 8080');
                }
            }, 15000);
        })();
    </script>
    <script type="module" src="assets/js/app.js"></script>
</body>
</html>

'@

if (-not (Test-Path "scripts\index-head.html")) {
    Write-Error "Missing scripts/index-head.html"
    exit 1
}

($head + $body + $foot) | Set-Content "index.html" -Encoding UTF8
Write-Host "Built index.html"
