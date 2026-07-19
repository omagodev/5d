# STARFORGE 5D

## Executar com PM2

```bash
npm install --omit=dev
pm2 start ecosystem.config.js --env production
pm2 save
```

O servidor usa a porta `4050` por padrão. Comandos úteis:

```bash
pm2 status
pm2 logs starforge-5d
pm2 restart starforge-5d --update-env
pm2 stop starforge-5d
```

Para restaurar os processos automaticamente depois de reiniciar o Linux:

```bash
pm2 startup
```

Execute também o comando com `sudo` que o próprio `pm2 startup` imprimir e,
em seguida, rode `pm2 save` novamente.

## Multiplayer e ranking

No hangar multiplayer, cada piloto escolhe sua nave e confirma o estado de
pronto. As escolhas aparecem para toda a sala e somente o host pode iniciar,
depois que os dois pilotos estiverem prontos. Um piloto eliminado permanece
como espectador até o parceiro também ser abatido ou a sala ser encerrada.

O servidor deve permanecer com `instances: 1` no PM2 porque as salas WebSocket
ficam em memória. O ranking e o histórico das partidas são persistidos em:

```text
data/starforge.sqlite
```

O banco é criado automaticamente no primeiro início. A API expõe:

```text
GET  /api/ranking
POST /api/matches
```

Depois de atualizar o projeto no servidor:

```bash
npm install --omit=dev
pm2 restart starforge-5d --update-env
pm2 save
```
