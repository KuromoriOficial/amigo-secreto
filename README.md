# Amigo Secreto 2026

O participante usa o [GitHub Pages](https://kuromorioficial.github.io/amigo-secreto/). O painel fica em [/organizar/](https://kuromorioficial.github.io/amigo-secreto/organizar/). A API usa um endereço gerenciado e guarda os dados do evento em `amigo-secreto-2026.json` no [repositório privado de dados](https://github.com/KuromoriOficial/amigo-secreto-dados). O Git registra cada atualização do arquivo no histórico.

## Ativar o sorteio real

1. No GitHub, [crie um token de acesso refinado](https://github.com/settings/personal-access-tokens/new) limitado ao repositório `amigo-secreto-dados`. Em permissões de repositório, conceda **Contents: Read and write**. Escolha uma validade que cubra a coleta das respostas.
2. No Windows, na pasta deste projeto, rode `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\configurar-segredos.ps1`. Informe o token e crie a chave do organizador nos campos protegidos. Depois avise no chat que concluiu. O assistente pode usar o arquivo protegido do Windows para configurar os segredos do ambiente gerenciado.
3. Depois da ativação, entre no painel com a chave que você criou. Cadastre os nomes e fotos e clique em **Fazer sorteio**. Envie a cada participante o link público e o código individual dele.
4. Acompanhe no painel quem respondeu e quantas pessoas podem participar em cada data. Uma resposta sem datas marcadas indica disponibilidade em todos os dias.

Enquanto a configuração está pendente, o código `482731` abre a demonstração. A demonstração salva datas apenas no navegador. Números incorretos mostram um perfil fictício aleatório e não registram respostas.

## Build e configuração

O workflow do repositório público publica `dist-pages/`. Para compilar localmente com Node.js 22.13 ou superior:

```powershell
npm ci
$env:PAGES_BASE_PATH = '/amigo-secreto/'
$env:VITE_API_ORIGIN = 'https://amigo-secreto-encontro-2026.andretoshiro.chatgpt.site'
npm run build:pages
```

A API usa `PAGES_URL` para redirecionar ao GitHub Pages e aceitar requisições do navegador dessa origem. No ambiente da API, configure também `GITHUB_DATA_REPOSITORY`, `GITHUB_DATA_TOKEN` e `ORGANIZER_KEY`. O token e a chave são segredos do ambiente da API. O valor opcional `GITHUB_DATA_BRANCH` aponta para um branch inicializado, com padrão `main`. A API verifica se o repositório é privado antes de acessar os dados.
