# Amigo Secreto 2026

Site independente para revelar o sorteio e reunir as indisponibilidades do grupo entre 1º de novembro e 31 de dezembro de 2026.

## Organizar o encontro

1. Abra `/organizar` no site publicado com a conta proprietária do Site.
2. Cadastre pelo menos dois participantes com nome e foto. Salve a lista para continuar mais tarde ou clique em **Realizar sorteio** quando estiver pronta.
3. Copie o código de cada participante e envie individualmente, junto com o link do site. Cada código revela a mesma pessoa e permite rever ou alterar a disponibilidade.
4. Acompanhe no painel quantas pessoas responderam e quais datas têm mais pessoas livres. Quem ainda não respondeu fica como pendente. Uma resposta sem datas marcadas indica disponibilidade em todos os dias.

Antes do sorteio real, o código `482731` abre a demonstração. Outros números exibem um perfil fictício aleatório. Só os códigos válidos do sorteio real registram respostas no banco.

O Site usa as configurações de acesso do Sites. Para acesso privado, conceda permissão aos convidados no painel de compartilhamento do Site antes de distribuir o link.

## Rodar localmente

Com Node.js 22.13 ou superior, entre na pasta deste projeto e rode:

```powershell
npm run install:ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_needy_wallop.sql
npm run dev
```

Use a URL impressa pelo servidor. Execute a migração uma vez por banco local. Para testar `/organizar`, crie um arquivo `.dev.vars` na pasta do projeto com `ORGANIZER_KEY` e um valor escolhido por você (pelo menos 12 caracteres). A configuração de produção usa `ORGANIZER_EMAIL` no ambiente do Sites para autorizar a conta do organizador. O banco de desenvolvimento é separado do banco de produção.
