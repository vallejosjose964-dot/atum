# ATUM frontend (final)
- Diseñado para tu dataset real `Rotmod_LTG.zip` (175 archivos `.dat` SPARC).
- Auto: Ping backend → carga ZIP del repo → preview → compute primer archivo.
- Backend esperado:
  - GET /health
  - POST /compute
  - POST /global_rms
  - POST /dwarfs
- Micro botones W/Z/Muon:
  - Recomendado: agregar endpoint backend `POST /micro` (retorna micro_engine). Frontend ya lo llama.

## Archivos en tu repo (GitHub Pages)
Poné estos archivos en el root del repo ATUM:
- index.html
- app.js
- Rotmod_LTG.zip

Opcional:
- LoCuSS.zip (si lo tenés)
