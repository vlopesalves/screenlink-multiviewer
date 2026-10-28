# ScreenLink

Protótipo de compartilhamento de tela em tempo real para publicação no GitHub Pages.

## Funcionalidades previstas neste MVP
- Criar sala com código de 6 caracteres e link compartilhável.
- Sala permanente **GVG - Epic Seven**, com identificador fixo `GVGEP7` e link reutilizável.
- Entrar em salas temporárias por código ou pelo parâmetro `?room=CODIGO`.
- Acessar diretamente a sala fixa com `?room=GVGEP7`; o endereço pode ser compartilhado com todos os membros.
- Captura de monitor, janela ou aba via seletor nativo do navegador.
- Áudio do sistema quando o navegador e a fonte selecionada permitem.
- Transmissão P2P usando WebRTC; Supabase Realtime usado para sinalização.
- Vários espectadores simultâneos (cada espectador recebe sua própria conexão WebRTC com o transmissor).
- O transmissor pode liberar a transmissão sem fechar a sala; outro participante pode assumir usando o botão **Assumir transmissão**.
- O botão **Encerrar sala** encerra a sala para os participantes; **Sair da sala** permite que um espectador saia sem encerrar a transmissão.

## 1. Criar projeto Supabase
1. Crie um projeto em https://supabase.com/.
2. No painel, abra **Project Settings → API** (ou **Data API**, conforme a interface).
3. Copie a Project URL e a chave pública `anon` / publishable.
4. Em `app.js`, substitua `SUPABASE_URL` e `SUPABASE_ANON_KEY`.
5. No painel Supabase, confira se Realtime está habilitado para canais Broadcast e se a política permite que clientes anônimos entrem nos canais necessários.

### Segurança
Este protótipo usa nomes de canal previsíveis a partir do código da sala e sinalização Broadcast. Portanto, **não trate salas como privadas ou seguras para dados sensíveis**. Para produção, implemente autenticação/controle de acesso, códigos de alta entropia, expiração de sala, rate limiting e políticas Realtime que restrinjam o acesso. Não use chave `service_role` no navegador. O link é uma capacidade de acesso: compartilhe apenas com pessoas autorizadas.

## Sala fixa GVG - Epic Seven
O identificador permanente está definido em `FIXED_ROOM_ID` no início de `app.js`. O valor padrão é `GVGEP7` (seis caracteres). Mantenha esse valor para que todos entrem na mesma sala. Depois de publicar no GitHub Pages, o link fixo terá o formato `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/?room=GVGEP7`. Troque os exemplos pelo endereço real do seu site. A sala é permanente no sentido de reutilizar o mesmo canal; a transmissão de vídeo só existe enquanto alguém estiver compartilhando a tela.

## 2. Testar localmente
A captura de tela exige um contexto seguro (HTTPS ou localhost). Com Python instalado, dentro da pasta:
```bash
python -m http.server 8000
```
Abra http://localhost:8000. Para testar com outra pessoa, publique em HTTPS no GitHub Pages e configure o Supabase.

## 3. Publicar no GitHub Pages
1. Crie um repositório público, por exemplo `screenlink`.
2. Envie `index.html`, `style.css`, `app.js` e `README.md` para a raiz do repositório.
3. Vá em **Settings → Pages**.
4. Em **Build and deployment**, selecione **Deploy from a branch**.
5. Selecione `main` e `/ (root)` e salve.
6. Aguarde o deploy; o site ficará em `https://SEU-USUARIO.github.io/screenlink/`.

## Limitações conhecidas
- Cada espectador usa uma conexão WebRTC individual; o consumo de banda do transmissor aumenta conforme o número de espectadores.
- A transferência de transmissão é coordenada por Broadcast e serve para um protótipo pequeno; não há bloqueio autoritativo no servidor contra duas pessoas tentando assumir exatamente ao mesmo tempo.
- STUN não garante conexão em todas as redes. Para redes restritivas, configure um servidor TURN.
- O suporte à captura de áudio varia por navegador, sistema operacional e fonte selecionada.
- Não existe gravação, login, chat ou controle remoto.
- Esta é uma base inicial de demonstração, não um produto pronto para produção.
