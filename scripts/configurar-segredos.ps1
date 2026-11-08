$ErrorActionPreference = 'Stop'

$token = Read-Host 'Token do GitHub para o repositório privado' -AsSecureString
if ($token.Length -eq 0) { throw 'Informe o token do GitHub.' }

$key = Read-Host 'Crie a chave do organizador (pelo menos 20 caracteres)' -AsSecureString
if ($key.Length -lt 20) { throw 'Escolha uma chave com pelo menos 20 caracteres.' }

$folder = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AmigoSecreto'
$file = Join-Path $folder 'segredos.xml'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
[pscustomobject]@{ GitHubToken = $token; OrganizerKey = $key } | Export-Clixml -LiteralPath $file
Write-Host 'Segredos guardados com a proteção do Windows. Avise no chat que concluiu a configuração.'
