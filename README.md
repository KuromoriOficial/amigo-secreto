# Amigo Secreto 2026

O participante usa o [GitHub Pages](https://kuromorioficial.github.io/amigo-secreto/). O painel fica em [/organizar/](https://kuromorioficial.github.io/amigo-secreto/organizar/). A API usa um endereço gerenciado e guarda os dados do evento em `amigo-secreto-2026.json` no [repositório privado de dados](https://github.com/KuromoriOficial/amigo-secreto-dados). O Git registra cada atualização do arquivo no histórico.

## Ativar o sorteio real

1. No GitHub, [crie um token de acesso refinado](https://github.com/settings/personal-access-tokens/new) limitado ao repositório `amigo-secreto-dados`. Em permissões de repositório, conceda **Contents: Read and write**. Escolha uma validade que cubra a coleta das respostas.
2. No Windows, na pasta deste projeto, rode `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\configurar-segredos.ps1`. Informe o token e crie a chave do organizador nos campos protegidos. Depois avise no chat que concluiu. O assistente pode usar o arquivo protegido do Windows para configurar os segredos do ambiente gerenciado.
3. Depois da ativação, entre no painel com a chave que você criou. Cadastre os nomes e fotos, salve a lista e gere os códigos de acesso.
4. Use **Fazer sorteio de teste** para ensaiar com a lista salva. Depois, clique em **Resetar sorteio** para apagar os códigos do teste, as revelações e as respostas do calendário. Os perfis, os códigos de acesso e o registro de entrada são preservados.
5. Com a lista em rascunho, use **Fazer sorteio definitivo**. Se quiser usar o sorteador offline, baixe a lista e importe os dois arquivos que ele gerar. Cada participante é tirado exatamente uma vez, e ninguém tira o próprio nome.
6. Envie individualmente o link público, o código de acesso e o código do sorteio definitivo. Cada pessoa entra, preenche o perfil Steam e revela o amigo. Uma foto já cadastrada vale para o perfil. Acompanhe quem entrou, viu a revelação e respondeu ao calendário.

**Cancelar sorteio definitivo** interrompe as consultas e respostas da rodada. Depois de cancelar, use **Resetar sorteio** para voltar ao rascunho e preparar uma nova rodada.

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
