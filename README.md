# Amigo Secreto 2026

O participante usa o [GitHub Pages](https://kuromorioficial.github.io/amigo-secreto/). O painel fica em [/organizar/](https://kuromorioficial.github.io/amigo-secreto/organizar/). A API usa um endereço gerenciado e guarda os dados do evento em `amigo-secreto-2026.json` no [repositório privado de dados](https://github.com/KuromoriOficial/amigo-secreto-dados). O Git registra cada atualização do arquivo no histórico.

## Ativar o sorteio real

1. No GitHub, [crie um token de acesso refinado](https://github.com/settings/personal-access-tokens/new) limitado ao repositório `amigo-secreto-dados`. Em permissões de repositório, conceda **Contents: Read and write**. Escolha uma validade que cubra a coleta das respostas.
2. No Windows, na pasta deste projeto, rode `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\configurar-segredos.ps1`. Informe o token e crie a chave do organizador nos campos protegidos. Depois avise no chat que concluiu. O assistente pode usar o arquivo protegido do Windows para configurar os segredos do ambiente gerenciado.
3. Depois da ativação, entre no painel com a chave que você criou. Cadastre os nomes e fotos, salve a lista e gere os códigos de acesso.
4. Baixe o sorteador offline e abra o arquivo HTML no navegador. Selecione a lista e faça o sorteio. A ferramenta garante que cada participante seja tirado uma vez e que ninguém tire o próprio nome.
5. Importe `sorteio-criptografado-2026.json` e `codigos-amigo-secreto-2026.txt` no painel. Envie individualmente a cada participante o link público, o código de acesso e o código do sorteio.
6. Cada pessoa entra com o código de acesso, preenche o perfil Steam e usa o código do sorteio para revelar o amigo. Acompanhe no painel quem entrou, viu a revelação e respondeu ao calendário. Uma resposta sem datas marcadas indica disponibilidade em todos os dias.

Enquanto o sorteio está em rascunho, o código `482731` funciona na entrada e na revelação da demonstração. A demonstração salva datas apenas no navegador. Um código de sorteio incorreto mostra um meme aleatório.

Depois de salvar as datas, **Baixar calendário em PDF** exporta os calendários de novembro e dezembro com as indisponibilidades marcadas.

## Build e configuração

O workflow do repositório público publica `dist-pages/`. Para compilar localmente com Node.js 22.13 ou superior:

```powershell
npm ci
$env:PAGES_BASE_PATH = '/amigo-secreto/'
$env:VITE_API_ORIGIN = 'https://amigo-secreto-encontro-2026.andretoshiro.chatgpt.site'
npm run build:pages
```

A API usa `PAGES_URL` para redirecionar ao GitHub Pages e aceitar requisições do navegador dessa origem. Configure `GITHUB_DATA_REPOSITORY` e os segredos `GITHUB_DATA_TOKEN`, `ORGANIZER_KEY` e `DRAW_VAULT_KEY` no ambiente da API. Preserve a chave do cofre de 32 bytes em hexadecimal para manter o acesso aos códigos cadastrados. O valor opcional `GITHUB_DATA_BRANCH` aponta para um branch inicializado, com padrão `main`. A API verifica se o repositório é privado antes de acessar os dados.
