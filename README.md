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
