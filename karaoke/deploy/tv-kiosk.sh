#!/usr/bin/env bash
# Abre a tela da TV em tela cheia, com áudio liberado (sem precisar clicar).
sleep 8
exec chromium --kiosk --autoplay-policy=no-user-gesture-required --noerrdialogs http://localhost:3000/tv
