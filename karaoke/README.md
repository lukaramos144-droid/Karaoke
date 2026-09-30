# 🎤 Karaokê LAN

Servidor de karaokê para rede local: o PC ligado à TV/som roda o servidor, e os celulares entram por QR Code (sem app, sem login).

## Estrutura
```
server/src/   index.ts (rotas + WebSocket) · db.ts (SQLite) · auth.ts · hub.ts (tempo real) · player.ts (fila/reprodução)
              pipeline.ts (download → stems → normalização → letra) · net.ts (IP/mDNS) · proc.ts (execução segura)
              providers/audio.ts (AudioSource: yt-dlp)  ·  providers/lyrics.ts (LyricsProvider: local + LRCLIB)
worker/       separate.py (Demucs) · requirements.txt
public/       tv.html · mobile.html · admin.html · common.js · style.css
deploy/       karaoke.service (Linux) · tv-kiosk.sh
Dockerfile · docker-compose.yml · .env.example
```

## 1–2. Instalar e iniciar (sem Docker)
Requisitos: Node 20+, Python 3.10+, FFmpeg, yt-dlp.
```bash
npm install
pip install -r worker/requirements.txt      # Demucs + PyTorch (grande; use a versão CPU se não tiver GPU)
cp .env.example .env                        # edite ADMIN_PASSWORD, WIFI_NAME etc.
set -a; . ./.env; set +a; npm start         # Windows: defina as variáveis no terminal antes de npm start
```
O terminal mostra: URL para celulares, URL da TV, do admin e a senha do admin.
Para testar sem Demucs: `AUDIO_MODE=passthrough` (toca o áudio original, com vocais).

**Docker:** `HOST_IP=192.168.0.20 docker compose up --build` (use o IP do PC na rede; dentro do contêiner o IP não é detectável).
Simplificação: é **um** serviço (servidor + frontend estático + worker Python + SQLite em arquivo), não quatro contêineres.

## 3. Conectar celulares
1. Abra `http://localhost:3000/tv` no navegador do PC ligado à TV (tela cheia, F11).
2. Celulares no mesmo Wi-Fi escaneiam o QR Code e abrem a página. Também funciona `http://karaoke.local:3000` onde o mDNS existir (iOS/macOS/Windows recente; no Docker Desktop não).
3. Painel admin: `http://localhost:3000/admin` (senha do terminal).

## 4. QR Code
Gerado pelo servidor em `/api/qr.svg` com o IP da rede (`HOST_IP` força outro). Se o PC tiver várias placas de rede e o QR apontar para a errada, defina `HOST_IP`.

## 5. Processamento de áudio
`AUDIO_MODE=demucs`, `DEMUCS_MODEL` (htdemucs), `DEMUCS_DEVICE` (`cpu`, `cuda`, `mps`). Em CPU, uma música leva cerca de 1–3 min; com GPU, segundos. O instrumental normalizado fica em `CACHE_DIR` por `CACHE_TTL_HOURS`; vocais e original são apagados logo após o processamento. O servidor prepara as próximas músicas enquanto uma toca.
Fonte de áudio: `providers/audio.ts` (interface `AudioSource`). Use apenas conteúdo que você tenha direito de usar e respeite os termos das plataformas; para outra fonte (arquivos locais, serviço licenciado) implemente a interface e troque `audioSource`.

## 6. Letras
Ordem em `providers/lyrics.ts`: (1) arquivos locais `data/lyrics/local/Artista - Título.lrc` (ou `.txt`), (2) LRCLIB (gratuita, com versões sincronizadas). Sem tempo, as linhas são espalhadas uniformemente e o admin corrige em **Fila → Letra** (editor `[mm:ss.xx] texto` + deslocamento ±0,5 s por música; deslocamento global em Configurações). Novo provedor = implementar `LyricsProvider` e adicionar à lista. Destaque palavra a palavra é interpolado dentro de cada linha.

## 7. Aparência
Tema (Neon / Pôr do sol / Gelo), tamanho da letra e velocidade da animação em **Admin → Configurações**. Cores e fontes: variáveis no topo de `public/style.css`.

## 8. Início automático
- **Linux:** `deploy/karaoke.service` (systemd) + `deploy/tv-kiosk.sh` em "Aplicativos de inicialização".
- **Windows:** atalhos em `shell:startup` — um para `npm start` (pasta do projeto) e outro para `chrome.exe --kiosk --autoplay-policy=no-user-gesture-required http://localhost:3000/tv`.
- **macOS:** Itens de Login apontando para um script com os mesmos comandos.
Sem a flag `--autoplay-policy`, a TV pede um toque/tecla uma única vez.

## Segurança
Sessão por token assinado, admin com senha e token de 12 h, TV só pelo próprio PC (ou com senha), limites por IP, cooldown e máximo de músicas por pessoa, URLs validadas (só YouTube), comandos sem shell, dados sempre escritos com `textContent`.

## Limites conhecidos deste MVP
- Não testei o fluxo com yt-dlp/Demucs reais (ambiente sem acesso a essas redes): o servidor, a fila, o WebSocket, a segurança e o tratamento de erro foram testados; a integração de áudio precisa de uma primeira rodada sua.
- Alinhamento automático áudio+letra (Whisper/aeneas) **não** está implementado; o ponto de encaixe é o fim de `processSong` em `pipeline.ts`.
- Frontend em JavaScript puro (sem React/Vite/Tailwind, sem etapa de build); backend em TypeScript.
- "Voltar" reinicia a música atual; não volta para a anterior.
